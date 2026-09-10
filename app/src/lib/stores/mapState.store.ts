import { writable, derived, get } from 'svelte/store';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { filteredPointsData, selectedPathogens, selectedAgeGroups, selectedSyndromes } from './filter.store';
import { visualizationType } from './map.store';

// Core map instance
export const mapInstance = writable<MaplibreMap | null>(null);

// Track map readiness explicitly
export const mapIsReady = writable<boolean>(false);

// Initialization state machine
export type InitializationState = 'idle' | 'initializing' | 'ready' | 'error';
export const initializationState = writable<InitializationState>('idle');

// Track if points have been added to the map
export const pointsAddedToMap = writable<boolean>(false);

// Track if we're updating visualization
export const isUpdatingVisualization = writable<boolean>(false);

// Track programmatic switching
export const isProgrammaticSwitching = writable<boolean>(false);

// Track layer order adjustment
export const isAdjustingLayerOrder = writable<boolean>(false);

// Error state
export const mapError = writable<string | null>(null);

// Derived store: Is map loaded and ready?
export const mapLoaded = derived(
  [mapInstance, mapIsReady],
  ([$map, $ready]) => {
    return !!$map && $ready;
  }
);

// Derived store: Is map ready for operations?
export const mapReady = derived(
  [mapInstance, mapLoaded, initializationState],
  ([$map, $loaded, $state]) => {
    return !!$map && $loaded && $state === 'ready';
  }
);

// Derived store: Do we have data to display?
export const hasData = derived(
  filteredPointsData,
  ($data) => $data?.features?.length > 0
);

// Derived store: Can we initialize the map?
export const canInitializeMap = derived(
  [mapLoaded, hasData, pointsAddedToMap, initializationState],
  ([$loaded, $hasData, $pointsAdded, $state]) => {
    return $loaded && $hasData && !$pointsAdded && $state !== 'initializing';
  }
);

// Derived store: Should we update the visualization?
export const shouldUpdateVisualization = derived(
  [mapReady, hasData, pointsAddedToMap, isUpdatingVisualization],
  ([$ready, $hasData, $pointsAdded, $updating]) => {
    return $ready && $hasData && $pointsAdded && !$updating;
  }
);

// Derived store: Is any programmatic operation happening?
export const isProgrammaticOperation = derived(
  [isProgrammaticSwitching, isAdjustingLayerOrder, isUpdatingVisualization],
  ([$switching, $adjusting, $updating]) => {
    return $switching || $adjusting || $updating;
  }
);

// Import visualization management functions dynamically
let mapVisualizationManager: any = null;

async function getMapVisualizationManager() {
  if (!mapVisualizationManager) {
    mapVisualizationManager = await import('../components/Map/store/mapVisualizationManager');
  }
  return mapVisualizationManager;
}

// Action functions to update state
export function setMapInstance(map: MaplibreMap | null) {
  mapInstance.set(map);
  if (!map) {
    initializationState.set('idle');
    pointsAddedToMap.set(false);
    mapIsReady.set(false);
  }
}

function setMapReady(ready: boolean) {
  mapIsReady.set(ready);

  // Check if we should initialize with a small delay to ensure everything is ready
  if (ready) {
    // Use setTimeout to ensure this happens after the current execution stack
    setTimeout(() => {
      checkAndInitialize();
    }, 100);
  }
}

export function setInitializationState(state: InitializationState) {
  initializationState.set(state);
}

export function setPointsAddedToMap(added: boolean) {
  pointsAddedToMap.set(added);
}

export function setMapError(error: string | null) {
  mapError.set(error);
  if (error) {
    initializationState.set('error');
  }
}

// Export setMapReady for use in components
export { setMapReady };

export function resetMapState() {
  mapInstance.set(null);
  mapIsReady.set(false);
  initializationState.set('idle');
  pointsAddedToMap.set(false);
  isUpdatingVisualization.set(false);
  isProgrammaticSwitching.set(false);
  isAdjustingLayerOrder.set(false);
  mapError.set(null);
}

// Track retry attempts
let initializationRetryCount = 0;
const MAX_INITIALIZATION_RETRIES = 3;

// Centralized initialization check
export async function checkAndInitialize(isRetry = false) {
  const map = get(mapInstance);
  const ready = get(mapIsReady);
  const hasData = get(filteredPointsData)?.features?.length > 0;
  const pointsAdded = get(pointsAddedToMap);
  const state = get(initializationState);
  
  // console.log('Checking initialization conditions:', {
  //   hasMap: !!map,
  //   mapReady: ready,
  //   hasData,
  //   pointsAdded,
  //   state,
  //   vizType,
  //   isRetry,
  //   retryCount: initializationRetryCount
  // });
  
  // Check if all conditions are met
  if (map && ready && hasData && !pointsAdded && state === 'idle') {
    const { addInitialPointsToMap } = await getMapVisualizationManager();
    initializationState.set('initializing');
    // addInitialPointsToMap (via ensurePointsOnTop) mutates the map style
    // (moveLayer, etc.), which MapLayer.svelte's 'styledata' listener would
    // otherwise mistake for an external style change and reset everything,
    // re-triggering this same function in a loop. Flag it as programmatic
    // like updateMapVisualization/switchVisualizationType already do.
    isUpdatingVisualization.set(true);
    const data = get(filteredPointsData);
    const type = get(visualizationType);
    let success = false;
    try {
      success = await addInitialPointsToMap(map, data, type, true);
    } finally {
      isUpdatingVisualization.set(false);
    }
    if (success) {
      initializationState.set('ready');
      pointsAddedToMap.set(true);
      initializationRetryCount = 0; // Reset retry count on success
    } else {
      initializationState.set('error');

      // Retry if we haven't exceeded max retries
      if (!isRetry && initializationRetryCount < MAX_INITIALIZATION_RETRIES) {
        initializationRetryCount++;

        // Reset state and retry after a delay
        setTimeout(() => {
          initializationState.set('idle');
          checkAndInitialize(true);
        }, 500 * initializationRetryCount); // Exponential backoff
      }
    }
  } else if (ready && hasData && !pointsAdded && initializationRetryCount < MAX_INITIALIZATION_RETRIES) {
    // If conditions aren't met but we should have points, schedule a retry
    if (!isRetry) {
      initializationRetryCount++;

      setTimeout(() => {
        checkAndInitialize(true);
      }, 500 * initializationRetryCount);
    }
  }
}

// Handle filter changes
export async function handleFilterChange(retries = 0): Promise<void> {
  const map = get(mapInstance);
  const ready = get(mapIsReady);
  const pointsAdded = get(pointsAddedToMap);
  const state = get(initializationState);
  const vizType = get(visualizationType);
  const updating = get(isUpdatingVisualization);

  // If not initialized yet, just wait for initialization
  if (!pointsAdded || state !== 'ready' || !map || !ready) {
    return;
  }

  // If another update is already in flight (e.g. this call raced with the
  // filteredPointsData subscriber below, which also calls this function),
  // retry shortly instead of silently dropping the update — otherwise the
  // map can end up stuck showing an older filter's data.
  if (updating) {
    if (retries < 10) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return handleFilterChange(retries + 1);
    }
    return;
  }

  try {
    const { updateMapVisualization } = await getMapVisualizationManager();
    const data = get(filteredPointsData);
    await updateMapVisualization(map, data, vizType, pointsAdded);
  } catch (error) {
    console.error('Error updating filters:', error);
  }
}

// Handle visualization type changes
export async function handleVisualizationTypeChange(oldType: string, newType: string) {
  const map = get(mapInstance);
  const ready = get(mapIsReady);
  const pointsAdded = get(pointsAddedToMap);
  const state = get(initializationState);
  const updating = get(isUpdatingVisualization);

  // If not initialized yet or already updating, skip
  if (!pointsAdded || state !== 'ready' || !map || !ready || updating) {
    return;
  }

  try {
    const { switchVisualizationType } = await getMapVisualizationManager();
    const data = get(filteredPointsData);
    await switchVisualizationType(map, oldType, newType, data);
  } catch (error) {
    console.error('Error switching visualization type:', error);
  }
}

// Watch for data changes
let previousDataLength = 0;
let previousFilterState = '';

filteredPointsData.subscribe((data) => {
  const hasData = data?.features?.length > 0;
  const currentDataLength = data?.features?.length || 0;
  const pointsAdded = get(pointsAddedToMap);
  const ready = get(mapIsReady);
  const state = get(initializationState);
  
  // Create a fingerprint of the current filter state
  const selectedP = get(selectedPathogens);
  const selectedA = get(selectedAgeGroups); 
  const selectedS = get(selectedSyndromes);
  const currentFilterState = JSON.stringify({
    p: Array.from(selectedP).sort(),
    a: Array.from(selectedA).sort(),
    s: Array.from(selectedS).sort()
  });
  
  // console.log('Filtered data changed:', {
  //   hasData,
  //   currentDataLength,
  //   previousDataLength,
  //   pointsAdded,
  //   ready,
  //   state,
  //   filterStateChanged: currentFilterState !== previousFilterState
  // });
  
  if (hasData) {
    if (!pointsAdded && ready) {
      // First load or reinitialization needed
      // Add a small delay to ensure visualization type is loaded from localStorage
      setTimeout(() => {
        checkAndInitialize();
      }, 50);
    } else if (pointsAdded && ready && state === 'ready' &&
              (currentDataLength !== previousDataLength || currentFilterState !== previousFilterState)) {
      // Data changed after initialization (filter change)
      handleFilterChange();
    }
    previousDataLength = currentDataLength;
    previousFilterState = currentFilterState;
  }
});

// Watch for visualization type changes
let previousVizType: string | null = null;
visualizationType.subscribe((newType) => {
  if (previousVizType && previousVizType !== newType) {
    const oldType = previousVizType;
    let retries = 0;
    const trySwitch = async () => {
      // Abort if the user switched again before we could run
      if (get(visualizationType) !== newType) return;
      const updating = get(isUpdatingVisualization);
      if (updating && retries < 5) {
        retries++;
        setTimeout(trySwitch, 200);
        return;
      }
      await handleVisualizationTypeChange(oldType, newType);
    };
    trySwitch();
  }
  previousVizType = newType;
});