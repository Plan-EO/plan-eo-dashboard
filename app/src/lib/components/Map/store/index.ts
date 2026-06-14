// Re-export all public facing types
// export * from './types'; // Types are now in $lib/types.ts and should be imported directly

// Re-export stores from new locations
export {
  pointsData,
  isLoading,
  loadingMessage,
  dataError,
  pathogenColors,
  dataUpdateDate
} from '$lib/stores/data.store';
export {
  pathogenIndex,
  ageGroupIndex,
  syndromeIndex,
  pathogens,
  ageGroups,
  syndromes,
  selectedPathogens,
  selectedAgeGroups,
  selectedSyndromes,
  ageGroupValToLab,
  ageGroupLabToVal,
  syndromeValToLab,
  syndromeLabToVal
} from '$lib/stores/filter.store';
export {
  visualizationType,
  switchVisualization,
  type VisualizationType, // This type is also in map.store.ts
  barThickness
} from '$lib/stores/map.store'; // Ensure VisualizationType is exported there
export {
  rasterLayers,
  addRasterLayerFromUrl,
  loadRasterLayersFromConfig,
  updateRasterLayerVisibility,
  updateRasterLayerIsActive,
  updateRasterLayerOpacity,
  updateAllRasterLayersOpacity,
  removeRasterLayer,
  fetchAndSetLayerBounds
} from '$lib/stores/raster.store';

// Re-export filter-to-raster mapping functionality
export {
  autoVisibleRasterLayers,
  initFilterRasterConnection,
  rasterVisualizationEnabled,
  filterToRasterMappings,
  loadFilterRasterMappings
} from './filterRasterMapping';

// Re-export the filter manager functions from the new filter store
export {
  filteredIndices,
  filteredPointsData,
  clearFilterCache,
  pathogenCounts,
  ageGroupCounts,
  syndromeCounts
} from '$lib/stores/filter.store';

// Re-export the data loader
export { loadPointsData } from '../utils/dataLoader';

// Re-export the GeoJSON converter
export { convertCsvToGeoJson } from '../utils/geoJsonConverter';

// Re-export the color manager
export { generateColors } from '../utils/colorManager';

// Re-export the maplibre helpers
export { getMaplibreFilterExpression } from '../utils/maplibreHelpers';

// Re-export map state stores from mapState.store.ts
export {
  mapInstance,
  pointsAddedToMap,
  isUpdatingVisualization,
  isProgrammaticSwitching,
  isAdjustingLayerOrder,
  setMapInstance,
  setPointsAddedToMap,
  setMapReady,
  handleFilterChange
} from '$lib/stores/mapState.store';

// Re-export map visualization functions
export {
  updateMapVisualization,
  forceVisualizationUpdate,
  handleMapContentChange,
  addInitialPointsToMap,
  switchVisualizationType
} from './mapVisualizationManager';

// Re-export data points visibility functions
export {
  dataPointsVisible,
  toggleDataPointsVisibility,
  updateDataPointsVisibility,
  applyDataPointsVisibility
} from '$lib/stores/dataPointsVisibility.store';
