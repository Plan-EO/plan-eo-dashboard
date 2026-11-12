import { writable, get } from 'svelte/store';
import type { RasterLayer } from '$lib/types';
import { toastStore } from '$lib/stores/toast.store';
import { loadAndProcessGeoTIFF, recolorRasterData, COLORMAPS, DEFAULT_COLORMAP } from '$lib/components/Map/utils/geoTiffProcessor';

// Display label overrides for color-scale ids whose auto-derived (title-cased)
// label isn't what we want shown in the picker. Omit an id here to just
// title-case it automatically.
const COLORMAP_LABEL_OVERRIDES: Record<string, string> = {
  paper: 'Paper' // placeholder name until there's a better one for this scale
};

// Color scales available in the Active Layers color-scale picker. Keyed by the
// name stored on RasterLayer.colormap; add an entry here (and to COLORMAPS in
// geoTiffProcessor.ts) when a new scale is implemented.
export const AVAILABLE_COLORMAPS: { id: string; label: string }[] = Object.keys(COLORMAPS).map((id) => ({
  id,
  label:
    COLORMAP_LABEL_OVERRIDES[id] ??
    id
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
}));
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
      colormap: DEFAULT_COLORMAP,
      colormapReversed: false,
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
    colormap: DEFAULT_COLORMAP,
    colormapReversed: false,
    layerMetadata: undefined
  };

  rasterLayers.update((layers) => {
    layers.set(layerId, tempLayer);
    return new Map(layers);
  });

  try {
    const debugMode = get(rasterDebugMode);
    const { dataUrl, metadata, bounds, rasterData, width, height, rescaleUsed } = await loadAndProcessGeoTIFF(url, {
      debugMode: debugMode,
      colormap: tempLayer.colormap,
      reversed: tempLayer.colormapReversed
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
      debugMode: debugMode,
      colormap: layer.colormap,
      reversed: layer.colormapReversed
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

/**
 * Change a raster layer's color scale and/or invert it. Recolors from the
 * already-decoded rasterData cached on the layer, so this doesn't need to
 * re-fetch or re-decode the source GeoTIFF.
 */
export function updateRasterLayerColormap(
  id: string,
  updates: { colormap?: string; reversed?: boolean }
): void {
  rasterLayers.update((layers) => {
    const layer = layers.get(id);
    if (!layer) return layers;

    if (updates.colormap !== undefined) layer.colormap = updates.colormap;
    if (updates.reversed !== undefined) layer.colormapReversed = updates.reversed;

    if (layer.rasterData && layer.width && layer.height && layer.rescale) {
      layer.dataUrl = recolorRasterData(
        layer.rasterData,
        layer.width,
        layer.height,
        layer.rescale,
        layer.colormap,
        layer.colormapReversed
      );
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

