import type { Map as MaplibreMap } from 'maplibre-gl';
import type { RasterLayer } from '$lib/types';
import { fetchAndSetLayerBounds } from '$lib/stores/raster.store';

/**
 * Synchronize raster layers with the map
 * @param layersInStore Map of raster layers from the store
 * @param currentMap The map instance
 * @param styleLoaded Whether the map style is loaded
 * @param currentMapLayers Set of layer IDs currently on the map
 * @param onLayerAdded Callback when a layer is added
 */
export function syncRasterLayers(
  layersInStore: Map<string, RasterLayer>,
  currentMap: MaplibreMap | null,
  styleLoaded: boolean,
  currentMapLayers: Set<string>,
  onLayerAdded?: () => void
): void {
  if (!currentMap || !styleLoaded) return;

  const layersOnMap = new Set(currentMapLayers);

  // Iterate through layers defined in the store
  layersInStore.forEach((layer: RasterLayer) => {
    const layerId = layer.id;
    const sourceId = layer.id; // Use the same ID for source and layer for simplicity

    const layerShouldBeVisible = layer.isVisible;
    const layerIsCurrentlyOnMap = currentMap.getLayer(layerId);

    if (layersOnMap.has(layerId) && layerIsCurrentlyOnMap) {
      // Layer exists on map
      if (!layerShouldBeVisible) {
        // Layer should be hidden, but it's on the map -> Remove it
        try {
          // Remove existing layer and source using currentMap
          if (currentMap.getLayer(layerId)) currentMap.removeLayer(layerId);
          if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId);
          currentMapLayers.delete(layerId); // Untrack
        } catch (e) {
          console.error(`Map: Error removing layer ${layerId} for visibility:`, e);
        }
      } else {
        // Visible and already on map: keep source/layer in sync with latest bounds/image
        try {
          if (layer.bounds && currentMap.getSource(sourceId)) {
            const [west, south, east, north] = layer.bounds;
            const coords: [
              [number, number],
              [number, number],
              [number, number],
              [number, number]
            ] = [
                [west, north],
                [east, north],
                [east, south],
                [west, south]
              ];
            const src = currentMap.getSource(sourceId) as any;
            if (typeof src.setCoordinates === 'function') {
              src.setCoordinates(coords);
            }
            // If a new dataUrl is available, refresh the image as well
            if (layer.dataUrl && typeof src.updateImage === 'function') {
              src.updateImage({ url: layer.dataUrl });
            }
          }
        } catch (e) {
          console.error(`Map: Error syncing existing layer ${layerId}:`, e);
        }
      }
      // Opacity is handled separately
      layersOnMap.delete(layerId); // Mark as processed
    } else if (layerShouldBeVisible && !layerIsCurrentlyOnMap) {
      // Layer should be visible, but isn't on map -> Add it OR fetch bounds
      // --- Check if bounds need fetching ---
      if (!layer.bounds && !layer.isLoading && !layer.error) {
        fetchAndSetLayerBounds(layerId); // Call the fetch function
        // Don't try to add the layer yet, wait for bounds to be set by the store update
      }
      // --- Check if ready to add (bounds exist, not loading, no error) ---
      else if (!layer.isLoading && !layer.error && layer.bounds) {
        try {
          // Add source if it doesn't exist (bounds check already done)
          if (!currentMap?.getSource(sourceId)) {
            // Use image source type with fetched bounds
            if (!layer.dataUrl) {
              console.error(`Raster: Missing dataUrl for layer ${layerId}`);
              throw new Error(`Missing dataUrl for layer ${layerId}`);
            }
            const imageUrl = layer.dataUrl; // This now holds the processed GeoTIFF data URL

            // Extract and validate bounds
            let west = layer.bounds[0];
            let south = layer.bounds[1];
            let east = layer.bounds[2];
            let north = layer.bounds[3];


            // Create coordinates array for the image corners using standard lng,lat order
            // The order is critical: top-left, top-right, bottom-right, bottom-left
            const coordinates: [
              [number, number],
              [number, number],
              [number, number],
              [number, number]
            ] = [
                [west, north], // top-left [lng, lat]
                [east, north], // top-right
                [east, south], // bottom-right
                [west, south] // bottom-left
              ];

            // Check for global bounds (±90° latitude)
            const isGlobalBounds =
              layer.bounds[0] === -180 &&
              layer.bounds[1] === -90 &&
              layer.bounds[2] === 180 &&
              layer.bounds[3] === 90;

            if (isGlobalBounds) {
              // Using image source with global bounds
            }

            // Define sourceDef WITH coordinates, as layer.bounds is guaranteed here
            const sourceDef: maplibregl.ImageSourceSpecification = {
              type: 'image',
              url: imageUrl,
              coordinates: coordinates // Always include coordinates
            };

            currentMap?.addSource(sourceId, sourceDef);
          }

          // Add layer if source exists and layer doesn't
          if (currentMap?.getSource(sourceId) && !currentMap?.getLayer(layerId)) {
            currentMap?.addLayer({
              id: layerId,
              type: 'raster', // Still use raster layer type for rendering controls like opacity
              source: sourceId,
              paint: {
                'raster-opacity': layer.opacity, // Set initial opacity
                'raster-resampling': 'nearest' // Use nearest neighbor resampling for sharp pixels
              },
              layout: {
                visibility: 'visible' // Add as visible
              }
            });

            currentMapLayers.add(layerId); // Track the added layer

            // Immediately move data point layers to the top so they're never covered by rasters
            const dataPointLayerIds = [
              'points-layer',
              'pie-charts',
              'pie-charts-large',
              'pie-charts-medium',
              'pie-charts-small'
            ];
            dataPointLayerIds.forEach(id => {
              if (currentMap?.getLayer(id)) currentMap?.moveLayer(id);
            });

            // Call the onLayerAdded callback if provided
            if (onLayerAdded) {
              onLayerAdded();
            }

            // Optionally fit bounds only if specific bounds were used
            const isGlobalBounds =
              layer.bounds[0] === -180 &&
              layer.bounds[1] === -90 &&
              layer.bounds[2] === 180 &&
              layer.bounds[3] === 90;
            if (layer.bounds && !isGlobalBounds) {
              // Convert bounds to LngLatBoundsLike format
              const boundsForFit: maplibregl.LngLatBoundsLike = [
                [layer.bounds[0], layer.bounds[1]],
                [layer.bounds[2], layer.bounds[3]]
              ];
              currentMap?.fitBounds(boundsForFit, { padding: 50, duration: 500 });
            }
          }
        } catch (error) {
          console.error(`Raster: Error adding image source/layer ${layerId}:`, error);
          // Clean up if partially added
          if (currentMap?.getLayer(layerId)) currentMap.removeLayer(layerId);
          if (currentMap?.getSource(sourceId)) currentMap.removeSource(sourceId);
        }
      }
    }
  });

  // Remove layers that are on the map but no longer in the store
  layersOnMap.forEach((layerIdToRemove) => {
    try {
      if (currentMap?.getLayer(layerIdToRemove)) {
        currentMap.removeLayer(layerIdToRemove);
      }
      const sourceIdToRemove = layerIdToRemove; // Assuming source ID matches layer ID
      if (currentMap?.getSource(sourceIdToRemove)) {
        currentMap.removeSource(sourceIdToRemove);
      }
      currentMapLayers.delete(layerIdToRemove); // Untrack
    } catch (error) {
      console.error(`Raster: Error removing layer/source ${layerIdToRemove}:`, error);
    }
  });
}

/**
 * Update raster layer opacity
 * @param map The map instance
 * @param styleLoaded Whether the map style is loaded
 * @param rasterLayers Map of raster layers from the store
 */
export function updateRasterLayerOpacity(
  map: MaplibreMap | null,
  styleLoaded: boolean,
  rasterLayers: Map<string, RasterLayer>
): void {
  if (!map || !styleLoaded) return;

  rasterLayers.forEach((layer: RasterLayer) => {
    const layerId = layer.id;
    if (map && map.getLayer(layerId)) {
      try {
        const currentOpacity = map.getPaintProperty(layerId, 'raster-opacity') ?? 1;
        if (currentOpacity !== layer.opacity) {
          map.setPaintProperty(layerId, 'raster-opacity', layer.opacity);
        }
      } catch (error) {
        // Ignore errors if layer doesn't exist (might happen during transitions)
        if (error instanceof Error && !error.message.includes('does not exist')) {
          console.error(`Map (Opacity): Error updating opacity for layer ${layerId}:`, error);
        } else if (!(error instanceof Error)) {
          console.error(
            `Map (Opacity): Non-standard error updating opacity for layer ${layerId}:`,
            error
          );
        }
      }
    }
  });
}
