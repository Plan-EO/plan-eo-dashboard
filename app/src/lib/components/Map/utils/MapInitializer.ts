import type { Map as MaplibreMap } from 'maplibre-gl';
import maplibregl from 'maplibre-gl';
import type { MapStyle } from '../MapStyles';
import { parseUrlFilters } from './urlParams';
import { loadPointsData } from '../store';
import { dataUpdateDate } from '$lib/stores/data.store';

// Get R2 base URL from environment
const R2_BASE_URL = import.meta.env.VITE_R2_POINTS_BASE_URL || 'https://pub-6e8836a7d8be4fd1adc1317bb416ad75.r2.dev/01_Points';

// Fallback values if runtime detection fails
const FALLBACK_DATE = '2025-12-07';
const FALLBACK_FILE = '2025-12-07_Plan-EO_Dashboard_point_data.csv';

/**
 * Get the main CSV data file path from R2 storage
 * Fetches manifest.json directly from R2 to determine the latest file
 * Files follow pattern: YYYY-MM-DD_Plan-EO_Dashboard_point_data.csv
 */
async function getLatestDataFile(): Promise<string> {
  try {
    // Fetch manifest.json directly from R2 (works with static hosting)
    const manifestUrl = `${R2_BASE_URL}/manifest.json`;
    const response = await fetch(manifestUrl);

    if (response.ok) {
      const manifest = await response.json();

      if (manifest.files && manifest.files.length > 0) {
        const latestFile = manifest.files[0];
        dataUpdateDate.set(latestFile.date);
        const url = `${R2_BASE_URL}/${latestFile.fileName}`;
        console.log(`Using latest data file: ${latestFile.fileName} (${latestFile.date})`);
        return url;
      }
    }

    console.warn('Failed to fetch manifest.json, using fallback');
  } catch (error) {
    console.error('Error fetching manifest:', error);
  }

  // Fallback if manifest fetch fails
  dataUpdateDate.set(FALLBACK_DATE);
  const url = `${R2_BASE_URL}/${FALLBACK_FILE}`;
  console.log(`Using fallback data file: ${FALLBACK_FILE} (${FALLBACK_DATE})`);
  return url;
}

// Export for consistency across the app  
export let POINTS_DATA_URL = '';

/**
 * Preload data before map initialization
 * @returns URL parameters
 */
export async function preloadData() {
  console.log('preloadData called');
  // Parse URL parameters — skip applying filter stores; LayerManager owns that state
  const urlParams = parseUrlFilters({ applyFilterStores: false });
  
  // Get the latest data file
  POINTS_DATA_URL = await getLatestDataFile();
  console.log('About to load data from:', POINTS_DATA_URL);

  // Load point data with forceReload if URL has filter parameters
  await loadPointsData(POINTS_DATA_URL, urlParams.hasFilters);

  return urlParams;
}

/**
 * Initialize the map with the given container and style
 * @param mapContainer The HTML element to contain the map
 * @param initialStyle The initial map style
 * @param initialCenter The initial center coordinates
 * @param initialZoom The initial zoom level
 * @returns The initialized map instance
 */
export function initializeMap(
  mapContainer: HTMLElement,
  initialStyle: MapStyle,
  initialCenter: [number, number] = [28.4, -15.0],
  initialZoom: number = 4
): MaplibreMap | null {
  try {
    // Create map with the appropriate style
    const map = new maplibregl.Map({
      container: mapContainer,
      style: initialStyle.url,
      center: initialCenter,
      zoom: initialZoom,
      renderWorldCopies: true // Enable world copies for better wrapping at edges
    });

    // Add controls
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(
      new maplibregl.ScaleControl({
        maxWidth: 100,
        unit: 'metric'
      }),
      'bottom-left'
    );

    return map;
  } catch (error) {
    console.error('Error initializing map:', error);
    return null;
  }
}

/**
 * Add a "home" (reset view) button to the navigation control, between its
 * zoom-in and zoom-out buttons. Must be called after initializeMap has added
 * the NavigationControl.
 * @param map The map instance
 * @param onClick Called when the button is clicked
 */
export function addHomeButton(map: MaplibreMap, onClick: () => void): void {
  const zoomInButton = map.getContainer().querySelector('.maplibregl-ctrl-zoom-in');
  if (!zoomInButton || zoomInButton.parentElement?.querySelector('.maplibregl-ctrl-home')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'maplibregl-ctrl-home';
  button.title = 'Reset map view';
  button.setAttribute('aria-label', 'Reset map view');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="17" height="17" style="display:block;margin:auto" aria-hidden="true">' +
    '<path d="M12 4 3 11.5h2.5V20h5v-5h3v5h5v-8.5H21z" fill="#333"/></svg>';
  button.addEventListener('click', onClick);

  zoomInButton.insertAdjacentElement('afterend', button);
}

/**
 * Add event listeners to the map
 * @param map The map instance
 * @param onStyleChange Callback for style change events
 * @param onMapMove Callback for map movement events
 */
export function addMapEventListeners(
  map: MaplibreMap,
  onStyleChange: () => void,
  onMapMove: () => void
): void {
  // Add style change listener
  map.on('styledata', onStyleChange);

  // Add map movement listeners
  map.on('moveend', onMapMove);
  map.on('zoomend', onMapMove);

  // Add error listener
  map.on('error', (e) => {
    console.error('MapLibre error:', e);
  });
}

/**
 * Remove event listeners from the map
 * @param map The map instance
 * @param onStyleChange Callback for style change events
 * @param onMapMove Callback for map movement events
 */
export function removeMapEventListeners(
  map: MaplibreMap,
  onStyleChange: () => void,
  onMapMove: () => void
): void {
  map.off('styledata', onStyleChange);
  map.off('moveend', onMapMove);
  map.off('zoomend', onMapMove);
}
