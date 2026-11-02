// PROTOTYPE: fan out ("spiderfy") a cluster whose points are all at (or very
// near) the exact same coordinates, so zooming in can never visually separate
// them. This is a self-contained, additive module -- nothing elsewhere in the
// app depends on it, so removing this file plus the few call sites wired into
// MapLayer.svelte fully reverts the feature.
//
// Deliberately NOT using a third-party spiderfy library: the obvious option
// (@nazka/map-gl-js-spiderfy) hard-requires the target cluster layer to be
// type 'symbol' and always renders its fanned-out "leaves" as symbol/icon
// layers, which doesn't fit our circle-type `clusters`/`points-layer` setup
// without generating per-design-type icon images first. This implements the
// same circle/spiral layout math directly as plain MapLibre circle + line
// layers, matching our existing dot styling with no new asset generation.

import type { Map as MaplibreMap, MapGeoJSONFeature } from 'maplibre-gl';
import { getDesignColors, getDefaultColor } from './pieChartUtils';

const LEGS_SOURCE_ID = 'spiderfy-legs-source';
const LEAVES_SOURCE_ID = 'spiderfy-leaves-source';
const LEGS_LAYER_ID = 'spiderfy-legs';
const LEAVES_LAYER_ID = 'spiderfy-leaves';

// Mirrors INDIVIDUAL_DOT_RADIUS in mapVisualizationManager.ts so spiderfied
// leaves are visually identical to regular unclustered dots.
const LEAF_RADIUS = 12;

let activeLeafClickHandler: ((e: any) => void) | null = null;
let activeInteractionHandler: (() => void) | null = null;
// The MapLibre-assigned numeric feature.id of the currently-faded cluster
// circle (distinct from Supercluster's own cluster_id, which isn't usable
// with setFeatureState). Tracked here so clearSpiderfy can restore it.
let activeClusterFeatureId: string | number | null = null;

// Duplicated from mapVisualizationManager.ts (not exported there) rather than
// importing across modules, to keep this prototype fully self-contained.
function generateDesignColorExpression() {
  const designColors = getDesignColors();
  const matchExpression: any[] = ['match', ['get', 'design']];
  Object.entries(designColors).forEach(([design, color]) => {
    matchExpression.push(design);
    matchExpression.push(color);
  });
  matchExpression.push(getDefaultColor());
  return matchExpression;
}

function generateDesignStrokeColorExpression() {
  const designColors = getDesignColors();
  const matchExpression: any[] = ['match', ['get', 'design']];
  Object.keys(designColors)
    .filter((design) => !design.endsWith('_dark'))
    .forEach((design) => {
      const darkColor = designColors[`${design}_dark`] || designColors[design];
      matchExpression.push(design);
      matchExpression.push(darkColor);
    });
  matchExpression.push(getDefaultColor());
  return matchExpression;
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

export function clearSpiderfy(map: MaplibreMap): void {
  if (activeClusterFeatureId !== null) {
    try {
      map.setFeatureState(
        { source: 'clustered-source', id: activeClusterFeatureId },
        { spiderfied: false }
      );
    } catch (e) {
      // Source may have been rebuilt (filter change) since this id was
      // assigned -- nothing meaningful to restore in that case.
    }
    activeClusterFeatureId = null;
  }

  if (!isSpiderfyActive(map)) return;

  try {
    if (activeLeafClickHandler) {
      map.off('click', LEAVES_LAYER_ID, activeLeafClickHandler);
      activeLeafClickHandler = null;
    }
    if (activeInteractionHandler) {
      map.off('zoomstart', activeInteractionHandler);
      activeInteractionHandler = null;
    }

    if (map.getLayer(LEAVES_LAYER_ID)) map.removeLayer(LEAVES_LAYER_ID);
    if (map.getLayer(LEGS_LAYER_ID)) map.removeLayer(LEGS_LAYER_ID);
    if (map.getSource(LEAVES_SOURCE_ID)) map.removeSource(LEAVES_SOURCE_ID);
    if (map.getSource(LEGS_SOURCE_ID)) map.removeSource(LEGS_SOURCE_ID);
  } catch (e) {
    console.warn('[spiderfy] Error clearing spiderfied cluster:', e);
  }
}

// Fan out `leaves` (all sharing ~the same coordinates as `clusterCoordinates`)
// into a circle/spiral of individually-clickable dots. `onLeafClick` is
// called with the same event shape a normal points-layer click produces, so
// callers can feed it straight into their existing single-point popover flow.
export function spiderfyCluster(
  map: MaplibreMap,
  clusterCoordinates: [number, number],
  clusterFeatureId: string | number | undefined,
  leaves: MapGeoJSONFeature[],
  onLeafClick: (e: any) => void
): void {
  clearSpiderfy(map);
  if (leaves.length === 0) return;

  const centerPixel = map.project(clusterCoordinates);
  const offsets = pointsInSpiral(leaves.length);

  const leafFeatures = leaves.map((leaf, i) => {
    const [dx, dy] = offsets[i];
    const leafLngLat = map.unproject([centerPixel.x + dx, centerPixel.y + dy]);
    return {
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'Point' as const, coordinates: [leafLngLat.lng, leafLngLat.lat] },
      properties: leaf.properties
    };
  });

  const legFeatures = leafFeatures.map((f) => ({
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: [clusterCoordinates, f.geometry.coordinates]
    },
    properties: {}
  }));

  try {
    map.addSource(LEGS_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: legFeatures }
    });
    map.addSource(LEAVES_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: leafFeatures }
    });

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

  activeLeafClickHandler = onLeafClick;
  map.on('click', LEAVES_LAYER_ID, activeLeafClickHandler);

  // Persist through panning -- the leaves/legs are real lng/lat GeoJSON
  // features, so MapLibre repaints them at the correct screen position as the
  // camera moves, with no extra work needed here. Still collapse on zoom,
  // since the fixed-pixel-radius layout would otherwise look wrong (too
  // large/small relative to the now-differently-scaled map), and because a
  // zoom in may be the user trying to split the cluster for real.
  activeInteractionHandler = () => clearSpiderfy(map);
  map.once('zoomstart', activeInteractionHandler);

  // Fade the original cluster circle down near-invisible while spiderfied
  // (see the 'clusters' layer's circle-opacity expression), instead of
  // hiding it outright.
  if (clusterFeatureId !== undefined) {
    try {
      map.setFeatureState(
        { source: 'clustered-source', id: clusterFeatureId },
        { spiderfied: true }
      );
      activeClusterFeatureId = clusterFeatureId;
    } catch (e) {
      console.warn('[spiderfy] Error setting spiderfied feature-state:', e);
    }
  }
}
