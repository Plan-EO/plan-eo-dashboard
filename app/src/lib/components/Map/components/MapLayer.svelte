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
	import {
		spiderfyCluster,
		clearSpiderfy,
		isSpiderfyActive,
		isSpiderfiedFeature,
		zoomSpiderfyIn,
		LEAVES_LAYER_ID
	} from '../utils/spiderfy';
	import { CLUSTER_MAX_ZOOM } from '../store/mapVisualizationManager';

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

	// A filter change rebuilds clustered-source, so any fanned-out leaves would
	// be showing studies that may no longer match. Collapse them, same as the
	// point popovers (see closePointPopovers in Map.svelte).
	$: if (map && $filteredPointsData) {
		clearSpiderfy(map);
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

		// Above CLUSTER_MAX_ZOOM a fanned-out group's own points sit faded under
		// the fan's center; clicking them collapses it, like the faded cluster dot.
		// (Checked against the source too: spiderfied leaves share this handler and
		// their ids overlap clustered-source point ids.)
		const collapsesFan =
			data.feature.source === 'clustered-source' && isSpiderfiedFeature(data.feature.id);

		if (pointClickTimer) clearTimeout(pointClickTimer);
		pointClickTimer = setTimeout(() => {
			pointClickTimer = null;
			if (collapsesFan) {
				if (map) clearSpiderfy(map);
				return;
			}
			dispatch('pointclick', data);
		}, CLICK_DELAY);
	}

	// Double-click on an individual dot: cancel the pending popover and let
	// maplibre's native double-click-to-zoom handle the zoom.
	// Past CLUSTER_MAX_ZOOM, double-clicking the faded points under an open fan's
	// center zooms in around the fan instead, same as its center cluster dot.
	function handleDotDblClick(e?: any) {
		if (pointClickTimer) {
			clearTimeout(pointClickTimer);
			pointClickTimer = null;
		}
		const feature = e?.features?.[0];
		if (map && feature?.source === 'clustered-source' && isSpiderfiedFeature(feature.id)) {
			e.preventDefault();
			zoomSpiderfyIn(map);
		}
	}

	// Spiderfied leaves click like individual dots, but a double-click zooms in
	// around the fan and keeps it open instead of the native zoom (which would
	// collapse it).
	function handleLeafDblClick(e: any) {
		handleDotDblClick();
		e.preventDefault();
		if (map) zoomSpiderfyIn(map);
	}

	const spiderfyLeafHandlers = { click: handleDotClick, dblclick: handleLeafDblClick };

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

			// Clicking the faded center dot of the cluster that's currently fanned
			// out collapses it.
			if (map && isSpiderfiedFeature(feature.id)) {
				clearSpiderfy(map);
				return;
			}

			// A cluster whose own expansion zoom is past CLUSTER_MAX_ZOOM can never
			// be split further by zooming -- every point inside is at (or
			// effectively at) the exact same coordinates. Fan those out instead of
			// showing the list-menu popover.
			source
				.getClusterExpansionZoom(clusterId)
				.then((expansionZoom: number) => {
					const isStuck = expansionZoom > CLUSTER_MAX_ZOOM;

					source
						.getClusterLeaves(clusterId, Infinity, 0)
						.then((leaves: any[]) => {
							if (!leaves || leaves.length === 0) return;

							if (isStuck && map) {
								spiderfyCluster(map, coordinates, feature.id, leaves, spiderfyLeafHandlers);
								return;
							}

							// Show a popover listing every study currently grouped into this dot.
							// Queried live from the cluster index, so it reflects whatever the
							// cluster contains at the current zoom level. maplibre-gl 5's
							// getClusterLeaves returns a Promise (no callback param).
							dispatch('pointclick', {
								feature: leaves[0],
								coordinates,
								properties: leaves[0].properties,
								multipleFeatures: leaves
							});
						})
						.catch((err: any) => console.error('Failed to get cluster leaves:', err));
				})
				.catch((err: any) => console.error('Failed to get cluster expansion zoom:', err));
		}, CLICK_DELAY);
	}

	// Padding (px) kept around a cluster's studies when a double-click zooms to fit them.
	const CLUSTER_FIT_PADDING = 80;
	// Zoom levels to stop short of a tight fit, leaving some surrounding context
	// (each level is 2x, so 1 shows roughly twice the width of the studies' extent).
	const CLUSTER_FIT_ZOOM_BACKOFF = 1;
	// Most zoom levels a single cluster double-click may jump (each level is 2x).
	const CLUSTER_MAX_ZOOM_JUMP = 5;

	// Double-click on a cluster: cancel the pending popover and zoom to fit every
	// study in the cluster, so one double-click lands on the area the user was
	// pointing at instead of stepping in a level or two at a time.
	function handleClusterDblClick(e: any) {
		if (clusterClickTimer) {
			clearTimeout(clusterClickTimer);
			clusterClickTimer = null;
		}
		if (!map || !e.features || e.features.length === 0) return;

		// Prevent native double-click zoom now (synchronously); we'll zoom ourselves
		// once the (async) expansion zoom and leaves come back from the cluster index.
		e.preventDefault();

		const feature = e.features[0];

		// Double-clicking the faded center dot of an open fan keeps zooming in,
		// same as double-clicking one of its leaves.
		if (isSpiderfiedFeature(feature.id)) {
			zoomSpiderfyIn(map);
			return;
		}

		const clusterId = feature.properties.cluster_id;
		const coordinates = (feature.geometry as any).coordinates as [number, number];
		const source = map.getSource('clustered-source') as any;
		if (!source) return;

		// maplibre-gl 5's getClusterExpansionZoom/getClusterLeaves return Promises.
		Promise.all([
			source.getClusterExpansionZoom(clusterId),
			source.getClusterLeaves(clusterId, Infinity, 0)
		])
			.then(([expansionZoom, leaves]: [number, any[]]) => {
				if (!map || !leaves || leaves.length === 0) return;

				// A "stuck" cluster (see handleClusterClick) has nothing to zoom to --
				// expansionZoom is just Supercluster's maxZoom+1 fallback for a cluster
				// that can never actually split, since every point is at the same
				// coordinates. Zooming there anyway jumps past clusterMaxZoom into
				// unclustered points-layer, where all those coincident points render
				// stacked at the exact same pixel. Spiderfy instead, same as a single click.
				if (expansionZoom > CLUSTER_MAX_ZOOM) {
					spiderfyCluster(map, coordinates, feature.id, leaves, spiderfyLeafHandlers);
					return;
				}

				let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
				for (const leaf of leaves) {
					const [lng, lat] = leaf.geometry.coordinates;
					if (lng < minLng) minLng = lng;
					if (lng > maxLng) maxLng = lng;
					if (lat < minLat) minLat = lat;
					if (lat > maxLat) maxLat = lat;
				}
				const camera = map.cameraForBounds(
					[[minLng, minLat], [maxLng, maxLat]],
					{ padding: CLUSTER_FIT_PADDING }
				);

				// Aim to zoom in at least to the cluster's own split point (so the
				// double-click breaks it apart), stopping at CLUSTER_MAX_ZOOM. But never
				// jump more than CLUSTER_MAX_ZOOM_JUMP levels at once: a tight cluster
				// seen from a continent-wide view would otherwise dive to street level
				// in one go. It may then take another double-click to split it.
				const fitZoom = (camera?.zoom ?? expansionZoom) - CLUSTER_FIT_ZOOM_BACKOFF;
				const targetZoom = Math.max(expansionZoom, Math.min(fitZoom, CLUSTER_MAX_ZOOM));
				const zoom = Math.min(targetZoom, map.getZoom() + CLUSTER_MAX_ZOOM_JUMP);
				const center = camera?.center ?? coordinates;

				// flyTo pulls back slightly and arcs in, which keeps big jumps easier to
				// follow than easeTo's straight glide.
				map.flyTo({ center, zoom });
			})
			.catch((err: any) => console.error('Failed to zoom to cluster:', err));
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

		// Dismiss an active spiderfy fan-out when the user clicks anywhere that
		// isn't one of its leaves or another cluster (which clears it itself via
		// spiderfyCluster's own clearSpiderfy call).
		map.on('click', handleBackgroundClickForSpiderfy);
	}

	function handleBackgroundClickForSpiderfy(e: any) {
		if (!map || !isSpiderfyActive(map)) return;
		const hits = map.queryRenderedFeatures(e.point, { layers: [LEAVES_LAYER_ID, 'clusters'] });
		// The faded points under the fan's center are handled by handleDotClick.
		const fadedPointHit = map.getLayer('points-layer')
			? map
					.queryRenderedFeatures(e.point, { layers: ['points-layer'] })
					.some((f) => isSpiderfiedFeature(f.id))
			: false;
		if (hits.length === 0 && !fadedPointHit) {
			clearSpiderfy(map);
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

		map.off('click', handleBackgroundClickForSpiderfy);
		clearSpiderfy(map);
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
