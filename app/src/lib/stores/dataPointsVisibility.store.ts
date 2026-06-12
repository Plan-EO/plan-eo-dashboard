import { writable } from 'svelte/store';
import type { Map as MaplibreMap } from 'maplibre-gl';

// Defaults to false — LayerManager (or DataExplorer's onMount) explicitly enables visibility
export const dataPointsVisible = writable<boolean>(false);

// Function to toggle data points visibility
export function toggleDataPointsVisibility(): void {
  dataPointsVisible.update(visible => !visible);
}

// Function to update data points visibility
export function updateDataPointsVisibility(visible: boolean): void {
  dataPointsVisible.set(visible);
}

// Function to apply visibility to all point layers on the map
export function applyDataPointsVisibility(map: MaplibreMap | null, visible: boolean): void {
  if (!map || !map.isStyleLoaded()) return;

  // List of all possible point layer IDs
  const pointLayerIds = [
    'points-layer', // Dots visualization
    'pie-charts' // Single pie chart layer with dynamic sorting
  ];

  // Apply visibility to each layer if it exists
  pointLayerIds.forEach(layerId => {
    if (map.getLayer(layerId)) {
      try {
        map.setLayoutProperty(
          layerId, 
          'visibility', 
          visible ? 'visible' : 'none'
        );
      } catch (error) {
        console.warn(`Failed to update visibility for layer ${layerId}:`, error);
      }
    }
  });
}