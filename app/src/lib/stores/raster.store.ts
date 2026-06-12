import { writable, get } from 'svelte/store';
import type { RasterLayer } from '$lib/types';
import { toastStore } from '$lib/stores/toast.store';
import { loadAndProcessGeoTIFF } from '$lib/components/Map/utils/geoTiffProcessor';
import { loadRasterConfig, getLayerSourceUrl, getLayerId, configToMetadata } from '$lib/services/rasterConfig';

// Main store for all raster layers — starts empty, populated by loadRasterLayersFromConfig()
export const rasterLayers = writable<Map<string, RasterLayer>>(new Map());

// Track whether config has been loaded
export const rasterConfigLoaded = writable<boolean>(false);

// Debug mode store for visualizing data positioning
export const rasterDebugMode = writable<boolean>(false);

/**
 * Fetch raster-layers.json and populate the raster layers store.
 * Called once at app startup (from MapSidebar onMount).
 */
export async function loadRasterLayersFromConfig(): Promise<void> {
  const config = await loadRasterConfig();
  const layerMap = new Map<string, RasterLayer>();

  for (const layerConfig of config.layers) {
    const sourceUrl = getLayerSourceUrl(layerConfig.path);
    const id = getLayerId(layerConfig.path);
    const layerMetadata = configToMetadata(layerConfig);

    const layer: RasterLayer = {
      id,
      name: layerConfig.name,
      sourceUrl,
      isVisible: false,
      opacity: 0.8,
      bounds: undefined,
      isLoading: false,
      error: null,
      colormap: 'viridis',
      layerMetadata
    };
    layerMap.set(id, layer);
  }

  rasterLayers.set(layerMap);
  rasterConfigLoaded.set(true);
}

// --- Raster Layer Helper Functions ---

export async function addRasterLayerFromUrl(url: string): Promise<void> {
  const layerId = `cog-url-${Date.now()}`;

  const tempLayer: RasterLayer = {
    id: layerId,
    name: `Loading: ${url.substring(url.lastIndexOf('/') + 1)}...`,
    sourceUrl: url,
    isVisible: true,
    opacity: 0.8,
    isLoading: true,
    error: null,
    colormap: 'viridis',
    layerMetadata: undefined
  };

  rasterLayers.update((layers) => {
    layers.set(layerId, tempLayer);
    return new Map(layers);
  });

  try {
    const debugMode = get(rasterDebugMode);
    const { dataUrl, metadata, bounds, rasterData, width, height, rescaleUsed } = await loadAndProcessGeoTIFF(url, {
      debugMode: debugMode
    });
    const finalLayer: RasterLayer = {
      ...tempLayer,
      name: url.substring(url.lastIndexOf('/') + 1),
      dataUrl: dataUrl,
      bounds: bounds as [number, number, number, number],
      metadata: metadata,
      rasterData: rasterData,
      width: width,
      height: height,
      isLoading: false,
      rescale: rescaleUsed
    };
    rasterLayers.update((layers) => {
      layers.set(layerId, finalLayer);
      return new Map(layers);
    });
    toastStore.success(`Loaded layer: ${finalLayer.name}`);
  } catch (err: any) {
    const errorMessage = err.message || 'Failed to load or process GeoTIFF.';
    rasterLayers.update((layers) => {
      const layerWithError = layers.get(layerId);
      if (layerWithError) {
        layerWithError.isLoading = false;
        layerWithError.error = errorMessage;
        layerWithError.name = `Error loading: ${url.substring(url.lastIndexOf('/') + 1)}`;
      }
      return new Map(layers);
    });
    toastStore.error(errorMessage);
  }
}

export async function fetchAndSetLayerBounds(layerId: string): Promise<void> {
  const layers = get(rasterLayers);
  const layer = layers.get(layerId);

  // Force refetch if bounds are the old incorrect values
  const hasIncorrectBounds = layer?.bounds &&
    layer.bounds[1] === -56 &&
    layer.bounds[3] === 72;

  if (!layer || (!hasIncorrectBounds && layer.bounds && layer.dataUrl) || layer.isLoading) {
    return;
  }

  rasterLayers.update((currentLayers) => {
    const layerToUpdate = currentLayers.get(layerId);
    if (layerToUpdate) {
      layerToUpdate.isLoading = true;
      layerToUpdate.error = null;
    }
    return new Map(currentLayers);
  });

  try {
    const debugMode = get(rasterDebugMode);
    const { dataUrl, metadata, bounds, rasterData, width, height, rescaleUsed } = await loadAndProcessGeoTIFF(layer.sourceUrl, {
      debugMode: debugMode
    });
    rasterLayers.update((currentLayers) => {
      const layerToUpdate = currentLayers.get(layerId);
      if (layerToUpdate) {
        layerToUpdate.bounds = bounds as [number, number, number, number];
        layerToUpdate.dataUrl = dataUrl;
        layerToUpdate.metadata = metadata;
        layerToUpdate.rasterData = rasterData;
        layerToUpdate.width = width;
        layerToUpdate.height = height;
        layerToUpdate.isLoading = false;
        layerToUpdate.rescale = rescaleUsed;
      }
      return new Map(currentLayers);
    });
  } catch (err: any) {
    const errorMessage = err.message || 'Failed to process GeoTIFF.';
    rasterLayers.update((currentLayers) => {
      const layerToUpdate = currentLayers.get(layerId);
      if (layerToUpdate) {
        layerToUpdate.isLoading = false;
        layerToUpdate.error = errorMessage;
        layerToUpdate.name = `Error: ${layerToUpdate.name}`;
      }
      return new Map(currentLayers);
    });
    toastStore.error(`Error processing GeoTIFF for ${layer?.name || layerId}: ${errorMessage}`);
  }
}

export function updateRasterLayerVisibility(id: string, isVisible: boolean): void {
  rasterLayers.update((layers) => {
    const layer = layers.get(id);
    if (layer) {
      layer.isVisible = isVisible;
    }
    return new Map(layers);
  });
}

export function updateRasterLayerIsActive(id: string, isActive: boolean): void {
  rasterLayers.update((layers) => {
    const layer = layers.get(id);
    if (layer) {
      layer.isActive = isActive;
      // When deactivating, also stop rendering it on the map
      if (!isActive) layer.isVisible = false;
    }
    return new Map(layers);
  });
}

export function updateRasterLayerOpacity(id: string, opacity: number): void {
  rasterLayers.update((layers) => {
    const layer = layers.get(id);
    if (layer) {
      layer.opacity = Math.max(0, Math.min(1, opacity));
    }
    return new Map(layers); // Create new Map instance for reactivity
  });
}

export function updateAllRasterLayersOpacity(opacity: number): void {
  rasterLayers.update((layers) => {
    layers.forEach((layer) => {
      if (layer.isVisible) {
        layer.opacity = Math.max(0, Math.min(1, opacity));
      }
    });
    return new Map(layers); // Create new Map instance for reactivity
  });
}

export function removeRasterLayer(id: string): void {
  rasterLayers.update((layers) => {
    layers.delete(id);
    return new Map(layers);
  });
}

export function toggleDebugMode(): void {
  rasterDebugMode.update(mode => !mode);
}

