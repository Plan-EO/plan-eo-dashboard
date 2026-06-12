import { get } from 'svelte/store';
import { page } from '$app/stores';
import { goto } from '$app/navigation';
import {
  selectedPathogens,
  selectedAgeGroups,
  selectedSyndromes
} from '$lib/components/Map/store';
import { selectedMapStyle } from '$lib/stores/mapStyle.store';
import { getStyleById } from '$lib/components/Map/MapStyles';

// Define the structure for URL parameters
interface MapUrlParams {
  p?: string[]; // pathogens
  a?: string[]; // age groups
  s?: string[]; // syndromes
  o?: number;   // opacity
  st?: string;  // style ID
  c?: [number, number]; // center [lng, lat]
  z?: number;  // zoom level
}

/**
 * Serialize the current filter state to URL parameters
 */
export function serializeFiltersToUrl(map: maplibregl.Map | null, opacity: number): void {
  const $selectedPathogens = get(selectedPathogens);
  const $selectedAgeGroups = get(selectedAgeGroups);
  const $selectedSyndromes = get(selectedSyndromes);
  const $selectedMapStyle = get(selectedMapStyle);

  // Build the query parameters object
  const params: MapUrlParams = {};

  // Only add parameters that have values
  if ($selectedPathogens.size > 0) {
    params.p = Array.from($selectedPathogens);
  }

  if ($selectedAgeGroups.size > 0) {
    params.a = Array.from($selectedAgeGroups);
  }

  if ($selectedSyndromes.size > 0) {
    params.s = Array.from($selectedSyndromes);
  }

  // Add global opacity if not the default (80%)
  if (opacity !== 80) {
    params.o = opacity;
  }

  // Add map style if not the default
  if ($selectedMapStyle?.id && $selectedMapStyle.id !== 'osm-default') {
    params.st = $selectedMapStyle.id;
  }

  // Add map position and zoom if map is available
  if (map) {
    const center = map.getCenter();
    const zoom = map.getZoom();

    // Round to 5 decimal places for center coordinates
    params.c = [
      Math.round(center.lng * 100000) / 100000,
      Math.round(center.lat * 100000) / 100000
    ];

    // Round to 2 decimal places for zoom
    params.z = Math.round(zoom * 100) / 100;
  }

  // Serialize to URL format
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      // Handle array parameters
      if (key === 'c') {
        // Special case for coordinates
        searchParams.append(key, value.join(','));
      } else {
        // For arrays like pathogens, age groups, etc.
        value.forEach(item => {
          searchParams.append(key, item);
        });
      }
    } else {
      // Handle scalar parameters
      searchParams.append(key, value.toString());
    }
  });

  // Get current URL and update the search params without triggering a page reload
  const url = new URL(window.location.href);
  url.search = searchParams.toString();

  // Use Svelte's goto to update the URL without reloading
  goto(url.toString(), { replaceState: true, keepFocus: true, noScroll: true });
}

/**
 * Parse URL parameters and update filter stores.
 * Pass applyFilterStores: false to read position/style params without
 * applying pathogen/age/syndrome filters (used when Layer Manager is active).
 */
export function parseUrlFilters(options?: { applyFilterStores?: boolean }): {
  center?: [number, number];
  zoom?: number;
  styleId?: string;
  opacity?: number;
  hasFilters: boolean;
} {
  const applyFilterStores = options?.applyFilterStores !== false; // default true
  const url = get(page).url;
  const params = url.searchParams;

  // Extract pathogens
  const pathogenParams = params.getAll('p');
  if (applyFilterStores && pathogenParams.length > 0) {
    selectedPathogens.set(new Set(pathogenParams));
  }

  // Extract age groups
  const ageGroupParams = params.getAll('a');
  if (applyFilterStores && ageGroupParams.length > 0) {
    selectedAgeGroups.set(new Set(ageGroupParams));
  }

  // Extract syndromes
  const syndromeParams = params.getAll('s');
  if (applyFilterStores && syndromeParams.length > 0) {
    selectedSyndromes.set(new Set(syndromeParams));
  }

  // Build return object with map-specific settings
  const mapSettings: {
    center?: [number, number];
    zoom?: number;
    styleId?: string;
    opacity?: number;
  } = {};

  // Extract map center
  const centerParam = params.get('c');
  if (centerParam) {
    const [lng, lat] = centerParam.split(',').map(Number);
    if (!isNaN(lng) && !isNaN(lat)) {
      mapSettings.center = [lng, lat];
    }
  }

  // Extract zoom level
  const zoomParam = params.get('z');
  if (zoomParam) {
    const zoom = Number(zoomParam);
    if (!isNaN(zoom)) {
      mapSettings.zoom = zoom;
    }
  }

  // Extract map style
  const styleParam = params.get('st');
  if (styleParam) {
    const style = getStyleById(styleParam);
    if (style) {
      selectedMapStyle.set(style);
      mapSettings.styleId = styleParam;
    }
  }

  // Extract opacity
  const opacityParam = params.get('o');
  if (opacityParam) {
    const opacity = Number(opacityParam);
    if (!isNaN(opacity) && opacity >= 0 && opacity <= 100) {
      mapSettings.opacity = opacity;
    }
  }

  // Determine if any filter parameters are present
  const hasFilters = pathogenParams.length > 0 ||
    ageGroupParams.length > 0 ||
    syndromeParams.length > 0;

  return {
    ...mapSettings,
    hasFilters
  };
}

/**
 * Create a debounced function that only triggers after a set delay
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return function (...args: Parameters<T>) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}
