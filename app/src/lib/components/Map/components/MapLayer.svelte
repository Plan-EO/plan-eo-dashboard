<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { filteredPointsData } from '$lib/stores/filter.store';
	import { dataError } from '$lib/stores/data.store';
	import { visualizationType } from '$lib/stores/map.store';
	import {
		mapInstance,
		initializationState,
		pointsAddedToMap,
		isUpdatingVisualization,
		isProgrammaticSwitching,
		isAdjustingLayerOrder,
		canInitializeMap,
		mapLoaded,
		hasData,
		isProgrammaticOperation,
		setMapInstance,
		setInitializationState,
		setPointsAddedToMap,
		setMapReady
	} from '$lib/stores/mapState.store';
	// Import removed - visualization switching handled by store

	// Props
	export let map: MaplibreMap | null = null;

	// Event dispatcher for selected point
	const dispatch = createEventDispatcher();

	// Local state for tracking initialization
	let localMapSet = false;
	let localEventHandlersSet = false;
	let isInitialStyleLoad = true; // Track if this is the first style load

	// Set the map instance in the store when it becomes available
	$: if (map && !localMapSet) {
		setMapInstance(map);
		localMapSet = true;

		// Wait for map to be fully loaded and idle before marking as ready
		if (map.loaded()) {
			// Map is already loaded, wait for idle state
			map.once('idle', () => {
				setMapReady(true);
				setInitializationState('idle');
			});
		} else {
			// Wait for map load event, then idle
			map.once('load', () => {
				map.once('idle', () => {
					setMapReady(true);
					setInitializationState('idle');
				});
			});
		}

		// Listen for source data events to track when layers are added
		map.on('sourcedata', (e) => {
			if (e.isSourceLoaded && e.sourceId === 'points-source' && e.source) {
				// Source has been added, setup event handlers
				if ($initializationState === 'ready' && !localEventHandlersSet) {
					setupEventHandlers();
					localEventHandlersSet = true;
				}
			}
		});
	}

	// The store will handle initialization automatically
	// We just need to react to state changes for UI updates

	// Log state changes for debugging
	// $: console.log('MapLayer state:', {
	// 	mapLoaded: $mapLoaded,
	// 	hasData: $hasData,
	// 	pointsAdded: $pointsAddedToMap,
	// 	initializationState: $initializationState,
	// 	canInit: $canInitializeMap,
	// 	dataLength: $filteredPointsData?.features?.length || 0
	// });

	// React to successful initialization
	$: if ($initializationState === 'ready' && map && !localEventHandlersSet) {
		// console.log('Initialization complete, setting up event handlers');
		setupEventHandlers();
		if (map) {
			map.on('styledata', handleStyleChange);
		}
		localEventHandlersSet = true;
	}

	// Define event handlers
	function handlePointClick(e: any) {
		if (e.features && e.features.length > 0) {
			const feature = e.features[0];
			let coordinates;

			// Handle different geometry types
			if (feature.geometry.type === 'Point') {
				// For dots and pie charts (Point geometry)
				coordinates = feature.geometry.coordinates.slice();
			} else if (feature.geometry.type === 'Polygon') {
				// For 3D bars (Polygon geometry) - get the center of the polygon
				const polygonCoords = feature.geometry.coordinates[0]; // First ring of the polygon
				// Calculate center point of the polygon
				let sumLng = 0,
					sumLat = 0;
				const numPoints = polygonCoords.length - 1; // Exclude the closing point
				for (let i = 0; i < numPoints; i++) {
					sumLng += polygonCoords[i][0];
					sumLat += polygonCoords[i][1];
				}
				coordinates = [sumLng / numPoints, sumLat / numPoints];
			} else {
				// Fallback for other geometry types
				coordinates = feature.geometry.coordinates.slice();
			}

			const properties = feature.properties;

			dispatch('pointclick', {
				feature,
				coordinates,
				properties
			});
		}
	}

	function handleMouseEnter() {
		if (map) map.getCanvas().style.cursor = 'pointer';
	}

	function handleMouseLeave() {
		if (map) map.getCanvas().style.cursor = '';
	}

	// Setup event handlers for all visualization types
	function setupEventHandlers() {
		if (!map) return;

		if (map.getLayer('points-layer')) {
			console.log('Adding click listener to points-layer');
			map.on('click', 'points-layer', handlePointClick);
			map.on('mouseenter', 'points-layer', handleMouseEnter);
			map.on('mouseleave', 'points-layer', handleMouseLeave);
		} else {
			console.log('points-layer not found when trying to add listeners');
		}

		// Add event handlers for single pie chart layer
		if (map.getLayer('pie-charts')) {
			map.on('click', 'pie-charts', handlePointClick);
			map.on('mouseenter', 'pie-charts', handleMouseEnter);
			map.on('mouseleave', 'pie-charts', handleMouseLeave);
		}

	}

	// Remove event handlers
	function removeEventHandlers() {
		if (!map) return;

		if (map.getLayer('points-layer')) {
			map.off('click', 'points-layer', handlePointClick);
			map.off('mouseenter', 'points-layer', handleMouseEnter);
			map.off('mouseleave', 'points-layer', handleMouseLeave);
		}

		// Remove event handlers for single pie chart layer
		if (map.getLayer('pie-charts')) {
			map.off('click', 'pie-charts', handlePointClick);
			map.off('mouseenter', 'pie-charts', handleMouseEnter);
			map.off('mouseleave', 'pie-charts', handleMouseLeave);
		}

	}

	// Track the last visualization type to detect changes
	let lastVisualizationType: string | null = null;

	// Watch for visualization type changes and re-attach handlers when needed
	$: if (
		map &&
		$mapLoaded &&
		$initializationState === 'ready' &&
		$visualizationType !== lastVisualizationType
	) {
		// Only re-attach if visualization type actually changed and not the first time
		if (lastVisualizationType !== null) {
			// Check if any of our visualization layers exist
			const hasPointsLayer = map.getLayer('points-layer');
			const hasPieChartLayers = map.getLayer('pie-charts');

			if (hasPointsLayer || hasPieChartLayers) {
				// Wait for map to be idle after visualization change
				console.log('Waiting for idle state to re-attach event handlers');
				map.once('idle', () => {
					console.log('Re-attaching event handlers after visualization change');
					removeEventHandlers(); // Clean up any existing handlers first
					setupEventHandlers(); // Attach fresh handlers
				});
			}
		}

		lastVisualizationType = $visualizationType;
	}

	// Handle style changes
	function handleStyleChange() {
		// Check both the derived store and individual flags for immediate response
		if ($isProgrammaticOperation || $isAdjustingLayerOrder) {
			console.log('Style change detected during programmatic operation, ignoring in MapLayer.');
			return;
		}

		// Skip reset on initial style load
		if (isInitialStyleLoad) {
			console.log('Initial style load detected, skipping reset');
			isInitialStyleLoad = false;

			// Still ensure map is ready after initial style load
			if (map && $hasData) {
				map.once('idle', () => {
					console.log('Map idle after initial style load, setting ready state');
					if (map.loaded()) {
						setMapReady(true);
					}
				});
			}
			return;
		}

		console.log('Style change detected (external/unexpected), reinitializing visualization...');
		setPointsAddedToMap(false);
		setInitializationState('idle');

		// Wait for map to be idle after style change
		if (map && $hasData) {
			map.once('idle', () => {
				console.log('Map idle after style change, setting ready state');
				if (map.loaded()) {
					setMapReady(true);
				}
			});
		}
	}

	onMount(() => {
		console.log('MapLayer component mounted');
	});

	onDestroy(() => {
		console.log('MapLayer component destroying');
		if (map) {
			removeEventHandlers();
			map.off('styledata', handleStyleChange);
		}
		setMapInstance(null);
		setPointsAddedToMap(false);
	});

	// Visualization switching is now handled centrally by the store
</script>

{#if $dataError}
	<div class="map-error">
		<p>Error loading data: {$dataError}</p>
	</div>
{/if}
