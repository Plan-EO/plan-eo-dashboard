<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import {
		rasterLayers,
		updateRasterLayerVisibility,
		updateRasterLayerOpacity,
		updateAllRasterLayersOpacity,
		isAdjustingLayerOrder
	} from '../store';
	import {
		syncRasterLayers,
		updateRasterLayerOpacity as updateOpacity
	} from '../utils/RasterLayerSync';
	import { serializeFiltersToUrl } from '../utils/urlParams';

	// Props
	export let map: MaplibreMap | null = null;
	export let isStyleLoaded: boolean = false;
	export let globalOpacity: number = 80; // Default to 80%

	// Track layers currently on the map
	let currentMapLayers = new Set<string>();
	
	// Track if we've already ensured layer order to prevent loops
	let hasEnsuredLayerOrder = false;
	let layerOrderTimeout: ReturnType<typeof setTimeout> | null = null;

	// Function to check if a layer is already at the top
	function isLayerAtTop(map: MaplibreMap, layerId: string): boolean {
		const layers = map.getStyle()?.layers;
		if (!layers || layers.length === 0) return false;
		
		// Find the position of our layer
		const layerIndex = layers.findIndex(l => l.id === layerId);
		if (layerIndex === -1) return false;
		
		// Check if any non-system layers are above it
		for (let i = layerIndex + 1; i < layers.length; i++) {
			const layer = layers[i];
			// Ignore symbol layers and maplibre internal layers
			if (!layer.id.startsWith('maplibre-') && layer.type !== 'symbol') {
				return false;
			}
		}
		return true;
	}

	// Function to ensure correct layering of points and boundaries over rasters
	export function ensureCorrectLayerOrder() {
		if (!map) return;
		
		// Check if we actually need to move any layers
		let needsReordering = false;
		const layersToCheck = [
			'country-boundaries-layer',
			'points-layer',
			'pie-charts',
			'pie-charts-large',
			'pie-charts-medium',
			'pie-charts-small'
		];
		
		// First check if any layers need moving
		for (const layerId of layersToCheck) {
			if (map.getLayer(layerId) && !isLayerAtTop(map, layerId)) {
				needsReordering = true;
				break;
			}
		}
		
		// Only proceed if reordering is actually needed
		if (!needsReordering) {
			return;
		}
		
		isAdjustingLayerOrder.set(true);
		
		try {
			// First, move country boundaries (will be below points/data layers)
			if (map.getLayer('country-boundaries-layer')) {
				map.moveLayer('country-boundaries-layer');
			}
			
			// Then move all possible data visualization layers to top
			// The order matters - last moved will be on top
			
			// Dots layer
			if (map.getLayer('points-layer')) {
				map.moveLayer('points-layer');
			}
			
			// Single pie chart layer (new approach)
			if (map.getLayer('pie-charts')) {
				map.moveLayer('pie-charts');
			}
			
			// Multiple pie chart layers (legacy approach, just in case)
			const pieChartLayerIds = ['pie-charts-large', 'pie-charts-medium', 'pie-charts-small'];
			pieChartLayerIds.forEach((layerId) => {
				if (map.getLayer(layerId)) {
					map.moveLayer(layerId);
				}
			});
		} catch (e) {
			console.error('RasterLayerManager: Error during ensureCorrectLayerOrder:', e);
		} finally {
			// Use idle event to ensure MapLibre has processed all layer operations
			if (map.loaded()) {
				map.once('idle', () => {
					isAdjustingLayerOrder.set(false);
				});
			} else {
				// Fallback if map is not loaded
				isAdjustingLayerOrder.set(false);
			}
		}
	}

	// Debounced callback for ensuring layer order after raster changes
	function debouncedEnsureLayerOrder() {
		// Clear any existing timeout
		if (layerOrderTimeout) {
			clearTimeout(layerOrderTimeout);
		}
		
		// Set a new timeout to ensure layer order after a delay
		layerOrderTimeout = setTimeout(() => {
			if (!hasEnsuredLayerOrder) {
				hasEnsuredLayerOrder = true;
				ensureCorrectLayerOrder();
				// Reset the flag after a delay to allow future adjustments
				setTimeout(() => {
					hasEnsuredLayerOrder = false;
				}, 1000);
			}
		}, 200);
	}

	// Sync map layers when raster layers or map state changes
	$: if (map && isStyleLoaded) {
		syncRasterLayers($rasterLayers, map, isStyleLoaded, currentMapLayers, debouncedEnsureLayerOrder);
	}

	// Update opacity when raster layers change
	$: if (map && isStyleLoaded) {
		updateOpacity(map, isStyleLoaded, $rasterLayers);
	}

	// Toggle country boundaries layer visibility based on visible raster layers
	$: if (map && isStyleLoaded && map.getLayer('country-boundaries-layer')) {
		const visibleRasterLayerCount = Array.from($rasterLayers.values()).filter(
			(layer) => layer.isVisible
		).length;
		const countryBoundariesVisibility = visibleRasterLayerCount > 0 ? 'visible' : 'none';
		if (
			map.getLayoutProperty('country-boundaries-layer', 'visibility') !==
			countryBoundariesVisibility
		) {
			map.setLayoutProperty('country-boundaries-layer', 'visibility', countryBoundariesVisibility);
		}
	}

	// Update URL when opacity changes
	function handleOpacityChange(newOpacity: number) {
		globalOpacity = newOpacity;
		updateAllRasterLayersOpacity(newOpacity / 100);

		// Update URL
		if (map) {
			serializeFiltersToUrl(map, newOpacity);
		}
	}

	// Clean up on component destruction
	onDestroy(() => {
		// Clear any pending timeouts
		if (layerOrderTimeout) {
			clearTimeout(layerOrderTimeout);
		}
	});
</script>

{#if map && isStyleLoaded}
	<!-- This component doesn't render anything visible -->
	<!-- It just manages the raster layers on the map -->
{/if}
