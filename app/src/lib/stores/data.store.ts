import { writable } from 'svelte/store';
import type { PointFeatureCollection } from '$lib/types';

// GeoJSON data store
export const pointsData = writable<PointFeatureCollection>({
  type: 'FeatureCollection',
  features: []
});

// Loading and error states
export const isLoading = writable<boolean>(false);
export const loadingMessage = writable<string>('Loading...');
export const dataError = writable<string | null>(null);

// Count of CSV rows dropped during the last load because they had no valid
// SITE_LAT/SITE_LON (e.g. a malformed source row whose columns shifted left).
// Surfaced as a dismissible warning banner so a bad export doesn't silently
// lose data points with nothing but a console warning to notice it by.
export const skippedRowsCount = writable<number>(0);

// Color mapping for pathogens
export const pathogenColors = writable<Map<string, string>>(new Map());

// Data update date (extracted from filename)
export const dataUpdateDate = writable<string | null>(null);
