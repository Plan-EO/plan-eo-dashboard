import { browser } from '$app/environment';
import type { MapStyle } from './types';
import { MAP_STYLES } from './types';

const STORAGE_KEY = 'selectedMapStyle';
const defaultStyle = MAP_STYLES.find(style => style.id === 'street-map') || MAP_STYLES[0];

export function loadStoredStyle(): MapStyle {
  if (!browser) return defaultStyle;

  const savedStyleId = localStorage.getItem(STORAGE_KEY);
  if (!savedStyleId) return defaultStyle;

  return MAP_STYLES.find(style => style.id === savedStyleId) || defaultStyle;
}

export function saveStyleToStorage(style: MapStyle): void {
  if (browser) {
    localStorage.setItem(STORAGE_KEY, style.id);
  }
}

export function clearStoredStyle(): void {
  if (browser) {
    localStorage.removeItem(STORAGE_KEY);
  }
}
