import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Visualization type for map points
export type VisualizationType = 'dots' | 'pie-charts';

// Create a persistent visualization type store with map updates
function createVisualizationTypeStore() {
  const STORAGE_KEY = 'visualizationType';
  const defaultType: VisualizationType = 'pie-charts';

  // Load initial value from localStorage if available, falling back if the stored value is no longer valid
  const validTypes: VisualizationType[] = ['dots', 'pie-charts'];
  const stored = browser ? localStorage.getItem(STORAGE_KEY) : null;
  const initialValue: VisualizationType =
    stored && validTypes.includes(stored as VisualizationType)
      ? (stored as VisualizationType)
      : defaultType;

  const { subscribe, set, update } = writable<VisualizationType>(initialValue);

  return {
    subscribe,
    set: (value: VisualizationType) => {
      if (browser) {
        localStorage.setItem(STORAGE_KEY, value);
      }
      set(value);
      // The side effect of calling switchVisualizationType will be handled
      // by the component or service that triggers this 'set' operation.
    },
    update
  };
}

export const visualizationType = createVisualizationTypeStore();

// Store for 3D bar thickness (base size in degrees)
export const barThickness = writable<number>(0.4);

// Manual visualization switching function - called explicitly when visualization type changes
// This function seems to primarily update the store, which then triggers the effect in its `set` method.
export function switchVisualization(newType: VisualizationType) {
  // Update the visualization type store
  visualizationType.set(newType);

  // Return a signal that visualization switching is needed
  // This will be used by MapLayer to trigger the actual switching
  // This part might also be re-evaluated in a deeper refactor of the visualization switching logic.
  return { visualizationType: newType, timestamp: Date.now() };
}
