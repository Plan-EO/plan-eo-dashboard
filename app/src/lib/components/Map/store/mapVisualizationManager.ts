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

    // Then move data visualization layers to top
    // Order matters - last moved will be on top
    
    // Dots layer
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
      // If source exists but pointsAdded is false, it means we're in an inconsistent state
      // Fix this by setting pointsAdded to true
      setPointsAddedToMap(true);
      return true; // Return true since the source is already there
    }

    // Prepare data based on visualization type
    let dataToUse = filteredData;
    if (vizType === 'pie-charts') {
      dataToUse = getSeparatePieChartData(filteredData) as any;
    }

    // Add the source
    map.addSource('points-source', {
      type: 'geojson',
      data: dataToUse
    });

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
      // Add circle layer for dots
      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'points-source',
        layout: { 'visibility': initialVisibility },
        paint: {
          'circle-radius': 7,
          'circle-color': generateDesignColorExpression() as any,
          'circle-opacity': 0.9,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff'
        }
      });
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
      // Remove pie chart layer
      removePieChartLayer(map);
      cleanupPieChartImages(map);
    } else {
      // Remove circle layer (dots)
      if (map.getLayer('points-layer')) {
        map.removeLayer('points-layer');
      }
    }

    // Add new layers
    let dataToUse = filteredData;

    if (newType === 'pie-charts') {
      dataToUse = getSeparatePieChartData(filteredData) as any;

      // Update source data
      const source = map.getSource('points-source') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(dataToUse);
      }

      // Generate pie chart symbols
      await generatePieChartSymbols(map, filteredData, (loading) => {
        isLoading.set(loading);
        loadingMessage.set(loading ? 'Generating pie charts...' : 'Loading...');
      });

      // Add single pie chart layer — visibility baked in from the start
      const switchVisibility: 'visible' | 'none' = get(dataPointsVisible) ? 'visible' : 'none';
      createSinglePieChartLayer(map, filteredData, switchVisibility);
    } else {
      // Update source data for dots
      const source = map.getSource('points-source') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(dataToUse);
      }

      // Add circle layer — visibility baked in from the start
      const switchVisibility: 'visible' | 'none' = get(dataPointsVisible) ? 'visible' : 'none';
      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'points-source',
        layout: { 'visibility': switchVisibility },
        paint: {
          'circle-radius': 7,
          'circle-color': generateDesignColorExpression() as any,
          'circle-opacity': 0.9,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff'
        }
      });
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
