<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import { filteredPointsData } from '$lib/stores/filter.store';
	import { dataError } from '$lib/stores/data.store';
	import { visualizationType } from '$lib/stores/map.store';
	import { selectedMapStyle } from '$lib/stores/mapStyle.store';
	import {
		mapInstance,
		initializationState,
		pointsAddedToMap,
		canInitializeMap,
		mapLoaded,
		hasData,
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
			const isRelevantSource = e.sourceId === 'points-source' || e.sourceId === 'clustered-source';
			if (e.isSourceLoaded && isRelevantSource && e.source) {
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

	// Delay before committing to a single-click action, so a following dblclick can cancel it.
	const CLICK_DELAY = 250;
	let pointClickTimer: ReturnType<typeof setTimeout> | null = null;
	let clusterClickTimer: ReturnType<typeof setTimeout> | null = null;

	// Shared geometry -> click-payload extraction for point-like layers
	function extractPointClickData(e: any): { feature: any; coordinates: any; properties: any } | null {
		if (!e.features || e.features.length === 0) return null;
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

		return { feature, coordinates, properties: feature.properties };
	}

	// Dots (points-layer): single click is delayed so a following dblclick can cancel
	// it and zoom instead.
	function handleDotClick(e: any) {
		const data = extractPointClickData(e);
		if (!data) return;

		if (pointClickTimer) clearTimeout(pointClickTimer);
		pointClickTimer = setTimeout(() => {
			pointClickTimer = null;
			dispatch('pointclick', data);
		}, CLICK_DELAY);
	}

	// Double-click on an individual dot: cancel the pending popover and let
	// maplibre's native double-click-to-zoom handle the zoom.
	function handleDotDblClick() {
		if (pointClickTimer) {
			clearTimeout(pointClickTimer);
			pointClickTimer = null;
		}
	}

	// Pie charts: unchanged immediate single-click behavior (not part of this change).
	function handlePieClick(e: any) {
		const data = extractPointClickData(e);
		if (!data) return;
		dispatch('pointclick', data);
	}

	function handleMouseEnter() {
		if (map) map.getCanvas().style.cursor = 'pointer';
	}

	function handleMouseLeave() {
		if (map) map.getCanvas().style.cursor = '';
	}

	// Hover affordance for dots/clusters: a slight radius bump on the hovered
	// feature, driven by feature-state (see the paint expressions in
	// mapVisualizationManager.ts).
	let hoveredDotId: string | number | null = null;
	let hoveredClusterId: string | number | null = null;

	function handleDotHover(e: any) {
		if (map) map.getCanvas().style.cursor = 'pointer';
		if (!map || !e.features || e.features.length === 0) return;
		const feature = e.features[0];
		if (feature.id === undefined || feature.id === hoveredDotId) return;

		if (hoveredDotId !== null) {
			map.setFeatureState({ source: 'clustered-source', id: hoveredDotId }, { hover: false });
		}
		hoveredDotId = feature.id;
		map.setFeatureState({ source: 'clustered-source', id: hoveredDotId }, { hover: true });
	}

	function handleDotHoverLeave() {
		if (map) {
			map.getCanvas().style.cursor = '';
			if (hoveredDotId !== null) {
				map.setFeatureState({ source: 'clustered-source', id: hoveredDotId }, { hover: false });
			}
		}
		hoveredDotId = null;
	}

	function handleClusterHover(e: any) {
		if (map) map.getCanvas().style.cursor = 'pointer';
		if (!map || !e.features || e.features.length === 0) return;
		const feature = e.features[0];
		if (feature.id === undefined || feature.id === hoveredClusterId) return;

		if (hoveredClusterId !== null) {
			map.setFeatureState({ source: 'clustered-source', id: hoveredClusterId }, { hover: false });
		}
		hoveredClusterId = feature.id;
		map.setFeatureState({ source: 'clustered-source', id: hoveredClusterId }, { hover: true });
	}

	function handleClusterHoverLeave() {
		if (map) {
			map.getCanvas().style.cursor = '';
			if (hoveredClusterId !== null) {
				map.setFeatureState({ source: 'clustered-source', id: hoveredClusterId }, { hover: false });
			}
		}
		hoveredClusterId = null;
	}

	function handleClusterClick(e: any) {
		if (!map || !e.features || e.features.length === 0) return;
		const feature = e.features[0];
		const clusterId = feature.properties.cluster_id;
		const coordinates = (feature.geometry as any).coordinates as [number, number];
		const source = map.getSource('clustered-source') as any;
		if (!source) return;

		// Delay so a second click (dblclick) can cancel this and zoom instead
		if (clusterClickTimer) clearTimeout(clusterClickTimer);
		clusterClickTimer = setTimeout(() => {
			clusterClickTimer = null;
			// Show a popover listing every study currently grouped into this dot.
			// Queried live from the cluster index, so it reflects whatever the
			// cluster contains at the current zoom level. maplibre-gl 5's
			// getClusterLeaves returns a Promise (no callback param).
			source
				.getClusterLeaves(clusterId, Infinity, 0)
				.then((leaves: any[]) => {
					if (!leaves || leaves.length === 0) return;
					dispatch('pointclick', {
						feature: leaves[0],
						coordinates,
						properties: leaves[0].properties,
						multipleFeatures: leaves
					});
				})
				.catch((err: any) => console.error('Failed to get cluster leaves:', err));
		}, CLICK_DELAY);
	}

	// Double-click on a cluster: cancel the pending popover and zoom straight to the
	// level where this cluster splits, instead of the generic +1 native zoom.
	function handleClusterDblClick(e: any) {
		if (clusterClickTimer) {
			clearTimeout(clusterClickTimer);
			clusterClickTimer = null;
		}
		if (!map || !e.features || e.features.length === 0) return;

		// Prevent native double-click zoom now (synchronously); we'll zoom ourselves
		// once the (async) expansion zoom comes back from the cluster index.
		e.preventDefault();

		const feature = e.features[0];
		const clusterId = feature.properties.cluster_id;
		const coordinates = (feature.geometry as any).coordinates as [number, number];
		const source = map.getSource('clustered-source') as any;
		if (!source) return;

		// maplibre-gl 5's getClusterExpansionZoom returns a Promise (no callback param).
		source
			.getClusterExpansionZoom(clusterId)
			.then((zoom: number) => {
				if (!map) return;
				map.easeTo({ center: coordinates, zoom });
			})
			.catch((err: any) => console.error('Failed to get cluster expansion zoom:', err));
	}

	// Setup event handlers for all visualization types.
	// Always removes before re-adding so it is safe to call multiple times.
	function setupEventHandlers() {
		if (!map) return;

		// Remove first to prevent duplicate listeners
		removeEventHandlers();

		if (map.getLayer('points-layer')) {
			map.on('click', 'points-layer', handleDotClick);
			map.on('dblclick', 'points-layer', handleDotDblClick);
			map.on('mousemove', 'points-layer', handleDotHover);
			map.on('mouseleave', 'points-layer', handleDotHoverLeave);
		}

		if (map.getLayer('clusters')) {
			map.on('click', 'clusters', handleClusterClick);
			map.on('dblclick', 'clusters', handleClusterDblClick);
			map.on('mousemove', 'clusters', handleClusterHover);
			map.on('mouseleave', 'clusters', handleClusterHoverLeave);
		}

		if (map.getLayer('pie-charts')) {
			map.on('click', 'pie-charts', handlePieClick);
			map.on('mouseenter', 'pie-charts', handleMouseEnter);
			map.on('mouseleave', 'pie-charts', handleMouseLeave);
		}
	}

	// Remove event handlers
	function removeEventHandlers() {
		if (!map) return;

		if (map.getLayer('points-layer')) {
			map.off('click', 'points-layer', handleDotClick);
			map.off('dblclick', 'points-layer', handleDotDblClick);
			map.off('mousemove', 'points-layer', handleDotHover);
			map.off('mouseleave', 'points-layer', handleDotHoverLeave);
		}

		if (map.getLayer('clusters')) {
			map.off('click', 'clusters', handleClusterClick);
			map.off('dblclick', 'clusters', handleClusterDblClick);
			map.off('mousemove', 'clusters', handleClusterHover);
			map.off('mouseleave', 'clusters', handleClusterHoverLeave);
		}

		// Remove event handlers for single pie chart layer
		if (map.getLayer('pie-charts')) {
			map.off('click', 'pie-charts', handlePieClick);
			map.off('mouseenter', 'pie-charts', handleMouseEnter);
			map.off('mouseleave', 'pie-charts', handleMouseLeave);
		}
	}

	// Track the last visualization type to detect changes
	let lastVisualizationType: string | null = null;

	// 'styledata' fires for all sorts of benign internal changes (tile loads,
	// layer reordering, paint/layout property changes) as well as a genuine
	// user-initiated base map style swap, so it can't reliably be used on its
	// own to decide whether to reset everything. The only place a real style
	// swap happens is setMapStyle() (MapStyleManager.ts), which always updates
	// selectedMapStyle right before calling map.setStyle(). Use that as the
	// deterministic signal instead of guessing from event timing.
	let lastKnownMapStyleId: string | null = $selectedMapStyle?.id ?? null;

	// Watch for visualization type changes and re-attach handlers when needed
	$: if (
		map &&
		$mapLoaded &&
		$initializationState === 'ready' &&
		$visualizationType !== lastVisualizationType
	) {
		const newVizType = $visualizationType;
		// Only re-attach if visualization type actually changed and not the first time
		if (lastVisualizationType !== null) {
			// The layer swap for the new type happens asynchronously elsewhere (and can
			// be delayed further while mapState.store's own switch waits out an
			// in-progress update), so poll for the new type's layer to actually exist
			// rather than trusting a single 'idle' event, which can fire before the
			// swap finishes and leave handlers bound to nothing.
			let attempts = 0;
			const waitForNewLayers = () => {
				if (!map) return;
				const layersReady =
					newVizType === 'pie-charts'
						? !!map.getLayer('pie-charts')
						: !!map.getLayer('points-layer') || !!map.getLayer('clusters');
				attempts++;
				if (layersReady || attempts >= 20) {
					removeEventHandlers();
					setupEventHandlers();
					return;
				}
				setTimeout(waitForNewLayers, 150);
			};
			waitForNewLayers();
		}

		lastVisualizationType = $visualizationType;
	}

	// Handle style changes
	function handleStyleChange() {
		// Only a genuine base map style swap should reset the point/cluster
		// layers. Everything else that fires 'styledata' (tile loads, layer
		// reordering, paint/layout tweaks, our own data updates, etc.) is noise
		// for this purpose and should be ignored.
		const currentStyleId = $selectedMapStyle?.id ?? null;
		if (currentStyleId === lastKnownMapStyleId) {
			return;
		}
		lastKnownMapStyleId = currentStyleId;

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
