// Fan out ("spiderfy") a cluster whose points are all at (or very near) the
// exact same coordinates, so zooming in can never visually separate them.
//
// Deliberately NOT using a third-party spiderfy library: the obvious option
// (@nazka/map-gl-js-spiderfy) hard-requires the target cluster layer to be
// type 'symbol' and always renders its fanned-out "leaves" as symbol/icon
// layers, which doesn't fit our circle-type `clusters`/`points-layer` setup
// without generating per-design-type icon images first. This draws the leaves
// as plain MapLibre circle + line layers, reusing the points-layer styling.

import type { Map as MaplibreMap, MapGeoJSONFeature, GeoJSONSource } from 'maplibre-gl';
import {
  CLUSTER_MAX_ZOOM,
  INDIVIDUAL_DOT_RADIUS,
  generateDesignColorExpression,
  generateDesignStrokeColorExpression
} from '../store/mapVisualizationManager';

const LEGS_SOURCE_ID = 'spiderfy-legs-source';
const LEAVES_SOURCE_ID = 'spiderfy-leaves-source';
const LEGS_LAYER_ID = 'spiderfy-legs';
export const LEAVES_LAYER_ID = 'spiderfy-leaves';

const LEAF_RADIUS = INDIVIDUAL_DOT_RADIUS;

export interface SpiderfyLeafHandlers {
  click: (e: any) => void;
  dblclick: (e: any) => void;
}

let activeLeafHandlers: SpiderfyLeafHandlers | null = null;
// What's currently fanned out, kept so the layout can be redrawn as the zoom
// changes.
let activeCenter: [number, number] | null = null;
let activeLeafProperties: any[] = [];
// clustered-source feature ids (MapLibre's generated ids, not Supercluster's
// cluster_id) currently faded behind the fan: the cluster circle at zoom <=
// CLUSTER_MAX_ZOOM, or the individual points stacked at the center above it.
// Point ids (0..n-1) and cluster ids (always >= n) can't collide.
let fadedFeatureIds: (string | number)[] = [];
let activeZoomHandler: (() => void) | null = null;
let activeMoveEndHandler: (() => void) | null = null;
let activeIdleHandler: (() => void) | null = null;

function setLeafCursor(e: any) {
  e.target.getCanvas().style.cursor = 'pointer';
}

function resetLeafCursor(e: any) {
  e.target.getCanvas().style.cursor = '';
}

// Gap sequences (degrees, consecutive -- gap[i] is the angle from point i to
// point i+1) measured directly off the reference site with a protractor, one
// real example per count. Not a formula: earlier attempts to fit a single
// spiral/decay curve to small counts (2-3) and large-count behavior (4-5)
// simultaneously ran into a genuine mathematical tension (see git history on
// this file) and weren't worth the complexity once the PI confirmed real
// clusters won't exceed ~5 co-located studies at one site. Each array sums
// to 360 deg (they're gaps all the way around the circle, not an open arc).
const MEASURED_GAPS: Record<number, number[]> = {
  2: [150, 210],
  3: [100, 145, 115],
  4: [75, 75, 105, 105],
  5: [60, 55, 70, 95, 80]
};

// Relative leg lengths, same point order/convention as MEASURED_GAPS (start
// at the 15 deg anchor, walk clockwise). Consistent on the same scale across
// cluster sizes (confirmed: the 2-point case's legs visually matched the
// ~.83 value seen as the first entry in both the 4- and 5-point cases) --
// not independently normalized per cluster, so these can share one scale
// factor below rather than needing separate per-count scaling.
const MEASURED_RELATIVE_RADII: Record<number, number[]> = {
  2: [0.83, 0.83],
  3: [0.84, 1, 0.6],
  4: [0.83, 1, 0.81, 0.58],
  5: [0.83, 1, 0.94, 0.68, 0.57]
};

// Scales relative radii to pixels so that the smallest value observed across
// all four measured sets (0.57, in the 5-point case) still clears a safe
// floor -- comfortably more than 2x LEAF_RADIUS so the shortest two legs in
// any cluster never put their dots close enough to touch.
const RADIUS_SAFE_FLOOR_PX = 35;
const SMALLEST_MEASURED_RELATIVE_RADIUS = 0.57;
const RADIUS_SCALE = RADIUS_SAFE_FLOOR_PX / SMALLEST_MEASURED_RELATIVE_RADIUS;

// Measured consistently across every reference-site example regardless of
// cluster size: one leg always sits 15 deg clockwise from horizontal. In
// this formula's convention (angle=0 is horizontal-right, and increasing
// angle rotates clockwise since screen-pixel y grows downward) that's just
// the starting angle for point 0 -- no sign flip needed.
const SPIRAL_START_ANGLE_DEG = 15;

// Places `count` points using the measured gap/radius sequences for that
// count. Falls back to a plain uniform 360/count circle (at the floor
// radius) for any count outside the measured 2-5 range -- shouldn't happen
// per the PI, but cheap insurance against a crash if it does.
function pointsInSpiral(count: number): [number, number][] {
  const gaps = MEASURED_GAPS[count] ?? Array(count).fill(360 / count);
  const relativeRadii = MEASURED_RELATIVE_RADII[count] ?? Array(count).fill(1);
  const points: [number, number][] = [];
  let cumulativeAngle = SPIRAL_START_ANGLE_DEG;
  for (let i = 0; i < count; i++) {
    const radius = relativeRadii[i] * RADIUS_SCALE;
    points.push([
      radius * Math.cos((cumulativeAngle * Math.PI) / 180),
      radius * Math.sin((cumulativeAngle * Math.PI) / 180)
    ]);
    cumulativeAngle += gaps[i];
  }
  return points;
}

export function isSpiderfyActive(map: MaplibreMap): boolean {
  return !!map.getSource(LEAVES_SOURCE_ID);
}

// True if `featureId` (a clustered-source cluster or point) is faded behind
// the current fan, so a click on it can collapse the fan.
export function isSpiderfiedFeature(featureId: string | number | undefined): boolean {
  return featureId !== undefined && fadedFeatureIds.includes(featureId);
}

export function clearSpiderfy(map: MaplibreMap): void {
  setFadedFeatures(map, []);

  // Detach listeners unconditionally: a base map style swap removes our layers
  // and sources but not layer-scoped listeners, which would otherwise pile up
  // and fire once per stale copy on the next spiderfy.
  if (activeLeafHandlers) {
    map.off('click', LEAVES_LAYER_ID, activeLeafHandlers.click);
    map.off('dblclick', LEAVES_LAYER_ID, activeLeafHandlers.dblclick);
    map.off('mouseenter', LEAVES_LAYER_ID, setLeafCursor);
    map.off('mouseleave', LEAVES_LAYER_ID, resetLeafCursor);
    activeLeafHandlers = null;
    map.getCanvas().style.cursor = '';
  }
  if (activeZoomHandler) map.off('zoom', activeZoomHandler);
  if (activeMoveEndHandler) map.off('moveend', activeMoveEndHandler);
  if (activeIdleHandler) map.off('idle', activeIdleHandler);
  activeZoomHandler = activeMoveEndHandler = activeIdleHandler = null;
  activeCenter = null;
  activeLeafProperties = [];

  try {
    if (map.getLayer(LEAVES_LAYER_ID)) map.removeLayer(LEAVES_LAYER_ID);
    if (map.getLayer(LEGS_LAYER_ID)) map.removeLayer(LEGS_LAYER_ID);
    if (map.getSource(LEAVES_SOURCE_ID)) map.removeSource(LEAVES_SOURCE_ID);
    if (map.getSource(LEGS_SOURCE_ID)) map.removeSource(LEGS_SOURCE_ID);
  } catch (e) {
    console.warn('[spiderfy] Error clearing spiderfied cluster:', e);
  }
}

// Fan out `leaves` (all sharing ~the same coordinates as `clusterCoordinates`)
// into a circle/spiral of individually-clickable dots. `leafHandlers.click` is
// called with the same event shape a normal points-layer click produces, so
// callers can feed it straight into their existing single-point popover flow;
// `dblclick` should cancel any click pending from the same double-click.
export function spiderfyCluster(
  map: MaplibreMap,
  clusterCoordinates: [number, number],
  clusterFeatureId: string | number | undefined,
  leaves: MapGeoJSONFeature[],
  leafHandlers: SpiderfyLeafHandlers
): void {
  clearSpiderfy(map);
  if (leaves.length === 0) return;

  const leafProperties = leaves.map((leaf) => leaf.properties);
  const { leafCollection, legCollection } = buildLayout(map, clusterCoordinates, leafProperties);

  try {
    map.addSource(LEGS_SOURCE_ID, { type: 'geojson', data: legCollection });
    map.addSource(LEAVES_SOURCE_ID, { type: 'geojson', data: leafCollection });

    map.addLayer({
      id: LEGS_LAYER_ID,
      type: 'line',
      source: LEGS_SOURCE_ID,
      paint: {
        'line-color': '#999999',
        'line-width': 1.5,
        'line-opacity': 0.8
      }
    });

    map.addLayer({
      id: LEAVES_LAYER_ID,
      type: 'circle',
      source: LEAVES_SOURCE_ID,
      paint: {
        'circle-radius': LEAF_RADIUS,
        'circle-color': generateDesignColorExpression() as any,
        'circle-opacity': 0.95,
        'circle-stroke-width': 2,
        'circle-stroke-color': generateDesignStrokeColorExpression() as any
      }
    });
  } catch (e) {
    console.warn('[spiderfy] Error creating spiderfied layers:', e);
    clearSpiderfy(map);
    return;
  }

  activeCenter = clusterCoordinates;
  activeLeafProperties = leafProperties;
  activeLeafHandlers = leafHandlers;
  map.on('click', LEAVES_LAYER_ID, leafHandlers.click);
  map.on('dblclick', LEAVES_LAYER_ID, leafHandlers.dblclick);
  map.on('mouseenter', LEAVES_LAYER_ID, setLeafCursor);
  map.on('mouseleave', LEAVES_LAYER_ID, resetLeafCursor);

  // Panning needs nothing: the leaves/legs are real lng/lat features, so
  // MapLibre repaints them in place. Zooming changes how far apart the
  // fixed-pixel layout is in lng/lat, so redraw it every zoom frame. The
  // group can never split on zoom-in (its points share one location), so the
  // fan only collapses when a zoom-out merges it with other dots -- checked
  // once the map settles, since mid-animation the new zoom level's clusters
  // may not be loaded yet and would look like a merge.
  activeZoomHandler = () => {
    relayout(map);
    syncFadedFeatures(map, false);
  };
  activeMoveEndHandler = () => {
    if (activeIdleHandler) map.off('idle', activeIdleHandler);
    activeIdleHandler = () => {
      activeIdleHandler = null;
      syncFadedFeatures(map, true);
    };
    map.once('idle', activeIdleHandler);
  };
  map.on('zoom', activeZoomHandler);
  map.on('moveend', activeMoveEndHandler);

  // Fade the original cluster circle down near-invisible while spiderfied
  // (see the 'clusters' layer's circle-opacity expression), instead of
  // hiding it outright.
  if (clusterFeatureId !== undefined) setFadedFeatures(map, [clusterFeatureId]);
}

// Zoom in one level around the fanned-out cluster (rather than around the
// cursor, which could push the fan off screen). The fan follows the zoom.
export function zoomSpiderfyIn(map: MaplibreMap): void {
  if (!activeCenter || !isSpiderfyActive(map)) return;
  const targetZoom = Math.min(Math.floor(map.getZoom()) + 1, map.getMaxZoom());
  if (targetZoom <= map.getZoom()) return;
  // Callers run inside a MapLibre dblclick listener, and MapLibre stops any
  // camera animation started while it's still handling that input event
  // (HandlerManager calls map._stop()). Start the zoom once it's done.
  const center = activeCenter;
  setTimeout(() => map.easeTo({ center, zoom: targetZoom }), 0);
}

// Leaf and leg features for `leafProperties` fanned out around `center`, at
// the map's current zoom (offsets are fixed pixel distances).
function buildLayout(map: MaplibreMap, center: [number, number], leafProperties: any[]) {
  const centerPixel = map.project(center);
  const offsets = pointsInSpiral(leafProperties.length);

  const leafFeatures = leafProperties.map((properties, i) => {
    const [dx, dy] = offsets[i];
    const leafLngLat = map.unproject([centerPixel.x + dx, centerPixel.y + dy]);
    return {
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [leafLngLat.lng, leafLngLat.lat] },
      properties
    };
  });

  const legFeatures = leafFeatures.map((f) => ({
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: [center, f.geometry.coordinates] },
    properties: {}
  }));

  return {
    leafCollection: { type: 'FeatureCollection' as const, features: leafFeatures },
    legCollection: { type: 'FeatureCollection' as const, features: legFeatures }
  };
}

function relayout(map: MaplibreMap) {
  if (!activeCenter) return;
  const { leafCollection, legCollection } = buildLayout(map, activeCenter, activeLeafProperties);
  (map.getSource(LEAVES_SOURCE_ID) as GeoJSONSource | undefined)?.setData(leafCollection as any);
  (map.getSource(LEGS_SOURCE_ID) as GeoJSONSource | undefined)?.setData(legCollection as any);
}

// Replace the set of faded clustered-source features with `ids`.
function setFadedFeatures(map: MaplibreMap, ids: (string | number)[]) {
  for (const id of fadedFeatureIds) {
    if (ids.includes(id)) continue;
    try {
      map.setFeatureState({ source: 'clustered-source', id }, { spiderfied: false });
    } catch (e) {
      // Source may have been rebuilt (filter change, style swap) since this id
      // was assigned -- nothing meaningful to restore in that case.
    }
  }
  const applied: (string | number)[] = [];
  for (const id of ids) {
    try {
      map.setFeatureState({ source: 'clustered-source', id }, { spiderfied: true });
      applied.push(id);
    } catch (e) {
      console.warn('[spiderfy] Error setting spiderfied feature-state:', e);
    }
  }
  fadedFeatureIds = applied;
}

// Clusters are rebuilt per zoom level with new feature ids, so after a zoom
// whatever sits under the fan is a different feature than the one we faded.
// Find what now represents this group at the fan's center and fade that:
// - above CLUSTER_MAX_ZOOM nothing clusters, so it's the group's own points,
//   stacked on the center pixel;
// - otherwise it's a cluster of exactly this many points at the center. If
//   there isn't one, a zoom-out has merged the group with dots elsewhere --
//   collapse the fan when `allowCollapse` (i.e. the map has settled).
function syncFadedFeatures(map: MaplibreMap, allowCollapse: boolean) {
  if (!activeCenter) return;
  const center = map.project(activeCenter);
  // Off screen (panned away, or zoomed around a cursor elsewhere) there's
  // nothing rendered to query, which would read as a merge. Wait until it's
  // back in view.
  const canvas = map.getCanvas();
  if (center.x < 0 || center.y < 0 || center.x > canvas.clientWidth || center.y > canvas.clientHeight) {
    return;
  }
  const atCenter = (f: MapGeoJSONFeature) => {
    const p = map.project((f.geometry as any).coordinates);
    return Math.abs(p.x - center.x) < 1 && Math.abs(p.y - center.y) < 1;
  };

  if (map.getZoom() > CLUSTER_MAX_ZOOM) {
    if (!map.getLayer('points-layer')) return;
    const points = map
      .queryRenderedFeatures(center, { layers: ['points-layer'] })
      .filter(atCenter)
      .map((f) => f.id)
      .filter((id): id is string | number => id !== undefined);
    if (points.length > 0) setFadedFeatures(map, points);
    return;
  }

  if (!map.getLayer('clusters')) return;
  const cluster = map
    .queryRenderedFeatures(center, { layers: ['clusters'] })
    .find((f) => atCenter(f) && f.properties?.point_count === activeLeafProperties.length);

  if (cluster && cluster.id !== undefined) {
    setFadedFeatures(map, [cluster.id]);
  } else if (allowCollapse) {
    clearSpiderfy(map);
  }
}
