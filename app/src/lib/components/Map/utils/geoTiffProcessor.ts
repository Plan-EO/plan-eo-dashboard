// Import geotiff from CDN for static deployments
import { browser } from '$app/environment';

// Access the global geotiff library that's loaded via CDN in app.html
declare global {
  interface Window {
    GeoTIFF: any;
  }
}

/**
 * Interface for GeoTIFF metadata
 */
export interface GeoTIFFMetadata {
  width: number;
  height: number;
  bounds: number[];
  resolution: number[];
  samplesPerPixel: number;
  [key: string]: any;
}

/**
 * Interface for GeoTIFF processing options
 */
export interface ProcessingOptions {
  colormap?: string; // e.g., 'viridis'
  reversed?: boolean; // If true, flip which end of the scale represents high values
  rescale?: [number, number]; // Min/max values for rescaling
  noDataValue?: number; // Value to treat as transparent
  noDataThreshold?: number; // Threshold for treating values as no-data (e.g., 0.01)
  debugMode?: boolean; // If true, show black pixels for all data locations
}

/**
 * Default viridis colormap similar to what TiTiler uses
 */
export const VIRIDIS_COLORMAP = [
  [68, 1, 84], // Dark purple
  [72, 40, 120], // Purple
  [62, 73, 137], // Blue
  [49, 104, 142], // Light blue
  [38, 130, 142], // Cyan
  [31, 158, 137], // Teal
  [53, 183, 121], // Green
  [109, 205, 89], // Light green
  [180, 222, 44], // Yellow-green
  [253, 231, 37] // Yellow
];

/**
 * Approximate "plasma" colormap (dark blue-purple -> orange -> yellow).
 * Hand-picked stops in the style of matplotlib's plasma, not copied from its
 * exact lookup table -- fine for now, but re-source from a verified LUT
 * (e.g. d3-scale-chromatic) if exact scale fidelity ever matters (e.g. for a
 * publication figure).
 */
export const PLASMA_COLORMAP = [
  [13, 8, 135],
  [75, 3, 161],
  [125, 3, 168],
  [168, 34, 150],
  [203, 70, 121],
  [229, 107, 93],
  [248, 148, 65],
  [253, 195, 40],
  [240, 249, 33]
];

/**
 * Approximate "magma" colormap (near-black -> purple -> orange -> pale yellow).
 * Same caveat as PLASMA_COLORMAP above: hand-picked approximation, not an
 * exact copy of matplotlib's LUT.
 */
export const MAGMA_COLORMAP = [
  [0, 0, 4],
  [28, 16, 68],
  [79, 18, 123],
  [129, 37, 129],
  [181, 54, 122],
  [229, 80, 100],
  [251, 135, 97],
  [254, 194, 135],
  [252, 253, 191]
];

/**
 * 9-stop scale from a paper the PI shared (Shigella prevalence bins), given
 * as approximate hex codes and converted to RGB here: dark purple (low) ->
 * pale peach/orange -> dark brown (high). Not tied to Shigella specifically --
 * usable for any raster, same as the other scales. Labeled "Paper colorscale"
 * in the picker (see COLORMAP_LABELS in raster.store.ts) as a placeholder
 * until there's a more specific name for it.
 */
export const PAPER_COLORMAP = [
  [34, 20, 71],    // #221447 very dark purple
  [79, 53, 143],   // #4F358F deep purple
  [123, 117, 169], // #7B75A9 muted purple
  [166, 162, 202], // #A6A2CA light lavender
  [249, 222, 183], // #F9DEB7 pale peach
  [240, 182, 116], // #F0B674 light orange
  [213, 137, 65],  // #D58941 orange
  [166, 96, 50],   // #A66032 burnt orange/brown
  [114, 65, 33]    // #724121 dark brown
];

/**
 * Registry of available colormaps, keyed by the name stored on RasterLayer.colormap.
 * Add new scales here as they're implemented -- the Active Layers color-scale
 * picker (LayerManager.svelte) reads from this same list.
 */
export const COLORMAPS: Record<string, number[][]> = {
  viridis: VIRIDIS_COLORMAP,
  plasma: PLASMA_COLORMAP,
  magma: MAGMA_COLORMAP,
  paper: PAPER_COLORMAP
};

export const DEFAULT_COLORMAP = 'paper';

/**
 * The exact color a given value would be rendered as on the raster, as a
 * CSS "rgb(...)" string -- for UI elements that should match the raster's
 * current color scale (e.g. the prevalence badge in MapPopover.svelte),
 * rather than always using a fixed set of colors.
 */
export function getColormapColorCss(
  value: number,
  rescale: [number, number],
  colormapName: string = DEFAULT_COLORMAP,
  reversed: boolean = false
): string {
  const [r, g, b] = getColorFromColormap(value, rescale, colormapName, reversed);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * CSS linear-gradient string previewing a named colormap, for swatches in the
 * color-scale picker (LayerManager.svelte). Mirrors the reversed logic used
 * when actually coloring raster pixels, so the swatch matches what's on the map.
 */
export function getColormapGradientCss(
  colormapName: string = DEFAULT_COLORMAP,
  reversed: boolean = false
): string {
  const colormap = COLORMAPS[colormapName] || VIRIDIS_COLORMAP;
  const ordered = reversed ? [...colormap].slice().reverse() : colormap;
  const stops = ordered.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * Load a GeoTIFF from a URL and return the image and metadata
 */
export async function loadGeoTIFF(url: string): Promise<{
  image: any;
  metadata: GeoTIFFMetadata;
}> {

  // Check if we're in the browser and GeoTIFF is available globally
  if (!browser) {
    throw new Error('GeoTIFF processing is only available in browser environments');
  }

  // Use the global GeoTIFF library loaded from CDN in app.html
  let tiff;
  try {
    // First try using the global window.GeoTIFF
    if (window.GeoTIFF && typeof window.GeoTIFF.fromUrl === 'function') {
      tiff = await window.GeoTIFF.fromUrl(url);
    }
    // Fallback to try accessing it from the global scope
    else if (typeof (window as any).GeoTIFF !== 'undefined' && typeof (window as any).GeoTIFF.fromUrl === 'function') {
      tiff = await (window as any).GeoTIFF.fromUrl(url);
    }
    // If neither approach works, try dynamic import as last resort
    else {
      try {
        const module = await import('geotiff');
        tiff = await module.fromUrl(url);
      } catch (e) {
        console.error('Failed to import geotiff dynamically:', e);
        throw new Error('GeoTIFF library not available');
      }
    }
  } catch (error) {
    console.error('Error loading GeoTIFF:', error);
    throw new Error(`Failed to load GeoTIFF from URL: ${url}`);
  }

  if (!tiff) {
    throw new Error('Failed to load GeoTIFF library');
  }

  const image = await tiff.getImage();

  // Extract metadata
  const imageWidth = image.getWidth();
  const imageHeight = image.getHeight();
  const imageBounds = image.getBoundingBox();

  // Additional check for projection info
  try {
    const geoKeys = image.getGeoKeys();
    if (geoKeys) {
    }
  } catch (e) {
  }

  const metadata: GeoTIFFMetadata = {
    width: imageWidth,
    height: imageHeight,
    bounds: imageBounds as number[],
    resolution: image.getResolution(),
    samplesPerPixel: image.getSamplesPerPixel()
  };

  return { image, metadata };
}

/**
 * Function to convert Web Mercator coordinates to Lat/Lng
 */
export function mercatorToLatLng(mercatorX: number, mercatorY: number): [number, number] {
  // Earth's radius in meters at the equator
  const earthRadius = 6378137;

  // Convert X coordinate from meters to longitude in degrees
  const lng = (mercatorX / earthRadius) * (180 / Math.PI);

  // Convert Y coordinate from meters to latitude in degrees
  // Using the inverse Mercator projection formula
  const lat = (Math.PI / 2 - 2 * Math.atan(Math.exp(-mercatorY / earthRadius))) * (180 / Math.PI);

  // Clamp to valid lat/lng range
  const clampedLng = Math.max(-180, Math.min(180, lng));
  // Web Mercator mathematically limits at ±85.051129°
  // We clamp to this limit to accurately represent data availability
  const clampedLat = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, lat));

  return [clampedLng, clampedLat];
}

/**
 * Web Mercator projection's maximum latitude extent
 * Beyond this latitude, Web Mercator projection cannot represent data
 */
export const WEB_MERCATOR_MAX_LATITUDE = 85.051129;

/**
 * Function to convert Lat/Lng coordinates to Web Mercator (meters)
 */
export function latLngToMercator(lng: number, lat: number): [number, number] {
  // Earth's radius in meters at the equator
  const earthRadius = 6378137;

  // Clamp latitude to valid Web Mercator range
  const clampedLat = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, lat));

  // Convert longitude from degrees to meters
  const mercatorX = (lng * earthRadius * Math.PI) / 180;

  // Convert latitude from degrees to meters using Mercator projection formula
  const mercatorY = earthRadius * Math.log(Math.tan((Math.PI / 4) + (clampedLat * Math.PI / 360)));

  return [mercatorX, mercatorY];
}

/**
 * Standard GoogleMapsCompatible/Web Mercator tile extent in WGS84.
 * Many global COGs (at low zoom levels) cover only this latitude band (±66.51326°).
 */
const WEB_MERCATOR_TILE_BOUNDS_WGS84: [number, number, number, number] = [
  -180, -66.51326044311186, 180, 66.51326044311186
];

// Corresponding extent in meters for quick detection when bounds are in EPSG:3857
const WEB_MERCATOR_TILE_BOUNDS_M = {
  xMin: -20037508.34,
  xMax: 20037508.34,
  yMin: -10018754.17,
  yMax: 10018754.17
};

function approx(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol;
}

/**
 * Validate and adjust bounds if needed, including handling latitude limits for global bounds
 * @param bounds The bounds to validate
 * @param projectionInfo Optional projection information (e.g., 'EPSG:3857')
 */
export function validateBounds(bounds: number[], projectionInfo?: string): number[] {
  // Initialize bounds with a default value to avoid null issues
  if (!bounds || bounds.length !== 4) {
    console.warn('GeoTIFF Processor: Missing or invalid bounds, using Web Mercator tile bounds');
    // Use standard Web Mercator tile extent, not full ±90°
    return [-180, -66.51326044311186, 180, 66.51326044311186];
  }


  // Check if projection is Web Mercator or if coordinates are outside WGS84 range
  const isWebMercator = projectionInfo === 'EPSG:3857' ||
    Math.abs(bounds[0]) > 180 ||
    Math.abs(bounds[2]) > 180;

  if (isWebMercator) {

    // First, detect the common GoogleMapsCompatible tile extent in meters
    // Example from GDAL: Y = ±10018754.17 m => lat = ±66.51326°
    const isGMapsCompatibleTileExtent =
      approx(bounds[0], WEB_MERCATOR_TILE_BOUNDS_M.xMin, 200) &&
      approx(bounds[2], WEB_MERCATOR_TILE_BOUNDS_M.xMax, 200) &&
      approx(bounds[1], WEB_MERCATOR_TILE_BOUNDS_M.yMin, 200) &&
      approx(bounds[3], WEB_MERCATOR_TILE_BOUNDS_M.yMax, 200);

    if (isGMapsCompatibleTileExtent) {
      return [...WEB_MERCATOR_TILE_BOUNDS_WGS84];
    }

    // Convert Web Mercator bounds to lat/lng
    const sw = mercatorToLatLng(bounds[0], bounds[1]);
    const ne = mercatorToLatLng(bounds[2], bounds[3]);


    return [sw[0], sw[1], ne[0], ne[1]];
  }

  // Check for Web Mercator global bounds (approximately ±20037508.34, ±10018754.17)
  const isWebMercatorGlobalBounds =
    approx(bounds[0], -20037508.34, 100) &&
    approx(bounds[1], -10018754.17, 100) &&
    approx(bounds[2], 20037508.34, 100) &&
    approx(bounds[3], 10018754.17, 100);

  if (isWebMercatorGlobalBounds) {
    // Use canonical tile bounds directly for clarity/consistency
    return [...WEB_MERCATOR_TILE_BOUNDS_WGS84];
  }

  // Check for invalid coordinates in WGS84
  if (bounds.some((coord) => typeof coord !== 'number' || !isFinite(coord))) {
    console.warn('GeoTIFF Processor: Invalid bounds (NaN/Infinite), using Web Mercator tile bounds:', bounds);
    // Use standard Web Mercator tile extent
    return [-180, -66.51326044311186, 180, 66.51326044311186];
  }

  // IMPORTANT: Don't force global bounds for valid regional data!
  // The original logic was causing the positioning offset by stretching regional data globally

  // Check if bounds claim to be global
  const isExactlyGlobal =
    bounds[0] === -180 &&
    bounds[1] === -90 &&
    bounds[2] === 180 &&
    bounds[3] === 90;

  // Check for near-global bounds that are from Web Mercator conversion
  // The ±66.51326° latitude corresponds to Y=±10018754.17 meters in Web Mercator
  // This is a standard extent for global Web Mercator tiles and should NOT be adjusted
  const isNearGlobal =
    Math.abs(bounds[0] + 180) < 0.1 &&
    Math.abs(bounds[2] - 180) < 0.1 &&
    Math.abs(bounds[1] + 66.51) < 1 &&
    Math.abs(bounds[3] - 66.51) < 1;

  if (isNearGlobal) {
    // Return the original bounds - they are correct!
    return bounds;
  }

  if (isExactlyGlobal) {
    // If bounds claim to be exactly global (-90 to 90), this is likely incorrect for Web Mercator data
    // Web Mercator can only represent approximately ±85.05° (and commonly ±66.51° for tiles)
    // Use the standard Web Mercator tile extent
    return [...WEB_MERCATOR_TILE_BOUNDS_WGS84];
  }

  // For all other cases, preserve the actual bounds from the GeoTIFF
  let [west, south, east, north] = bounds;

  // Only clamp if coordinates are truly invalid (outside possible WGS84 range)
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    console.warn('GeoTIFF Processor: Longitude values outside ±180°, clamping:', bounds);
    west = Math.max(-180, Math.min(180, west));
    east = Math.max(-180, Math.min(180, east));
  }

  if (south < -90 || south > 90 || north < -90 || north > 90) {
    console.warn('GeoTIFF Processor: Latitude values outside ±90°, clamping:', bounds);
    south = Math.max(-90, Math.min(90, south));
    north = Math.max(-90, Math.min(90, north));
  }

  return [west, south, east, north];
}

/**
 * Get a color from a named colormap, optionally reversed (flips which end of
 * the scale represents the highest values).
 */
function getColorFromColormap(
  value: number,
  rescale: [number, number],
  colormapName: string = DEFAULT_COLORMAP,
  reversed: boolean = false
): [number, number, number] {
  const colormap = COLORMAPS[colormapName] || VIRIDIS_COLORMAP;

  // Normalize value using provided rescale range
  const [minV, maxV] = rescale;
  const denom = maxV - minV === 0 ? 1 : maxV - minV;
  let rescaledValue = Math.min(1, Math.max(0, (value - minV) / denom));
  if (reversed) rescaledValue = 1 - rescaledValue;

  // Map to colormap index
  const index = rescaledValue * (colormap.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.min(colormap.length - 1, lowerIndex + 1);
  const t = index - lowerIndex; // Interpolation factor

  // Interpolate between colors
  if (lowerIndex === upperIndex) {
    // Ensure we return a tuple of exactly 3 numbers
    const color = colormap[lowerIndex];
    return [color[0], color[1], color[2]];
  }

  const lowerColor = colormap[lowerIndex];
  const upperColor = colormap[upperIndex];

  // Ensure we return a tuple of exactly 3 numbers
  return [
    Math.round(lowerColor[0] * (1 - t) + upperColor[0] * t),
    Math.round(lowerColor[1] * (1 - t) + upperColor[1] * t),
    Math.round(lowerColor[2] * (1 - t) + upperColor[2] * t)
  ];
}

/**
 * Reproject EPSG:4326 (geographic) raster data to EPSG:3857 (Web Mercator)
 * This fixes vertical stretching when displaying geographic rasters on Web Mercator basemaps
 */
async function processEPSG4326ToMercator(
  sourceData: any,
  sourceWidth: number,
  sourceHeight: number,
  geoBounds: number[], // [west, south, east, north] in degrees
  options: ProcessingOptions = {}
): Promise<{ dataUrl: string; rasterData: Float32Array; width: number; height: number; rescaleUsed: [number, number] }> {

  const [west, south, east, north] = geoBounds;

  // Convert geographic bounds to Web Mercator bounds
  const [mercWest, mercSouth] = latLngToMercator(west, south);
  const [mercEast, mercNorth] = latLngToMercator(east, north);


  // Calculate output dimensions - maintain similar pixel density
  // For EPSG:4326, each pixel represents equal degrees
  // For EPSG:3857, we need to account for Mercator distortion
  const mercWidth = mercEast - mercWest;
  const mercHeight = mercNorth - mercSouth;

  // Use source dimensions as a starting point, but adjust aspect ratio for Mercator
  const mercAspectRatio = mercWidth / mercHeight;
  const sourceAspectRatio = sourceWidth / sourceHeight;

  let outputWidth = sourceWidth;
  let outputHeight = sourceHeight;

  // Adjust dimensions to match Mercator aspect ratio
  if (mercAspectRatio > sourceAspectRatio) {
    // Mercator is wider than source, increase output width
    outputWidth = Math.round(sourceHeight * mercAspectRatio);
  } else {
    // Mercator is taller than source, increase output height
    outputHeight = Math.round(sourceWidth / mercAspectRatio);
  }


  // Find min/max values for rescaling
  let minValue = Infinity;
  let maxValue = -Infinity;
  const rawDataCopy = new Float32Array(outputWidth * outputHeight);

  for (let i = 0; i < sourceWidth * sourceHeight; i++) {
    const value = sourceData[0][i];
    if (!isNaN(value) && value > -1e10 && value < 1e10 && value !== -9999 && value !== -999) {
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    }
  }

  const rescale: [number, number] = options.rescale || [minValue, maxValue];

  // Create output canvas
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  const imageData = ctx.createImageData(outputWidth, outputHeight);

  // Resample: for each output pixel, find corresponding input pixel
  for (let outY = 0; outY < outputHeight; outY++) {
    for (let outX = 0; outX < outputWidth; outX++) {
      // Calculate Web Mercator coordinates for this output pixel
      const mercX = mercWest + (outX / outputWidth) * mercWidth;
      const mercY = mercNorth - (outY / outputHeight) * mercHeight; // Y is flipped (top = north)

      // Convert Web Mercator to lat/lng
      const [lng, lat] = mercatorToLatLng(mercX, mercY);

      // Find corresponding pixel in source raster (EPSG:4326)
      // Source pixels are evenly distributed in degrees
      const normalizedX = (lng - west) / (east - west);
      const normalizedY = (north - lat) / (north - south);

      // Clamp to valid range
      if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
        // Outside source bounds - mark as no-data
        const outIndex = outY * outputWidth + outX;
        rawDataCopy[outIndex] = NaN;
        imageData.data[outIndex * 4] = 0;
        imageData.data[outIndex * 4 + 1] = 0;
        imageData.data[outIndex * 4 + 2] = 0;
        imageData.data[outIndex * 4 + 3] = 0; // Transparent
        continue;
      }

      // Sample from source using nearest neighbor
      const srcX = Math.floor(normalizedX * sourceWidth);
      const srcY = Math.floor(normalizedY * sourceHeight);
      const srcIndex = srcY * sourceWidth + srcX;

      const value = sourceData[0][srcIndex];
      const outIndex = outY * outputWidth + outX;

      // Store raw value
      rawDataCopy[outIndex] = value;

      // Check for no-data
      if (isNaN(value) || value < -1e10 || value > 1e10 || value === -9999 || value === -999) {
        imageData.data[outIndex * 4] = 0;
        imageData.data[outIndex * 4 + 1] = 0;
        imageData.data[outIndex * 4 + 2] = 0;
        imageData.data[outIndex * 4 + 3] = 0; // Transparent
      } else {
        // Apply colormap
        if (options.debugMode) {
          imageData.data[outIndex * 4] = 0;
          imageData.data[outIndex * 4 + 1] = 0;
          imageData.data[outIndex * 4 + 2] = 0;
          imageData.data[outIndex * 4 + 3] = 255;
        } else {
          const [r, g, b] = getColorFromColormap(value, rescale, options.colormap, options.reversed);
          imageData.data[outIndex * 4] = r;
          imageData.data[outIndex * 4 + 1] = g;
          imageData.data[outIndex * 4 + 2] = b;
          imageData.data[outIndex * 4 + 3] = 255;
        }
      }
    }
  }

  // Render to canvas
  ctx.putImageData(imageData, 0, 0);

  const dataUrl = canvas.toDataURL('image/png');

  return { dataUrl, rasterData: rawDataCopy, width: outputWidth, height: outputHeight, rescaleUsed: rescale };
}

/**
 * Process GeoTIFF data and return a data URL and raw data
 * @param image The GeoTIFF image object
 * @param options Processing options
 * @param projectionInfo Optional projection information (e.g., 'EPSG:4326' or 'EPSG:3857')
 * @param originalBounds Optional bounds in the original projection [west, south, east, north]
 */
export async function processGeoTIFF(
  image: any,
  options: ProcessingOptions = {},
  projectionInfo?: string | null,
  originalBounds?: number[]
): Promise<{ dataUrl: string; rasterData: Float32Array; width: number; height: number; rescaleUsed: [number, number] }> {
  const width = image.getWidth();
  const height = image.getHeight();

  const data = await image.readRasters();
  const rasterData = data as any;

  // Check if reprojection from EPSG:4326 to EPSG:3857 is needed
  const needsReprojection = projectionInfo === 'EPSG:4326' && originalBounds && originalBounds.length === 4;

  if (needsReprojection && originalBounds) {
    return await processEPSG4326ToMercator(
      rasterData,
      width,
      height,
      originalBounds,
      options
    );
  }

  // Create a canvas to render the data (for EPSG:3857 or unknown projections)
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Create an ImageData object
  const imageData = ctx.createImageData(width, height);

  // Find data range to determine no-data values
  let minValue = Infinity;
  let maxValue = -Infinity;

  // Create a Float32Array copy of the raw data for storage
  const rawDataCopy = new Float32Array(width * height);

  // Scan for min/max values and identify no-data areas
  let noDataCount = 0;
  let validDataCount = 0;

  // Track actual data extent (for detecting if bounds are incorrect)
  let minX = width, maxX = -1;
  let minY = height, maxY = -1;

  for (let i = 0; i < width * height; i++) {
    const value = rasterData[0][i]; // First band
    // Check for sentinel/no-data values
    // GeoTIFF often uses specific sentinel values like -9999, -999, etc.
    if (isNaN(value) || value < -1e10 || value > 1e10 || value === -9999 || value === -999) {
      rawDataCopy[i] = NaN; // Store NaN for no-data values
      noDataCount++;
    } else {
      rawDataCopy[i] = value; // Store raw value (including legitimate 0 values)
      validDataCount++;

      // Track actual data extent
      const x = i % width;
      const y = Math.floor(i / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    // Only consider valid values for min/max calculation
    // Note: 0 is a valid value (0% prevalence), so we include it
    if (!isNaN(value) && value > -1e10 && value < 1e10) {
      minValue = Math.min(minValue, value);
      maxValue = Math.max(maxValue, value);
    }
  }

  // Log actual data extent for debugging
  if (validDataCount > 0) {
    const xCoverage = (maxX - minX + 1) / width;
    const yCoverage = (maxY - minY + 1) / height;


    // Don't adjust bounds - the raster should use its declared bounds
    // Even if data doesn't fill the entire extent (ocean areas are 0/NaN)
  }


  // Use provided rescale values or default to the detected range
  const rescale: [number, number] = options.rescale || [minValue, maxValue];
  const noDataThreshold = options.noDataThreshold || 0.01;

  // Apply colormap to raster data with better no-data handling
  // IMPORTANT: Use rawDataCopy for consistency with what we store
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Calculate the source index in the raster data
      const sourceIndex = y * width + x;
      // Canvas uses the same row-major order
      const canvasIndex = y * width + x;

      const value = rawDataCopy[sourceIndex];

      // Check for no-data values
      // Only NaN and extreme values are considered no-data
      // 0 is a valid value (0% prevalence) and should be colored
      if (isNaN(value) || value < -1e10 || value > 1e10) {
        // Transparent for no-data values
        imageData.data[canvasIndex * 4] = 0;
        imageData.data[canvasIndex * 4 + 1] = 0;
        imageData.data[canvasIndex * 4 + 2] = 0;
        imageData.data[canvasIndex * 4 + 3] = 0;
      } else {
        // Debug mode: show black pixels for all data locations
        if (options.debugMode) {
          imageData.data[canvasIndex * 4] = 0;     // Red = 0 (black)
          imageData.data[canvasIndex * 4 + 1] = 0; // Green = 0 (black)
          imageData.data[canvasIndex * 4 + 2] = 0; // Blue = 0 (black)
          imageData.data[canvasIndex * 4 + 3] = 255; // Alpha = 255 (opaque)
        } else {
          // Apply colormap (including for 0 values)
          const [r, g, b] = getColorFromColormap(value, rescale, options.colormap, options.reversed);
          imageData.data[canvasIndex * 4] = r;
          imageData.data[canvasIndex * 4 + 1] = g;
          imageData.data[canvasIndex * 4 + 2] = b;
          imageData.data[canvasIndex * 4 + 3] = 255; // Alpha
        }
      }
    }
  }

  // Put the image data on the canvas
  ctx.putImageData(imageData, 0, 0);

  // Convert canvas to data URL
  const dataUrl = canvas.toDataURL('image/png');

  return { dataUrl, rasterData: rawDataCopy, width, height, rescaleUsed: rescale };
}

/**
 * Re-render a canvas data URL from already-decoded raster values. Used when the
 * user switches color scale or inverts it on an already-loaded layer -- avoids
 * re-fetching and re-decoding the source GeoTIFF just to recolor it.
 */
export function recolorRasterData(
  rasterData: Float32Array,
  width: number,
  height: number,
  rescale: [number, number],
  colormap: string = DEFAULT_COLORMAP,
  reversed: boolean = false
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const value = rasterData[i];
    if (isNaN(value) || value < -1e10 || value > 1e10) {
      imageData.data[i * 4] = 0;
      imageData.data[i * 4 + 1] = 0;
      imageData.data[i * 4 + 2] = 0;
      imageData.data[i * 4 + 3] = 0;
    } else {
      const [r, g, b] = getColorFromColormap(value, rescale, colormap, reversed);
      imageData.data[i * 4] = r;
      imageData.data[i * 4 + 1] = g;
      imageData.data[i * 4 + 2] = b;
      imageData.data[i * 4 + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Load and process a GeoTIFF from a URL
 */
export async function loadAndProcessGeoTIFF(
  url: string,
  options: ProcessingOptions = {}
): Promise<{
  dataUrl: string;
  metadata: GeoTIFFMetadata;
  bounds: number[];
  rasterData: Float32Array;
  width: number;
  height: number;
  rescaleUsed: [number, number];
}> {
  try {
    // Load the GeoTIFF
    const { image, metadata } = await loadGeoTIFF(url);

    // Extract projection information from GeoTIFF metadata
    let projectionInfo: string | null = null;
    try {
      const geoKeys = image.getGeoKeys();
      if (geoKeys) {
        // Check for projected coordinate system (like EPSG:3857)
        if (geoKeys.ProjectedCSTypeGeoKey) {
          projectionInfo = `EPSG:${geoKeys.ProjectedCSTypeGeoKey}`;
        }
        // Check for geographic coordinate system (like EPSG:4326)
        else if (geoKeys.GeographicTypeGeoKey) {
          projectionInfo = `EPSG:${geoKeys.GeographicTypeGeoKey}`;
        }
        // Check GTModelTypeGeoKey to distinguish between geographic and projected
        else if (geoKeys.GTModelTypeGeoKey) {
          if (geoKeys.GTModelTypeGeoKey === 1) {
            // ModelTypeProjected
            projectionInfo = 'EPSG:3857'; // Assume Web Mercator if projected but no specific key
          } else if (geoKeys.GTModelTypeGeoKey === 2) {
            // ModelTypeGeographic
            projectionInfo = 'EPSG:4326'; // Assume WGS84 if geographic but no specific key
          }
        }
      }

      // Fallback: detect projection from bounds magnitude
      if (!projectionInfo && metadata.bounds) {
        const bounds = metadata.bounds as number[];
        const maxAbsValue = Math.max(...bounds.map(Math.abs));

        if (maxAbsValue > 200) {
          // Bounds are in meters (Web Mercator range is ~±20,037,508)
          projectionInfo = 'EPSG:3857';
        } else if (maxAbsValue <= 180) {
          // Bounds are in degrees (WGS84 range is ±180°)
          projectionInfo = 'EPSG:4326';
        }
      }

      // Store projection info in metadata
      metadata.projection = projectionInfo;
    } catch (err) {
      console.warn('GeoTIFF Processor: Error extracting projection info:', err);
    }

    // Initialize bounds with a default value to avoid null issues
    let bounds = (metadata.bounds as number[]) || [-180, -90, 180, 90]; // Default to global bounds if null

    // Validate and adjust bounds, passing projection info
    bounds = validateBounds(bounds, projectionInfo || undefined);


    // Process the GeoTIFF, passing projection info and original bounds for reprojection if needed
    const originalBounds = metadata.bounds as number[];
    const { dataUrl, rasterData, width, height, rescaleUsed } = await processGeoTIFF(
      image,
      options,
      projectionInfo,
      originalBounds
    );

    return { dataUrl, metadata, bounds, rasterData, width, height, rescaleUsed };
  } catch (error) {
    console.error('GeoTIFF Processor: Error processing GeoTIFF:', error);
    throw error;
  }
}
