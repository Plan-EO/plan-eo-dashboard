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

// Below this leaf count, arrange in a circle; at/above it, a spiral (same
// switchover point commonly used by spiderfy implementations) since a circle
// gets visually crowded past ~10 points.
const CIRCLE_SPIRAL_SWITCHOVER = 10;

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

// Evenly spaced points around a circle of the given pixel radius.
function pointsInCircle(count: number, separation = 45): [number, number][] {
  const points: [number, number][] = [];
  const theta = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    const angle = theta * i;
    points.push([separation * Math.cos(angle), separation * Math.sin(angle)]);
  }
  return points;
}

// Archimedean-spiral layout for larger leaf counts, so points don't overlap
// as the count grows past what a single circle can comfortably hold.
function pointsInSpiral(
  count: number,
  legLengthStart = 25,
  legLengthFactor = 2.2,
  separation = 30
): [number, number][] {
  const points: [number, number][] = [];
  let legLength = legLengthStart;
  let angle = 0;
  for (let i = 0; i < count; i++) {
    angle += separation / legLength + i * 0.0005;
    const x = legLength * Math.cos(angle);
    const y = legLength * Math.sin(angle);
    points.push([x, y]);
    legLength += (Math.PI * 2 * legLengthFactor) / angle;
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
  const offsets =
    leaves.length < CIRCLE_SPIRAL_SWITCHOVER
      ? pointsInCircle(leaves.length)
      : pointsInSpiral(leaves.length);

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
