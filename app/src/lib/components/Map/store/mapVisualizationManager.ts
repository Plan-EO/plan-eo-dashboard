import { get } from 'svelte/store';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { PointFeatureCollection } from '$lib/types';
import { visualizationType, type VisualizationType } from '$lib/stores/map.store';
import { isLoading, loadingMessage } from '$lib/stores/data.store';
import { filteredPointsData } from '$lib/stores/filter.store';
import { 
  mapInstance,
  pointsAddedToMap,
  isUpdatingVisualization,
  isProgrammaticSwitching,
  isAdjustingLayerOrder,
  setPointsAddedToMap
} from '$lib/stores/mapState.store';
import {
  createPieChartImage,
  cleanupPieChartImages,
  generatePieChartSymbols,
  generatePieChartIconExpression,
  getSeparatePieChartData,
  createSinglePieChartLayer,
  removePieChartLayer,
  getDesignColors,
  getDefaultColor
} from '../utils/pieChartUtils';
import { debounce } from '../utils/urlParams'; // Assuming debounce is here
import { dataPointsVisible, applyDataPointsVisibility } from '$lib/stores/dataPointsVisibility.store';

// Note: setMapInstance and setPointsAddedToMap are imported from mapState.store.ts

// Main function to update the map visualization
export async function updateMapVisualization(
  map: MaplibreMap | null,
  filteredData: PointFeatureCollection,
  vizType: VisualizationType,
  pointsAdded: boolean
): Promise<boolean> {

  // Prevent concurrent updates
  if (get(isUpdatingVisualization)) {
    return false;
  }

  if (!map || !map.isStyleLoaded()) {
    return false;
  }

  if (!pointsAdded) {
    return false;
  }

  isUpdatingVisualization.set(true);

  try {

    // Check if source exists
    let sourceExists = false;
    try {
      sourceExists = !!map.getSource('points-source');
    } catch (e) {
      console.warn('Source check failed:', e);
      sourceExists = false;
    }

    if (!sourceExists) {
      console.warn('Points source does not exist, attempting to recreate...');
      // Try to add initial points again
      const success = await addInitialPointsToMap(map, filteredData, vizType);
      if (!success) {
        console.error('Failed to recreate points source');
        return false;
      }
      return true; // Successfully recreated, no need to continue
    }

    // Prepare data based on visualization type
    let dataToUpdate = filteredData;
    if (vizType === 'pie-charts') {
      dataToUpdate = getSeparatePieChartData(filteredData) as any;
    }

    // Update the source data
    const source = map.getSource('points-source') as maplibregl.GeoJSONSource;
    if (source && source.setData) {
      source.setData(dataToUpdate);
    } else {
      console.error('Source does not have setData method');
      return false;
    }

    // Keep clustered-source in sync with filtered data (dots mode)
    const clusteredSource = map.getSource('clustered-source') as maplibregl.GeoJSONSource;
    if (clusteredSource && clusteredSource.setData) {
      clusteredSource.setData(filteredData);
    }

    // Handle pie chart specific updates
    if (vizType === 'pie-charts') {

      // Clean up existing pie chart images
      cleanupPieChartImages(map);

      // Regenerate pie chart symbols for the new filtered data
      await generatePieChartSymbols(map, filteredData, (loading) => {
        isLoading.set(loading);
        loadingMessage.set(loading ? 'Generating pie charts...' : 'Loading...');
      });

      // Update the layer's icon expression for the pie chart layer
      const iconExpression = generatePieChartIconExpression(filteredData) as any;

      try {
        if (map.getLayer('pie-charts')) {
          map.setLayoutProperty('pie-charts', 'icon-image', iconExpression);
        }
      } catch (e) {
        console.warn('Failed to update icon expression for pie charts layer:', e);
      }
    }

    // Ensure points are on top
    ensurePointsOnTop(map);
    
    // Call the Map component's ensureLayerOrder function if available
    // This ensures raster layers are properly ordered after filter changes
    const mapComponent = (window as any).__mapComponent;
    if (mapComponent && typeof mapComponent.ensureLayerOrder === 'function') {
      mapComponent.ensureLayerOrder();
    }

    return true;

  } catch (error) {
    console.error('Error updating map visualization:', error);
    return false;
  } finally {
    isUpdatingVisualization.set(false);
  }
}

// Helper function to ensure points are always on top of rasters
function ensurePointsOnTop(map: MaplibreMap) {
  if (!map) return;

  try {
    // First, ensure country boundaries are above rasters but below data layers
    if (map.getLayer('country-boundaries-layer')) {
      map.moveLayer('country-boundaries-layer');
    }

    // Cluster layers (order: circles first, then count labels, then individual points on top)
    if (map.getLayer('clusters')) map.moveLayer('clusters');
    if (map.getLayer('cluster-count')) map.moveLayer('cluster-count');

    // Individual dots / unclustered points
    if (map.getLayer('points-layer')) {
      map.moveLayer('points-layer');
    }

    // Single pie chart layer
    if (map.getLayer('pie-charts')) {
      map.moveLayer('pie-charts');
    }

    // Multiple pie chart layers (legacy, just in case)
    const pieChartLayerIds = ['pie-charts-large', 'pie-charts-medium', 'pie-charts-small'];
    pieChartLayerIds.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.moveLayer(layerId);
      }
    });
  } catch (e) {
    console.error('MapVisualizationManager: Error ensuring layer order:', e);
  }
}

// Radius of the smallest cluster circle (point_count = 2). Individual (unclustered)
// dots are sized relative to this so the two stay visually consistent if the
// cluster radius scale is ever retuned.
const CLUSTER_MIN_RADIUS = 16;
const INDIVIDUAL_DOT_RADIUS = Math.round(CLUSTER_MIN_RADIUS * 0.75);
const INDIVIDUAL_DOT_HOVER_BUMP = 3;

// Add the three cluster-mode layers (clusters circle, count label, unclustered point)
function addClusterLayers(map: MaplibreMap, visibility: 'visible' | 'none') {
  if (!map.getLayer('clusters')) {
    try {
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'clustered-source',
        filter: ['has', 'point_count'],
        layout: { visibility },
        paint: {
          // Grey ramp starting at the "Other: Mixed Design" base grey (#C0C0C0) for the
          // smallest clusters, darkening (toward black) as the cluster count grows.
          'circle-color': [
            'interpolate', ['linear'], ['get', 'point_count'],
            2,   '#c0c0c0',
            5,   '#9a9a9a',
            20,  '#737373',
            50,  '#4d4d4d',
            100, '#262626'
          ] as any,
          // Base size from point count, plus a small hover bump.
          'circle-radius': [
            '+',
            ['interpolate', ['linear'], ['get', 'point_count'],
              2,   CLUSTER_MIN_RADIUS,
              10,  22,
              50,  30,
              200, 42
            ],
            ['case', ['boolean', ['feature-state', 'hover'], false], 6, 0]
          ] as any,
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          // Darker shade of the same fill grey at each breakpoint, instead of flat black.
          'circle-stroke-color': [
            'interpolate', ['linear'], ['get', 'point_count'],
            2,   '#737373',
            5,   '#5c5c5c',
            20,  '#454545',
            50,  '#2e2e2e',
            100, '#171717'
          ] as any
        }
      });
    } catch (e) { console.warn('Failed to add clusters layer:', e); }
  }

  if (!map.getLayer('cluster-count')) {
    try {
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'clustered-source',
        filter: ['has', 'point_count'],
        layout: {
          visibility,
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
          'text-allow-overlap': true
        },
        paint: { 'text-color': '#ffffff' }
      });
    } catch (e) { console.warn('Failed to add cluster-count layer:', e); }
  }

  if (!map.getLayer('points-layer')) {
    try {
      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'clustered-source',
        filter: ['!', ['has', 'point_count']],
        layout: { visibility },
        paint: {
          'circle-radius': [
            'case', ['boolean', ['feature-state', 'hover'], false],
            INDIVIDUAL_DOT_RADIUS + INDIVIDUAL_DOT_HOVER_BUMP,
            INDIVIDUAL_DOT_RADIUS
          ] as any,
          'circle-color': generateDesignColorExpression() as any,
          'circle-opacity': 0.95,
          'circle-stroke-width': 2,
          'circle-stroke-color': generateDesignStrokeColorExpression() as any
        }
      });
    } catch (e) { console.warn('Failed to add points-layer:', e); }
  }
}

// Remove all cluster layers and the clustered source
function removeClusterLayers(map: MaplibreMap) {
  ['cluster-count', 'clusters', 'points-layer'].forEach(id => {
    try {
      if (map.getLayer(id)) map.removeLayer(id);
    } catch (e) { console.warn(`Failed to remove layer ${id}:`, e); }
  });
  try {
    if (map.getSource('clustered-source')) map.removeSource('clustered-source');
  } catch (e) { console.warn('Failed to remove clustered-source:', e); }
}

// Function to add initial points to map (called once when map is ready)
export async function addInitialPointsToMap(
  map: MaplibreMap | null,
  filteredData: PointFeatureCollection,
  vizType: VisualizationType,
  checkPointsAdded: boolean = true
): Promise<boolean> {

  if (!map) {
    return false;
  }

  if (!map.isStyleLoaded()) {
    return false;
  }

  // Check if we should verify points are not already added
  if (checkPointsAdded && get(pointsAddedToMap)) {
    return false;
  }

  if (filteredData.features.length === 0) {
    return false;
  }

  try {
    // Check if source already exists
    let sourceExists = false;
    try {
      sourceExists = !!map.getSource('points-source');
    } catch (e) {
      sourceExists = false;
    }

    if (sourceExists) {
      // Source exists — check if the correct layers are also in place
      const hasDotsLayers = !!map.getLayer('points-layer');
      const hasPieLayers = !!map.getLayer('pie-charts');
      const layersPresent = vizType === 'pie-charts' ? hasPieLayers : hasDotsLayers;

      if (layersPresent) {
        setPointsAddedToMap(true);
        return true;
      }

      // Wrong-type layers may be present — remove them before adding the correct type
      if (vizType === 'pie-charts' && hasDotsLayers) {
        removeClusterLayers(map);
      } else if (vizType !== 'pie-charts' && hasPieLayers) {
        removePieChartLayer(map);
        cleanupPieChartImages(map);
      }
      // Fall through to add correct-type layers
    }

    // Prepare data based on visualization type
    let dataToUse = filteredData;
    if (vizType === 'pie-charts') {
      dataToUse = getSeparatePieChartData(filteredData) as any;
    }

    // Add points-source only if it doesn't already exist
    if (!map.getSource('points-source')) {
      map.addSource('points-source', {
        type: 'geojson',
        data: dataToUse
      });
    } else {
      // Update existing source with current data
      (map.getSource('points-source') as maplibregl.GeoJSONSource).setData(dataToUse);
    }

    // Determine initial visibility from store so layers are born with the right state
    const initialVisibility: 'visible' | 'none' = get(dataPointsVisible) ? 'visible' : 'none';

    // Add layers based on visualization type
    if (vizType === 'pie-charts') {
      // Generate pie chart symbols first
      await generatePieChartSymbols(map, filteredData, (loading) => {
        isLoading.set(loading);
        loadingMessage.set(loading ? 'Generating pie charts...' : 'Loading...');
      });

      // Add single symbol layer — visibility baked in from the start
      createSinglePieChartLayer(map, filteredData, initialVisibility);
    } else {
      // Dots mode: separate clustered source so pie charts are never affected
      if (!map.getSource('clustered-source')) {
        map.addSource('clustered-source', {
          type: 'geojson',
          data: filteredData,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
          generateId: true
        });
      } else {
        (map.getSource('clustered-source') as maplibregl.GeoJSONSource).setData(filteredData);
      }

      addClusterLayers(map, initialVisibility);
    }

    setPointsAddedToMap(true);
    
    // Ensure correct layer ordering (data layers on top of rasters)
    ensurePointsOnTop(map);
    
    // Call the Map component's ensureLayerOrder function if available
    // This ensures raster layers are properly ordered
    const mapComponent = (window as any).__mapComponent;
    if (mapComponent && typeof mapComponent.ensureLayerOrder === 'function') {
      mapComponent.ensureLayerOrder();
    }
    
    // console.log('✅ Successfully added initial points to map');
    return true;

  } catch (error) {
    console.error('❌ Error adding initial points to map:', error);
    const errorDetails = error instanceof Error ? {
      message: error.message,
      stack: error.stack
    } : { message: String(error) };

    console.error('Error details:', {
      ...errorDetails,
      mapExists: !!map,
      mapLoaded: map?.loaded(),
      featuresCount: filteredData?.features?.length
    });
    return false;
  }
}

// Function to switch visualization type
export async function switchVisualizationType(
  map: MaplibreMap | null,
  currentType: VisualizationType,
  newType: VisualizationType,
  filteredData: PointFeatureCollection
): Promise<boolean> {

  if (!map || !map.isStyleLoaded() || currentType === newType) {
    return false;
  }

  isUpdatingVisualization.set(true);
  isProgrammaticSwitching.set(true); // Set flag

  try {
    // Update the visualization type store
    visualizationType.set(newType);

    // Remove existing layers based on current type
    if (currentType === 'pie-charts') {
      removePieChartLayer(map);
      cleanupPieChartImages(map);
    } else {
      // Dots mode: remove cluster layers and clustered source
      removeClusterLayers(map);
    }

    const switchVisibility: 'visible' | 'none' = get(dataPointsVisible) ? 'visible' : 'none';

    if (newType === 'pie-charts') {
      const dataToUse = getSeparatePieChartData(filteredData) as any;

      const source = map.getSource('points-source') as maplibregl.GeoJSONSource;
      if (source) source.setData(dataToUse);

      await generatePieChartSymbols(map, filteredData, (loading) => {
        isLoading.set(loading);
        loadingMessage.set(loading ? 'Generating pie charts...' : 'Loading...');
      });

      createSinglePieChartLayer(map, filteredData, switchVisibility);
    } else {
      // Dots mode: add clustered source + cluster layers
      const source = map.getSource('points-source') as maplibregl.GeoJSONSource;
      if (source) source.setData(filteredData);

      if (!map.getSource('clustered-source')) {
        map.addSource('clustered-source', {
          type: 'geojson',
          data: filteredData,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50,
          generateId: true
        });
      } else {
        (map.getSource('clustered-source') as maplibregl.GeoJSONSource).setData(filteredData);
      }

      addClusterLayers(map, switchVisibility);
    }

    ensurePointsOnTop(map);

    // Apply visibility setting from store after switching
    const visible = get(dataPointsVisible);
    applyDataPointsVisibility(map, visible);
    
    // Call the Map component's ensureLayerOrder function if available
    // This ensures raster layers are properly ordered after visualization switch
    const mapComponent = (window as any).__mapComponent;
    if (mapComponent && typeof mapComponent.ensureLayerOrder === 'function') {
      mapComponent.ensureLayerOrder();
    }

    return true;

  } catch (error) {
    console.error('Error switching visualization type:', error);
    return false;
  } finally {
    isProgrammaticSwitching.set(false); // Clear flag
    isUpdatingVisualization.set(false);
  }
}

// Function to force a visualization update (bypassing some checks)
export async function forceVisualizationUpdate(
  map: MaplibreMap | null,
  filteredData: PointFeatureCollection,
  vizType: VisualizationType,
  pointsAdded: boolean
): Promise<boolean> {
  const result = await updateMapVisualization(map, filteredData, vizType, pointsAdded);
  return result;
}

// Create a debounced update function that will be called with parameters
let debouncedUpdateFunction: ((map: MaplibreMap, filteredData: PointFeatureCollection, vizType: VisualizationType, pointsAdded: boolean) => void) | null = null;

export async function handleMapContentChange(
  map: MaplibreMap | null,
  filteredData: PointFeatureCollection,
  vizType: VisualizationType,
  pointsAdded: boolean
): Promise<boolean> {
  if (!map || !filteredData) {
    return false;
  }

  // Create debounced function if not exists
  if (!debouncedUpdateFunction) {
    debouncedUpdateFunction = debounce(async (
      mapParam: MaplibreMap,
      dataParam: PointFeatureCollection,
      vizParam: VisualizationType,
      pointsParam: boolean
    ) => {
      if (!pointsParam) {
        await addInitialPointsToMap(mapParam, dataParam, vizParam);
        return;
      }

      // If points are already added, update the visualization
      await updateMapVisualization(mapParam, dataParam, vizParam, pointsParam);
    }, 150);
  }

  // Call the debounced function with parameters
  debouncedUpdateFunction(map, filteredData, vizType, pointsAdded);
  return true;
}

// Helper function to generate design color expression
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

// Helper function to generate the individual dots' stroke color expression: each
// design type's own darker "_dark" swatch (already defined alongside the base
// colors in pieChartUtils.ts), instead of a flat black outline.
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
