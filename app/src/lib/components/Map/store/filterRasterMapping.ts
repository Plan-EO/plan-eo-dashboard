import { derived, get, writable } from 'svelte/store';
import type { FilterToRasterMapping } from '$lib/types';
import {
  selectedPathogens,
  selectedAgeGroups,
  selectedSyndromes,
  ageGroupValToLab,
  syndromeValToLab
} from '$lib/stores/filter.store';
import {
  rasterLayers,
  updateRasterLayerVisibility,
  updateRasterLayerIsActive
} from '$lib/stores/raster.store';
import { loadRasterConfig, getLayerId } from '$lib/services/rasterConfig';

// Writable store — populated after config loads
export const filterToRasterMappings = writable<FilterToRasterMapping[]>([]);

/**
 * Load config and build filter-to-raster mappings for pathogen layers.
 * Called once at app startup.
 */
export async function loadFilterRasterMappings(): Promise<void> {
  const config = await loadRasterConfig();
  const mappings: FilterToRasterMapping[] = [];

  for (const layer of config.layers) {
    // Only pathogen layers have filter mappings
    if (layer.type !== 'Pathogen' || !layer.pathogen || !layer.ageGroup || !layer.syndrome) continue;

    const layerId = getLayerId(layer.path);

    mappings.push({
      pathogen: layer.pathogen,
      ageGroup: layer.ageGroup,
      syndrome: layer.syndrome,
      layerId
    });

    // Also map "inpatient" to the same layer (current behavior)
    if (layer.syndrome === 'Medically attended diarrhea - outpatient') {
      mappings.push({
        pathogen: layer.pathogen,
        ageGroup: layer.ageGroup,
        syndrome: 'Medically attended diarrhea - inpatient',
        layerId
      });
    }
  }

  filterToRasterMappings.set(mappings);
}

// Derived store that calculates which raster layers should be visible based on filter selections
export const autoVisibleRasterLayers = derived(
  [selectedPathogens, selectedAgeGroups, selectedSyndromes, rasterLayers, ageGroupValToLab, syndromeValToLab, filterToRasterMappings],
  ([$selectedPathogens, $selectedAgeGroups, $selectedSyndromes, $rasterLayers, $ageGroupValToLab, $syndromeValToLab, $filterToRasterMappings]) => {
    // If no filters are selected, no layers should be auto-shown
    if ($selectedPathogens.size === 0 && $selectedAgeGroups.size === 0 && $selectedSyndromes.size === 0) {
      return new Set<string>();
    }

    const matchingLayerIds = new Set<string>();

    const selectedAgeGroupLabs = new Set<string>();
    $selectedAgeGroups.forEach(val => {
      const lab = $ageGroupValToLab.get(val);
      if (lab) {
        selectedAgeGroupLabs.add(lab.replace('^^', ''));
      }
    });

    const selectedSyndromeLabs = new Set<string>();
    $selectedSyndromes.forEach(val => {
      const lab = $syndromeValToLab.get(val);
      if (lab) {
        selectedSyndromeLabs.add(lab.replace('^^', ''));
      }
    });

    $filterToRasterMappings.forEach(mapping => {
      const pathogenMatch = $selectedPathogens.has(mapping.pathogen);
      const ageGroupMatch = selectedAgeGroupLabs.has(mapping.ageGroup);
      const syndromeMatch = selectedSyndromeLabs.has(mapping.syndrome);

      if (pathogenMatch && ageGroupMatch && syndromeMatch) {
        matchingLayerIds.add(mapping.layerId);
      }
    });

    return matchingLayerIds;
  }
);

// Controls whether auto-matched raster layers are shown on the map
export const rasterVisualizationEnabled = writable(true);

// Subscribe to changes in the autoVisibleRasterLayers store and update layer visibility
let previousAutoShownLayers = new Set<string>();

export function initFilterRasterConnection() {
  return autoVisibleRasterLayers.subscribe(($autoVisibleRasterLayers) => {
    const enabled = get(rasterVisualizationEnabled);
    const currentLayers = get(rasterLayers);

    // Deactivate layers that are no longer matched by the current filter selection
    previousAutoShownLayers.forEach(layerId => {
      if (!$autoVisibleRasterLayers.has(layerId)) {
        const layer = currentLayers.get(layerId);
        if (layer && layer.autoShown) {
          updateRasterLayerVisibility(layerId, false);
          updateRasterLayerIsActive(layerId, false);
          rasterLayers.update(layers => {
            const l = layers.get(layerId);
            if (l) l.autoShown = false;
            return new Map(layers);
          });
        }
      }
    });

    // Activate newly matched layers; only show on map if the toggle is on
    $autoVisibleRasterLayers.forEach(layerId => {
      const layer = currentLayers.get(layerId);
      if (layer && !layer.autoShown) {
        if (enabled) updateRasterLayerVisibility(layerId, true);
        updateRasterLayerIsActive(layerId, true);
        rasterLayers.update(layers => {
          const l = layers.get(layerId);
          if (l) l.autoShown = true;
          return new Map(layers);
        });
      }
    });

    previousAutoShownLayers = new Set($autoVisibleRasterLayers);
  });
}
