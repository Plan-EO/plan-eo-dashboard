<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { getStyleById } from './MapStyles';
	import { selectedMapStyle } from '$lib/stores/mapStyle.store';
	import {
		loadPointsData,
		isLoading,
		loadingMessage,
		dataError,
		pointsData,
		filteredPointsData,
		rasterLayers,
		updateAllRasterLayersOpacity,
		pathogens,
		ageGroups,
		syndromes,
		selectedPathogens,
		selectedAgeGroups,
		selectedSyndromes,
		ageGroupValToLab,
		syndromeValToLab,
		clearFilterCache,
		pointsAddedToMap
	} from './store';
	import { parseUrlFilters, serializeFiltersToUrl, debounce } from './utils/urlParams';
	import { processPathogenData } from './utils/csvDataProcessor';
	import { isClickOnVisibleRaster } from './utils/rasterClickUtils';
	import { preloadData } from './utils/MapInitializer';
	import {
		getRasterValueAtCoordinate,
		getRasterValueAtCoordinateFast,
		findVisibleRasterLayerAtCoordinate,
		isLatitudeInWebMercatorRange
	} from './utils/rasterPixelQuery';
	import { WEB_MERCATOR_MAX_LATITUDE } from './utils/geoTiffProcessor';
	import { loadAndProcessGeoTIFF } from './utils/geoTiffProcessor';

	// Import modularized components
	import MapCore from './components/MapCore.svelte';
	import MapControls from './components/MapControls.svelte';
	import RasterLayerManager from './components/RasterLayerManager.svelte';
	import MapLayer from './components/MapLayer.svelte';
	import LayerManager from './components/LayerManager.svelte';
	import MapPopover from './components/MapPopover.svelte';
	import MapLegend from './components/MapLegend.svelte';
	import MultiPointPopover from './components/MultiPointPopover.svelte';
	import RasterLegend from './components/RasterLegend.svelte';
	import RasterDataOverlay from './components/RasterDataOverlay.svelte';
	import type { VisualizationType } from './store';
	import type { RasterLayer } from '$lib/types';
	import { detectOverlappingFeatures } from './utils/overlapDetection';

	// Props that can be passed to the component
	export let initialCenter: [number, number] = [-25, 16]; // Default center coordinates [lng, lat]
	export let initialZoom: number = 1.2; // Default zoom level
	export let initialStyleId: string | null = null; // Optional style ID to use

	// Track the global opacity value for raster layers
	let globalOpacity = 80; // Default to 80%

	// Map instance and state
	let map: MaplibreMap | null = null;
	let isStyleLoaded = false;

	// Debug overlay state
	let showRasterDataOverlay = false; // Hide red pixels by default

	// Simple cache for SE rasters to compute CIs without reloading each click
	const seRasterCache = new Map<
		string,
		{ bounds: number[]; rasterData: Float32Array; width: number; height: number }
	>();

	// References to child components
	let rasterLayerManager: RasterLayerManager;

	// Popover state
	let showPopover = false;
	let popoverCoordinates: [number, number] | null = null;
	let popoverProperties: any = null;

	// Multi-point popover state
	let showMultiPointPopover = false;
	let multiPointFeatures: maplibregl.MapGeoJSONFeature[] = [];

	// Debug state
	let debugInfo = {
		lastClick: null as [number, number] | null,
		pixelCoords: null as { x: number; y: number } | null,
		rasterValue: null as number | null,
		error: null as string | null,
		rasterClicked: false,
		rasterName: null as string | null,
		// Hover state
		hoverCoords: null as [number, number] | null,
		hoverRasterValue: null as number | null,
		hoverRasterName: null as string | null,
		hoverInRaster: false,
		hoverMousePos: null as { x: number; y: number } | null
	};

	// Handle cursor change immediately (no debounce)
	function handleCursorChange(event: maplibregl.MapMouseEvent) {
		if (!map) return;

		const coords: [number, number] = [event.lngLat.lng, event.lngLat.lat];
		const currentRasterLayers = $rasterLayers;

		// 1) Check raster under cursor
		const visibleRasterLayer = findVisibleRasterLayerAtCoordinate(
			currentRasterLayers,
			coords[0],
			coords[1]
		);

		let pointer = false;
		if (visibleRasterLayer) {
			// Only show pointer if there is valid raster data at the coordinate
			const v = getRasterValueAtCoordinateFast(visibleRasterLayer, coords[0], coords[1]);
			pointer = v !== null && isFinite(v as number);
		} else {
			// 2) Check interactive vector layers (points, pies)
			const layersToCheck: string[] = [];
			if (map.getLayer('points-layer')) layersToCheck.push('points-layer');
			if (map.getLayer('pie-charts')) layersToCheck.push('pie-charts');

			if (layersToCheck.length) {
				const featuresAtPoint = map.queryRenderedFeatures([event.point.x, event.point.y], {
					layers: layersToCheck
				});
				pointer = featuresAtPoint.length > 0;
			}
		}

		// 3) Apply cursor style
		map.getCanvas().style.cursor = pointer ? 'pointer' : '';
	}

	// Handle map hover for raster feedback - fast version for tooltip
	function handleMapHoverFast(event: maplibregl.MapMouseEvent) {
		if (!map) return;

		const coords: [number, number] = [event.lngLat.lng, event.lngLat.lat];
		const currentRasterLayers = $rasterLayers;
		debugInfo.hoverMousePos = event.point;

		// Quick check if hovering over a raster
		const visibleRasterLayer = findVisibleRasterLayerAtCoordinate(
			currentRasterLayers,
			coords[0],
			coords[1]
		);

		if (visibleRasterLayer) {
			// Get the raster value using fast version (no neighbor analysis)
			const value = getRasterValueAtCoordinateFast(visibleRasterLayer, coords[0], coords[1]);

			// Update only essential hover info for tooltip
			debugInfo.hoverInRaster = true;
			debugInfo.hoverRasterValue = value;
		} else {
			debugInfo.hoverInRaster = false;
			debugInfo.hoverRasterValue = null;
		}
	}

	// Slower update for debug panel details
	function handleMapHoverDebug(event: maplibregl.MapMouseEvent) {
		if (!map) return;

		const coords: [number, number] = [event.lngLat.lng, event.lngLat.lat];
		const currentRasterLayers = $rasterLayers;
		debugInfo.hoverCoords = coords;

		const visibleRasterLayer = findVisibleRasterLayerAtCoordinate(
			currentRasterLayers,
			coords[0],
			coords[1]
		);

		if (visibleRasterLayer) {
			debugInfo.hoverRasterName = visibleRasterLayer.name;
		} else {
			debugInfo.hoverRasterName = null;
		}
	}

	// Very light debounce for tooltip (10ms)
	const debouncedHoverFast = debounce(handleMapHoverFast, 10);
	// Heavier debounce for debug panel (100ms)
	const debouncedHoverDebug = debounce(handleMapHoverDebug, 100);

	// Handle map ready event
	function handleMapReady(event: CustomEvent<{ map: MaplibreMap }>) {
		map = event.detail.map;
		isStyleLoaded = true;

		// Add hover event listeners
		map.on('mousemove', handleCursorChange); // Immediate cursor change
		map.on('mousemove', debouncedHoverFast); // Fast tooltip update (10ms)
		map.on('mousemove', debouncedHoverDebug); // Slower debug panel update (100ms)

		// Load data immediately when map is ready
		// DISABLED: Data is already loaded by preloadData in MapInitializer
		// clearFilterCache();
		// loadPointsData(pointDataUrl, true).then(() => {
		// 	// Data loaded successfully
		// 	console.log('Initial data loaded');
		// });

		if (map && !map.getSource('country-boundaries')) {
			map.addSource('country-boundaries', {
				type: 'geojson',
				data: '/ne_110m_admin_0_boundary_lines_land.geojson'
			});

			map.addLayer({
				id: 'country-boundaries-layer',
				type: 'line',
				source: 'country-boundaries',
				layout: {
					visibility: 'none'
				},
				paint: {
					'line-color': '#80808090',
					'line-width': 2
				}
			});

			// Layer ordering will be handled by reactive statements when data is ready
		}
	}

	// Handle style change event
	function handleStyleChange() {
		isStyleLoaded = true;
		if (map) {
			// Use idle event to ensure map is ready for URL serialization
			map.once('idle', () => {
				serializeFiltersToUrl(map, globalOpacity);
			});
		}
	}

	// Handle map click event
	async function handleMapClick(event: CustomEvent) {
		if (!map) return;

		showPopover = false;
		popoverCoordinates = null;
		popoverProperties = null;

		let features: maplibregl.MapGeoJSONFeature[] = [];
		if (map.getLayer('points-layer')) {
			// Define a small bounding box around the click point to make selection more robust
			const pointClickPixelBuffer = 5; // 5px buffer
			const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
				[
					event.detail.point.x - pointClickPixelBuffer,
					event.detail.point.y - pointClickPixelBuffer
				],
				[event.detail.point.x + pointClickPixelBuffer, event.detail.point.y + pointClickPixelBuffer]
			];
			features = map.queryRenderedFeatures(bbox, {
				layers: ['points-layer']
			});
		}

		if (features.length > 0) {
			// A point feature was clicked, let MapLayer handle it via pointclick event
			// This event is caught by handlePointClick in this component.
			// No need to do anything further here, as handlePointClick will set popover details.
			return;
		}

		const allFeatures = map.queryRenderedFeatures([event.detail.point.x, event.detail.point.y]);
		const isWater = allFeatures.some((feature) => {
			const layerId = feature.layer.id.toLowerCase();
			const sourceLayer = feature.sourceLayer?.toLowerCase() || '';
			return (
				layerId.includes('water') ||
				layerId.includes('ocean') ||
				layerId.includes('sea') ||
				layerId.includes('lake') ||
				layerId.includes('river') ||
				sourceLayer.includes('water') ||
				sourceLayer.includes('ocean') ||
				sourceLayer.includes('sea') ||
				sourceLayer.includes('lake') ||
				sourceLayer.includes('river')
			);
		});

		if (isWater) {
			isLoading.set(false);
			return;
		}

		const clickCoordinates: [number, number] = [event.detail.lngLat.lng, event.detail.lngLat.lat];
		const currentRasterLayers = $rasterLayers;

		// Check if any raster layer is visible
		const hasVisibleRasterLayer = Array.from(currentRasterLayers.values()).some(
			(layer) => layer.isVisible
		);

		if (!hasVisibleRasterLayer) {
			// No raster layers are visible, don't process click
			isLoading.set(false);
			return;
		}

		console.log(
			'Available raster layers:',
			Array.from(currentRasterLayers.entries()).map(([id, layer]) => ({
				id,
				name: layer.name,
				bounds: layer.bounds,
				visible: layer.isVisible
			}))
		);

		// Debug: Log exact click coordinates and update debug info
		console.log(`Map click at coordinates: lng=${clickCoordinates[0]}, lat=${clickCoordinates[1]}`);
		debugInfo.lastClick = clickCoordinates;
		debugInfo.pixelCoords = event.detail.point;
		debugInfo.error = null;
		debugInfo.rasterValue = null;
		debugInfo.rasterClicked = false;
		debugInfo.rasterName = null;

		// Find the visible raster layer at this coordinate
		console.log('Checking for raster at coordinates:', clickCoordinates);
		const visibleRasterLayer = findVisibleRasterLayerAtCoordinate(
			currentRasterLayers,
			clickCoordinates[0],
			clickCoordinates[1]
		);
		console.log('Found visible raster layer:', visibleRasterLayer);

		// If no raster layer found at this coordinate, don't show popover
		if (!visibleRasterLayer) {
			console.log('No raster layer at click location - not showing popover');
			debugInfo.error = 'Click outside raster bounds';
			debugInfo.rasterClicked = false;
			isLoading.set(false);
			return; // Don't show any popover for clicks outside raster
		}

		isLoading.set(true);
		try {
			// Update debug info to show raster was clicked
			debugInfo.rasterClicked = true;
			debugInfo.rasterName = visibleRasterLayer.name;

			// Debug: Log the raster layer details
			console.log('=== RASTER CLICK DEBUG ===');
			console.log('Click coordinates:', clickCoordinates);
			console.log('Raster layer:', {
				name: visibleRasterLayer.name,
				bounds: visibleRasterLayer.bounds,
				width: visibleRasterLayer.width,
				height: visibleRasterLayer.height,
				hasData: !!visibleRasterLayer.rasterData
			});

			// Get the actual raster value at this coordinate
			const rasterValue = getRasterValueAtCoordinate(
				visibleRasterLayer,
				clickCoordinates[0],
				clickCoordinates[1]
			);

			console.log('Raster value returned:', rasterValue);
			debugInfo.rasterValue = rasterValue;

			if (rasterValue === null) {
				// No data at this location (e.g., ocean)
				console.log('No raster value at this location - stopping');
				debugInfo.error = 'No raster value (likely ocean or no-data area)';
				debugInfo.rasterClicked = true; // We clicked on the raster layer bounds, but no data
				debugInfo.rasterName = visibleRasterLayer.name;
				isLoading.set(false);
				return;
			}

			// Infer pathogen and age group from the layer name
			let pathogen = '';
			let ageGroup = '';
			let syndrome = '';

			const layerName = visibleRasterLayer.name;
			const parts = layerName.split(' ');

			// Parse pathogen from layer name (e.g., "SHIG 0-11 Asym Pr")
			if (parts.length > 0) {
				switch (parts[0].toUpperCase()) {
					case 'SHIG':
						pathogen = 'Shigella';
						break;
					case 'ROTA':
						pathogen = 'Rotavirus';
						break;
					case 'NORO':
						pathogen = 'Norovirus';
						break;
					case 'CAMP':
						pathogen = 'Campylobacter';
						break;
					default:
						pathogen = parts[0];
				}
			}

			// Parse age group from layer name (e.g., "0-11" -> "0-11 months")
			if (parts.length > 1) {
				const ageRangePart = parts[1];
				if (ageRangePart === '0-11') {
					ageGroup = '0-11 months';
				} else if (ageRangePart === '12-23') {
					ageGroup = '12-23 months';
				} else if (ageRangePart === '24-59') {
					ageGroup = '24-59 months';
				} else {
					ageGroup = ageRangePart;
				}
			}

			// Parse syndrome type from layer name (e.g., "Asym", "Comm", "Medi")
			if (parts.length > 2) {
				const syndromePart = parts[2];
				switch (syndromePart) {
					case 'Asym':
						syndrome = 'Asymptomatic';
						break;
					case 'Comm':
						syndrome = 'Community';
						break;
					case 'Medi':
						syndrome = 'Medical';
						break;
					default:
						syndrome = 'Diarrhea';
				}
			}

			const formattedLng = clickCoordinates[0].toFixed(4);
			const formattedLat = clickCoordinates[1].toFixed(4);

			// Convert raster value to percentage (Pr rasters are in percent units)
			const prevalencePercent = rasterValue;

			// Try to compute 95% CI using matching SE raster if available
			let prevalenceLabel: string | null = null;
			try {
				// Derive SE URL by replacing _Pr.tif with _SE.tif
				const seUrl = visibleRasterLayer.sourceUrl.replace('_Pr.tif', '_SE.tif');
				if (seUrl !== visibleRasterLayer.sourceUrl) {
					// Get SE raster from cache or load on the fly (do not add to map)
					let cached = seRasterCache.get(seUrl);
					if (!cached) {
						const { bounds, rasterData, width, height } = await loadAndProcessGeoTIFF(seUrl, {
							debugMode: false
						});
						cached = { bounds, rasterData, width, height };
						seRasterCache.set(seUrl, cached);
					}
					// Sample SE value at click location using same mapping
					const tempLayer: any = {
						rasterData: cached.rasterData,
						width: cached.width,
						height: cached.height,
						bounds: cached.bounds
					};
					const seValue = getRasterValueAtCoordinate(
						tempLayer,
						clickCoordinates[0],
						clickCoordinates[1]
					);
					if (seValue !== null && isFinite(seValue)) {
						// SE assumed to be in percent units; 95% CI = prev ± 1.96*SE
						const halfWidth = 1.96 * seValue;
						const lower = Math.max(0, prevalencePercent - halfWidth);
						const upper = Math.min(100, prevalencePercent + halfWidth);
						// Display numbers without %; header shows unit as Prevalence (%)
						prevalenceLabel = `${prevalencePercent.toFixed(2)} (${lower.toFixed(2)}–${upper.toFixed(2)})`;
					}
				}
			} catch (ciErr) {
				console.warn('Could not compute CI from SE raster:', ciErr);
			}

			// Get metadata for this layer if available
			const metadata = visibleRasterLayer.layerMetadata;
			
			// Determine the heading and subheading based on metadata
			let heading = `${pathogen} Prevalence`;
			let subheading = 'Raster layer data';
			let studySource = 'Raster Layer';
			let studyLink = '#';
			let duration = '-';
			let design = 'Geospatial model';
			
			if (metadata) {
				// Use metadata to populate fields
				if (metadata.type === 'Pathogen') {
					heading = metadata.study || `${pathogen} Prevalence`;
					subheading = metadata.definition || 'Predicted prevalence';
				} else if (metadata.type === 'Risk Factor') {
					heading = metadata.study || `${metadata.variableName} Coverage`;
					subheading = metadata.definition || 'Predicted coverage';
					// For risk factors, show the currently selected pathogen from the
					// user's filter selection rather than the layer's variable name.
					pathogen = Array.from($selectedPathogens)[0] || 'None Selected';
					// Use the selected age group label, falling back to 'None Selected'.
					const selectedAgeVal = Array.from($selectedAgeGroups)[0];
					ageGroup = selectedAgeVal
						? ($ageGroupValToLab.get(selectedAgeVal) || selectedAgeVal)
						: 'None Selected';
					// Use the selected syndrome label, falling back to 'None Selected'.
					const selectedSynVal = Array.from($selectedSyndromes)[0];
					syndrome = selectedSynVal
						? ($syndromeValToLab.get(selectedSynVal) || selectedSynVal)
						: 'None Selected';
				}
				
				// Use metadata for source and link
				studySource = metadata.source || 'Raster Layer';
				studyLink = metadata.hyperlink || '#';
				duration = metadata.period || '-';
				
				// Update syndrome if available in metadata
				if (metadata.syndrome) {
					syndrome = metadata.syndrome;
				}
				
				// Update age group if available in metadata
				if (metadata.ageGroup) {
					ageGroup = metadata.ageGroup;
				}
			}

			// Create properties that match the expected structure for MapPopover
			popoverProperties = {
				// Required fields for popup display
				heading: heading,
				subheading: subheading,
				pathogen: pathogen,
				prevalenceValue: prevalencePercent / 100, // Decimal for color scale
				// Label for display (with CI if available); numbers without % (unit in label)
				prevalence: prevalenceLabel || `${prevalencePercent.toFixed(2)}`,
				ageGroup: ageGroup || 'All ages',
				ageRange: ageGroup || 'All ages',
				syndrome: syndrome || (metadata?.type === 'Risk Factor' ? 'N/A' : 'Diarrhea'),
				location: `${formattedLat}°, ${formattedLng}°`,

				// Additional fields with real metadata
				duration: duration,
				design: design,
				source: studySource,
				hyperlink: studyLink,
				footnote: metadata
					? `${metadata.indicator || 'Value'} from "${layerName}" at ${formattedLng}°, ${formattedLat}°.`
					: `Exact prevalence value from raster layer "${layerName}" at coordinates ${formattedLng}°, ${formattedLat}°.`,
				layerType: metadata?.type,
				rescaleMin: visibleRasterLayer.rescale?.[0] ?? 0,
				rescaleMax: visibleRasterLayer.rescale?.[1] ?? 11
			};

			popoverCoordinates = clickCoordinates;
			showPopover = true;
		} catch (error) {
			console.error('Error processing raster data for popover:', error);
		} finally {
			isLoading.set(false);
		}
	}

	function handlePointClick(event: CustomEvent) {
		console.log('Map.svelte: handlePointClick called with:', event.detail);
		showPopover = false;
		showMultiPointPopover = false;
		popoverCoordinates = null;
		popoverProperties = null;
		multiPointFeatures = [];

		const { coordinates, properties } = event.detail;

		// Check if there are multiple features at this location
		if (map) {
			const clickPoint = map.project(coordinates);
			const overlappingFeatures = detectOverlappingFeatures(map, coordinates, clickPoint);

			if (overlappingFeatures.length > 1) {
				// Multiple points at this location - show selection menu
				console.log(`Found ${overlappingFeatures.length} overlapping features`);
				popoverCoordinates = coordinates;
				multiPointFeatures = overlappingFeatures;
				showMultiPointPopover = true;
				return;
			}
		}

		// Single point - show regular popover
		console.log('Extracted properties:', properties);
		popoverCoordinates = coordinates;
		popoverProperties = properties;
		showPopover = true;
	}


	onMount(async () => {
		// Register this component's ensureLayerOrder function globally for access from stores
		(window as any).__mapComponent = {
			ensureLayerOrder
		};

		const urlParams = await preloadData();
		if (urlParams.center) initialCenter = urlParams.center;
		if (urlParams.zoom) initialZoom = urlParams.zoom;
		if (urlParams.styleId) initialStyleId = urlParams.styleId;
		if (urlParams.opacity !== undefined) {
			globalOpacity = urlParams.opacity;
			updateAllRasterLayersOpacity(urlParams.opacity / 100);
		}

		if (initialStyleId) {
			const styleFromId = getStyleById(initialStyleId);
			if (styleFromId) {
				selectedMapStyle.set(styleFromId);
			} else {
				console.warn(`Initial style ID "${initialStyleId}" not found. Using default.`);
			}
		}
	});

	onDestroy(() => {
		// Clean up global reference
		if ((window as any).__mapComponent) {
			delete (window as any).__mapComponent;
		}

		// Clean up event listeners
		if (map) {
			map.off('mousemove', handleCursorChange);
			map.off('mousemove', debouncedHoverFast);
			map.off('mousemove', debouncedHoverDebug);
		}
	});

	$: if (map && isStyleLoaded) {
		// Wait for map to be idle before serializing URL
		if (map.loaded()) {
			map.once('idle', () => {
				if (map) {
					serializeFiltersToUrl(map, globalOpacity);
				}
			});
		}
	}

	// Function to ensure layer order after visualization changes
	export function ensureLayerOrder() {
		if (
			map &&
			isStyleLoaded &&
			rasterLayerManager &&
			typeof rasterLayerManager.ensureCorrectLayerOrder === 'function'
		) {
			console.log('Map.svelte: Ensuring layer order after visualization change');
			// Use idle event to ensure map has finished rendering before adjusting layers
			map.once('idle', () => {
				rasterLayerManager.ensureCorrectLayerOrder();
			});
		}
	}

	// Function to handle raster visibility changes
	export function handleRasterVisibilityChange() {
		if (
			map &&
			isStyleLoaded &&
			rasterLayerManager &&
			typeof rasterLayerManager.ensureCorrectLayerOrder === 'function'
		) {
			console.log('Map.svelte: Raster visibility changed, ensuring layer order');
			// Use idle event to ensure map has finished rendering
			map.once('idle', () => {
				rasterLayerManager.ensureCorrectLayerOrder();
			});
		}
	}
</script>

<div class="relative h-full">
	<MapCore
		{initialCenter}
		{initialZoom}
		{initialStyleId}
		bind:map
		on:ready={handleMapReady}
		on:styleChange={handleStyleChange}
		on:click={handleMapClick}
	/>

	{#if map}
		<MapControls {map} position="top-right" />
	{/if}

	{#if map && isStyleLoaded}
		<RasterLayerManager {map} {isStyleLoaded} bind:globalOpacity bind:this={rasterLayerManager} />
	{/if}

	{#if map && isStyleLoaded}
		<MapLayer {map} on:pointclick={handlePointClick} />
	{/if}

	<div class="absolute left-6 top-16 z-10 hidden sm:block">
		<LayerManager />
	</div>


	{#if map && popoverCoordinates}
		{#if showMultiPointPopover && multiPointFeatures.length > 0}
			<MultiPointPopover
				{map}
				coordinates={popoverCoordinates}
				features={multiPointFeatures}
				visible={showMultiPointPopover}
				on:close={() => {
					showMultiPointPopover = false;
					multiPointFeatures = [];
				}}
			/>
		{:else if showPopover && popoverProperties}
			<MapPopover
				{map}
				coordinates={popoverCoordinates}
				properties={popoverProperties}
				visible={showPopover}
				on:close={() => {
					showPopover = false;
				}}
			/>
		{/if}
	{/if}

	{#if map && isStyleLoaded && $filteredPointsData.features.length > 0}
		<MapLegend visible={true} />
	{/if}

	<!-- RasterLegend moved into MapPopover — shown at bottom of raster click popup -->

	<!-- Raster Data Overlay - shows red pixels for all raster data -->
	{#if map && isStyleLoaded}
		<RasterDataOverlay {map} visible={showRasterDataOverlay} />
	{/if}

	<!-- Toggle moved to Settings modal -->

	<!-- Debug Panel -->
	<!-- 	<div
		class="fixed right-4 top-40 z-[100] max-w-sm rounded-lg bg-white/95 p-3 font-mono text-xs shadow-lg"
	>
		<div class="mb-2 text-sm font-bold">Debug Info</div>

		{#if debugInfo.hoverCoords}
			<div class="mb-2 border-b border-gray-200 pb-2">
				<div class="font-bold text-purple-600">Hover Info:</div>
				<div>
					Coords: [{debugInfo.hoverCoords[0].toFixed(4)}, {debugInfo.hoverCoords[1].toFixed(4)}]
				</div>
				{#if debugInfo.hoverInRaster}
					<div class="text-purple-600">Raster: {debugInfo.hoverRasterName}</div>
					{#if debugInfo.hoverRasterValue !== null}
						<div class="font-bold text-purple-600">Value: {debugInfo.hoverRasterValue}%</div>
					{:else}
						<div class="text-orange-500">No data at hover</div>
					{/if}
				{:else}
					<div class="text-gray-500">Not over raster</div>
				{/if}
			</div>
		{/if}

		{#if debugInfo.lastClick}
			<div class="font-bold text-blue-600">Click Info:</div>
			<div>Click: [{debugInfo.lastClick[0].toFixed(4)}, {debugInfo.lastClick[1].toFixed(4)}]</div>
		{/if}
		{#if debugInfo.pixelCoords}
			<div>Pixel: ({debugInfo.pixelCoords.x}, {debugInfo.pixelCoords.y})</div>
		{/if}
		<div class="mt-1 border-t border-gray-200 pt-1">
			{#if debugInfo.rasterClicked}
				<div class="font-bold text-blue-600">✓ Raster Layer Found</div>
				{#if debugInfo.rasterName}
					<div class="text-xs text-blue-600">Layer: {debugInfo.rasterName}</div>
				{/if}
				{#if debugInfo.rasterValue !== null}
					<div class="mt-1 font-bold text-green-600">✓ Data Value: {debugInfo.rasterValue}%</div>
				{:else if debugInfo.error && debugInfo.error.includes('no-data')}
					<div class="mt-1 text-orange-600">⚠ No Data (Ocean/Outside Coverage)</div>
				{/if}
			{:else if debugInfo.lastClick}
				<div class="text-gray-500">✗ No Raster Layer at Click</div>
			{/if}
		</div>
		{#if debugInfo.error && !debugInfo.error.includes('no-data')}
			<div class="mt-1 text-xs text-red-600">{debugInfo.error}</div>
		{/if}
		{#if !debugInfo.lastClick && !debugInfo.hoverCoords}
			<div class="text-gray-500">Move mouse over map to see hover info</div>
		{/if}
	</div> -->

	<!-- Hover Tooltip - follows mouse cursor -->
	{#if debugInfo.hoverInRaster && debugInfo.hoverRasterValue !== null && debugInfo.hoverMousePos && !showPopover && !showMultiPointPopover}
		<!-- Red pixel indicator for testing - centered on mouse position -->
		<div
			class="pointer-events-none fixed z-[999] h-2 w-2 bg-red-500"
			style="left: {debugInfo.hoverMousePos.x}px; top: {debugInfo.hoverMousePos
				.y}px; transform: translate(-50%, -50%); border: 1px solid white;"
		></div>
		<!-- Tooltip positioned exactly at cursor -->
		<div
			class="pointer-events-none fixed z-[1000] whitespace-nowrap rounded bg-black/90 px-2 py-1 text-xs text-white"
			style="left: {debugInfo.hoverMousePos.x}px; top: {debugInfo.hoverMousePos
				.y}px; transform: translate(-50%, -50%);"
		>
			Prevalence: {debugInfo.hoverRasterValue}
		</div>
	{/if}

	{#if $isLoading}
		<div class="alert fixed bottom-6 left-4 z-[1000] w-auto shadow-lg">
			<span class="text-sm font-medium">{$loadingMessage || 'Loading...'}</span>
		</div>
	{/if}

	{#if $dataError}
		<div class="error-overlay">
			<div class="error-container">
				<div class="error-icon">⚠️</div>
				<div class="error-message">Error: {$dataError}</div>
				<button
					class="retry-button"
					on:click={() => loadPointsData('/data/processed_geodata.geojson', true)}
				>
					Retry
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Error display */
	.error-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-color: rgba(255, 255, 255, 0.85);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 1001; /* Ensure it's above map */
	}

	.error-container {
		background-color: white;
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		padding: 20px;
		max-width: 400px;
		text-align: center;
	}

	.error-icon {
		font-size: 36px;
		margin-bottom: 10px;
	}

	.retry-button {
		/* Basic button styling */
		padding: 8px 16px;
		margin-top: 15px;
		border: none;
		border-radius: 4px;
		background-color: hsl(var(--p)); /* Use primary color */
		color: hsl(var(--pc)); /* Use primary content color */
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.retry-button:hover {
		background-color: hsl(var(--p) / 0.8); /* Slightly darker on hover */
	}
</style>
