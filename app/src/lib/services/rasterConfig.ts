import type { RasterLayerMetadata } from '$lib/types';
import fallbackRasterConfig from '$lib/data/raster-layers-fallback.json';

export interface RasterLayerConfig {
  name: string;
  path: string;
  type: 'Pathogen' | 'Risk Factor';
  // Pathogen-specific fields (used for filter mapping)
  pathogen?: string;
  ageGroup?: string;
  syndrome?: string;
  // Risk factor categorization
  category?: 'Housing' | 'Animal Intervention' | string;
  // Metadata fields
  indicator?: string;
  definition?: string;
  period?: string;
  study?: string;
  source?: string;
  hyperlink?: string;
  popupHeading?: string;
  popupSubheading?: string;
  panelHeading?: string;
  panelSubheading?: string;
}

export interface RasterConfig {
  layers: RasterLayerConfig[];
}

// Public R2 bucket that mirrors the COG layout (01_Pathogens/, 02_Risk_factors/, ...)
// Used both as the default base URL and as the fallback when the primary source is unreachable.
const R2_COGS_URL = 'https://pub-6e8836a7d8be4fd1adc1317bb416ad75.r2.dev/cogs/';

// Primary source: Research Computing storage in production (VITE_RASTER_BASE_URL=/data/cogs/),
// or R2 by default for local dev.
const primaryRasterUrl = import.meta.env.VITE_RASTER_BASE_URL || R2_COGS_URL;

let cachedConfig: RasterConfig | null = null;

// Base URL actually used to build layer source URLs, set once loadRasterConfig() resolves.
let activeBaseUrl = primaryRasterUrl;

/** Test-only helper to clear the cached config between test cases. */
export function __resetRasterConfigCache(): void {
  cachedConfig = null;
  activeBaseUrl = primaryRasterUrl;
}

/**
 * Fetch and parse raster-layers.json from the data directory.
 * Returns cached result on subsequent calls within the same page load.
 *
 * If the primary source (e.g. RC storage mounted at /data/cogs/) doesn't have
 * raster-layers.json, falls back to a bundled copy of the config and serves the
 * actual .tif files from the public R2 bucket instead.
 */
export async function loadRasterConfig(): Promise<RasterConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const response = await fetch(`${primaryRasterUrl}raster-layers.json`);
    if (response.ok) {
      activeBaseUrl = primaryRasterUrl;
      cachedConfig = await response.json();
      return cachedConfig!;
    }
    console.warn(`Failed to load raster-layers.json from ${primaryRasterUrl} (${response.status}). Falling back to bundled config + R2-hosted rasters.`);
  } catch (err) {
    console.warn(`Could not fetch raster-layers.json from ${primaryRasterUrl}:`, err);
  }

  activeBaseUrl = R2_COGS_URL;
  cachedConfig = fallbackRasterConfig as RasterConfig;
  return cachedConfig;
}

/** Build a full source URL from a layer's relative path */
export function getLayerSourceUrl(layerPath: string): string {
  return `${activeBaseUrl}${layerPath}`;
}

/** Generate a stable layer ID from a layer's relative path */
export function getLayerId(layerPath: string): string {
  const sourceUrl = getLayerSourceUrl(layerPath);
  return `cog-${sourceUrl.replace(/[\/\.]/g, '-')}`;
}

/** Convert a RasterLayerConfig to RasterLayerMetadata */
export function configToMetadata(config: RasterLayerConfig): RasterLayerMetadata {
  return {
    type: config.type,
    variableName: config.pathogen || config.category || config.name,
    fileName: config.path.split('/').pop()?.replace(/\.tif$/i, '') || config.name,
    ageGroup: config.ageGroup,
    syndrome: config.syndrome,
    indicator: config.indicator,
    definition: config.definition,
    period: config.period,
    study: config.study,
    source: config.study,
    hyperlink: config.hyperlink,
    popupHeading: config.popupHeading,
    popupSubheading: config.popupSubheading,
    panelHeading: config.panelHeading,
    panelSubheading: config.panelSubheading
  };
}
