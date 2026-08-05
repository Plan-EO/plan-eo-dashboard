import type { RasterLayer } from '$lib/types';
import { WEB_MERCATOR_MAX_LATITUDE } from './geoTiffProcessor';

/**
 * Check if a latitude is within Web Mercator's representable range
 * @param lat Latitude to check
 * @returns true if the latitude can be represented in Web Mercator
 */
export function isLatitudeInWebMercatorRange(lat: number): boolean {
  return Math.abs(lat) <= WEB_MERCATOR_MAX_LATITUDE;
}

// Convert latitude in degrees to Web Mercator "y" (unitless mercator) for consistent vertical mapping
// y = ln(tan(pi/4 + phi/2)) where phi is latitude radians; clamp to Web Mercator max
function latToMercatorY(latDeg: number): number {
  const clamped = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, latDeg));
  const phi = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

/**
 * Get the raster value at a specific geographic coordinate (ultra-fast version for real-time hover)
 * @param layer The raster layer containing the data
 * @param lng Longitude
 * @param lat Latitude
 * @returns The raster value at that location, or null if outside bounds or no data
 */
export function getRasterValueAtCoordinateFast(
  layer: RasterLayer,
  lng: number,
  lat: number
): number | null {
  // Fast fail checks
  if (!layer.rasterData) return null;

  const data = layer.rasterData;
  const w = layer.width;
  const h = layer.height;
  const bounds = layer.bounds;

  if (!w || !h || !bounds) return null;

  // Debug logging for coordinate mapping (reduced for performance)
  if (Math.random() < 0.01) { // Only log 1% of queries
  }

  // Normalize longitude to [-180, 180] range to handle world copies
  // This is needed because MapLibre with renderWorldCopies:true can return lng > 180
  lng = ((lng + 180) % 360) - 180;

  // Direct array access for bounds
  const west = bounds[0];
  const south = bounds[1];
  const east = bounds[2];
  const north = bounds[3];

  // Bounds check
  if (lng < west || lng > east || lat < south || lat > north) return null;

  // Calculate pixel coordinates
  // Map coordinate to pixel, accounting for pixel boundaries
  // Each pixel covers a range, and we want the pixel that contains this coordinate
  const xRatio = (lng - west) / (east - west);
  const pixelX = Math.min(w - 1, Math.floor(xRatio * w));

  // Bounds check X
  if (pixelX < 0 || pixelX >= w) return null;

  // The raster data is stored top-to-bottom (row 0 = north edge)
  // IMPORTANT: Use Mercator Y for vertical mapping to match map/image placement
  const yNorth = latToMercatorY(north);
  const ySouth = latToMercatorY(south);
  const yLat = latToMercatorY(lat);
  const yRatio = (yNorth - yLat) / (yNorth - ySouth);
  const pixelY = Math.min(h - 1, Math.floor(yRatio * h));

  // Log critical coordinate mapping occasionally
  if (Math.random() < 0.01) { // Only log 1% of queries
  }

  // Bounds check Y
  if (pixelY < 0 || pixelY >= h) return null;

  // Direct array access - data is stored in row-major order
  const index = pixelY * w + pixelX;
  const value = data[index];

  // Fast no-data check - most values are valid, so optimize for that path
  if (!isNaN(value) && value > -1e10 && value < 1e10 && value !== -9999 && value !== -999) {
    // Fast rounding to 2 decimal places
    return ~~(value * 100 + 0.5) / 100;
  }

  return null;
}

/**
 * Get the raster value at a specific geographic coordinate (with full analysis)
 * @param layer The raster layer containing the data
 * @param lng Longitude
 * @param lat Latitude
 * @returns The raster value at that location, or null if outside bounds or no data
 */
export function getRasterValueAtCoordinate(
  layer: RasterLayer,
  lng: number,
  lat: number
): number | null {
  // Check if we have the necessary data
  if (!layer.rasterData || !layer.width || !layer.height || !layer.bounds) {
    console.warn('Raster layer missing required data for pixel query');
    return null;
  }

  // Normalize longitude to [-180, 180] range to handle world copies
  lng = ((lng + 180) % 360) - 180;

  const [west, south, east, north] = layer.bounds;

  // Check if coordinate is within bounds
  if (lng < west || lng > east || lat < south || lat > north) {
    return null;
  }

  // Convert geographic coordinates to pixel coordinates
  // X increases from west to east (left to right)
  const xRatio = (lng - west) / (east - west);
  const pixelX = Math.min(layer.width - 1, Math.floor(xRatio * layer.width));

  // Y-axis: Use consistent top-down orientation (Y=0 at north/top)
  // This matches how we create the canvas image
  // IMPORTANT: Use Mercator Y for vertical mapping to match map/image placement
  const yNorth = latToMercatorY(north);
  const ySouth = latToMercatorY(south);
  const yLat = latToMercatorY(lat);
  const yRatio = (yNorth - yLat) / (yNorth - ySouth);
  const pixelY = Math.min(layer.height - 1, Math.floor(yRatio * layer.height));

  // Ensure pixel coordinates are within bounds
  if (pixelX < 0 || pixelX >= layer.width || pixelY < 0 || pixelY >= layer.height) {
    return null;
  }

  // Get the index in the flat array using consistent top-down orientation
  const index = pixelY * layer.width + pixelX;

  // Get the value from the raster data
  const value = layer.rasterData[index];

  // Check for no-data values
  // NaN indicates no data (ocean, outside coverage area, etc.)
  // 0 is a valid value (0% prevalence)
  if (isNaN(value) || value < -1e10 || value > 1e10 || value === -9999 || value === -999) {
    return null;
  }

  // Round to 2 decimal places for display
  // Note: 0 is a valid value representing 0% prevalence
  return Math.round(value * 100) / 100;
}

/**
 * Find the visible raster layer at a coordinate
 * @param rasterLayers Map of all raster layers
 * @param lng Longitude
 * @param lat Latitude
 * @returns The first visible raster layer at that location, or null
 */
export function findVisibleRasterLayerAtCoordinate(
  rasterLayers: Map<string, RasterLayer>,
  lng: number,
  lat: number
): RasterLayer | null {
  // For global raster layers, we need to check if the click is within data range
  // even if technically outside the stored bounds
  for (const [, layer] of rasterLayers) {
    if (layer.isVisible && layer.bounds && !layer.isLoading && !layer.error) {
      const [west, south, east, north] = layer.bounds;

      // Check if coordinate is within layer bounds
      if (lng >= west && lng <= east && lat >= south && lat <= north) {
        return layer;
      }
    }
  }

  return null;
}