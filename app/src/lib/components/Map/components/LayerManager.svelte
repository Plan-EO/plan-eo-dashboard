<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import {
		pathogens,
		ageGroups,
		syndromes,
		selectedPathogens,
		selectedAgeGroups,
		selectedSyndromes,
		ageGroupValToLab,
		syndromeValToLab,
		ageGroupCounts,
		syndromeCounts,
		pathogenCounts,
		visualizationType,
		autoVisibleRasterLayers,
		rasterVisualizationEnabled,
		rasterLayers,
		updateRasterLayerIsActive,
		updateRasterLayerVisibility,
		clearFilterCache,
		handleFilterChange,
		mapInstance,
		applyDataPointsVisibility,
		dataPointsVisible as dataPointsVisibleStore,
		pointsAddedToMap,
		initFilterRasterConnection,
		loadRasterLayersFromConfig,
		loadFilterRasterMappings
	} from '../store';
	import { visualizationOptions } from '../store/visualizationOptions';
	import { formatDropdownText, parseIndentationPrefix } from '../utils/textFormatter';
	import type { VisualizationType } from '../store';
	import type { RasterLayer } from '$lib/types';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';

	// Panel state
	let collapsed = false;
	let pathogensExpanded = false;
	let riskFactorsExpanded = false;
	let rfOpenSubcategory = ''; // which sub-category is vertically expanded
	let activeLayersExpanded = true;
	let expandedLayerDetails = new Set<string>();
	let layerDateWindows: Record<string, { from: string; to: string }> = {};

	// Risk Factors sub-category definitions — built dynamically from loaded raster config
	function buildRFSubcategories(layers: Map<string, RasterLayer>): Array<{id: string; label: string; layers: {storeName: string; display: string}[]}> {
		const ordered: string[] = [];
		const grouped = new Map<string, {id: string; label: string; layers: {storeName: string; display: string}[]}>();
		for (const layer of layers.values()) {
			const ph = layer.layerMetadata?.panelHeading;
			const ps = layer.layerMetadata?.panelSubheading;
			if (!ph || !ps) continue;
			if (!grouped.has(ph)) {
				const id = ph.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
				grouped.set(ph, { id, label: ph, layers: [] });
				ordered.push(ph);
			}
			grouped.get(ph)!.layers.push({ storeName: layer.name, display: ps });
		}
		return ordered.map((ph) => grouped.get(ph)!);
	}
	$: rfSubcategories = buildRFSubcategories($rasterLayers);

	// Find the display label + subcategory name for a raster layer by its config `name`
	function findLayerDef(layerName: string): { display: string; subtitle: string } | undefined {
		for (const sub of rfSubcategories) {
			const found = sub.layers.find((l) => l.storeName === layerName);
			if (found) return { display: found.display, subtitle: sub.label };
		}
		return undefined;
	}

	// Active pathogen drives whether the config panel is shown
	let activePathogen = '';

	// Config panel state
	let lmAgeGroup = '';
	let lmSyndrome = '';
	let lmVisualizationType: VisualizationType = 'pie-charts';
	let dataPointsToggled = false;
	let rasterToggled = false;

	// Load raster layer config and filter→raster mappings at startup
	// (rasterLayers/filterToRasterMappings stores start empty until this resolves)
	onMount(() => {
		loadRasterLayersFromConfig();
		loadFilterRasterMappings();
	});

	// Take ownership of display state on startup
	let _mapInitialized = false;
	let _filterRasterUnsubscribe: (() => void) | null = null;

	$: if ($mapInstance && !_mapInitialized) {
		_mapInitialized = true;

		// Disable raster auto-show immediately so URL-restored filters don't trigger rasters
		rasterVisualizationEnabled.set(false);

		// Clear any filter state restored from the URL
		selectedPathogens.set(new Set());
		selectedAgeGroups.set(new Set());
		selectedSyndromes.set(new Set());
		clearFilterCache();
		handleFilterChange();

		// Strip filter params from the URL through SvelteKit's router (keep style/center/zoom)
		if (typeof window !== 'undefined') {
			const url = new URL(window.location.href);
			url.searchParams.delete('p');
			url.searchParams.delete('a');
			url.searchParams.delete('s');
			goto(url.toString(), { replaceState: true, keepFocus: true, noScroll: true });
		}

		// Wire up the filter→raster connection so Layer Manager selections auto-show rasters
		_filterRasterUnsubscribe = initFilterRasterConnection();
	}

	// Hide data points as soon as they are added to the map (gate on mapInstance so it's ready)
	let _pointsHidden = false;
	$: if ($pointsAddedToMap && $mapInstance && !_pointsHidden) {
		_pointsHidden = true;
		dataPointsVisibleStore.set(false);
		applyDataPointsVisibility($mapInstance, false);
	}

	// Apply default selection once data points are ready
	let _defaultsApplied = false;
	$: if (_pointsHidden && !_defaultsApplied) {
		_defaultsApplied = true;
		applyDefaults();
	}

	async function applyDefaults() {
		pathogensExpanded = true;
		await activatePathogen('__Campylobacter__');
		await selectAgeGroup('01_Age_PSAC');
		await selectSyndrome('02_Synd_Diar');
		// Wait for any subscriber-triggered handleFilterChange calls (pie chart symbol
		// generation) to finish before making the layer visible.
		await new Promise(r => setTimeout(r, 400));
		toggleDataPoints();
	}

	onDestroy(() => {
		_filterRasterUnsubscribe?.();
	});

	$: hasRaster = $autoVisibleRasterLayers.size > 0;

	type ActiveLayer = {
		id: string;
		type: 'pathogen' | 'raster';
		displayName: string;
		subtitle: string;
		vizType?: string;
		onRemove: () => void;
	};

	$: activeLayers = [
		...(layerAdded && dataPointsToggled && activePathogen
			? ([{
					id: 'pathogen-layer',
					type: 'pathogen' as const,
					displayName: formatDropdownText(activePathogen),
					subtitle: [
						lmAgeGroup && parseIndentationPrefix($ageGroupValToLab.get(lmAgeGroup) || lmAgeGroup).text,
						lmSyndrome && parseIndentationPrefix($syndromeValToLab.get(lmSyndrome) || lmSyndrome).text
					]
						.filter(Boolean)
						.join(' · ') || 'All ages / All syndromes',
					vizType: lmVisualizationType === 'pie-charts' ? 'Pie Charts' : 'Dots',
					onRemove: removeLayer
				}] satisfies ActiveLayer[])
			: []),
		...Array.from($rasterLayers.entries())
			.filter(([_, l]) => l.isActive)
			.map(([layerId, layer]) => {
				const layerDef = findLayerDef(layer.name);
				return {
					id: layerId,
					type: 'raster' as const,
					displayName: layerDef?.display || layer.name,
					subtitle: layerDef?.subtitle || 'Raster Layer',
					onRemove: () => removeRFLayer(layer.name)
				} satisfies ActiveLayer;
			})
	] as ActiveLayer[];

	$: sortedPathogens = Array.from($pathogens || []).sort();

	$: availableAgeGroups = activePathogen
		? Array.from($ageGroups || []).filter((v) => ($ageGroupCounts.get(v) || 0) > 0)
		: [];

	$: availableSyndromes = lmAgeGroup
		? Array.from($syndromes || []).filter((v) => ($syndromeCounts.get(v) || 0) > 0)
		: [];

	// Whether the user has committed the current selection to the map
	let layerAdded = false;

	// When raster disappears while raster toggle is on, turn it off
	$: if (!hasRaster && rasterToggled) {
		rasterToggled = false;
		if (layerAdded) {
			hideRasterLayers();
		}
	}

	function hideAll() {
		// Hide data points
		dataPointsVisibleStore.set(false);
		applyDataPointsVisibility($mapInstance, false);
		// Directly hide every currently-visible raster layer
		rasterVisualizationEnabled.set(false);
		$autoVisibleRasterLayers.forEach((layerId) => {
			updateRasterLayerVisibility(layerId, false);
			updateRasterLayerIsActive(layerId, false);
		});
	}

	function togglePathogens() {
		pathogensExpanded = !pathogensExpanded;
		if (pathogensExpanded) {
			riskFactorsExpanded = false;
			rfOpenSubcategory = '';
		}
		if (!pathogensExpanded && activePathogen) {
			clearActivePathogen();
		}
	}

	function toggleRiskFactors() {
		riskFactorsExpanded = !riskFactorsExpanded;
		if (riskFactorsExpanded) {
			pathogensExpanded = false;
			if (activePathogen) clearActivePathogen();
		} else {
			rfOpenSubcategory = '';
		}
	}

	function toggleRFSubcategory(id: string) {
		rfOpenSubcategory = rfOpenSubcategory === id ? '' : id;
	}

	function isRFLayerAdded(storeName: string): boolean {
		const layer = Array.from($rasterLayers.values()).find((l) => l.name === storeName);
		return layer?.isVisible ?? false;
	}

	function addRFLayer(storeName: string) {
		const entry = Array.from($rasterLayers.entries()).find(([_, l]) => l.name === storeName);
		if (!entry) return;
		const [layerId] = entry;
		updateRasterLayerIsActive(layerId, true);
		updateRasterLayerVisibility(layerId, true);
	}

	function removeRFLayer(storeName: string) {
		const entry = Array.from($rasterLayers.entries()).find(([_, l]) => l.name === storeName);
		if (!entry) return;
		const [layerId] = entry;
		updateRasterLayerVisibility(layerId, false);
		updateRasterLayerIsActive(layerId, false);
	}

	function clearActivePathogen() {
		hideAll();
		layerAdded = false;
		activePathogen = '';
		lmAgeGroup = '';
		lmSyndrome = '';
		dataPointsToggled = false;
		rasterToggled = false;
		selectedPathogens.set(new Set());
		selectedAgeGroups.set(new Set());
		selectedSyndromes.set(new Set());
		clearFilterCache();
		handleFilterChange();
	}

	async function activatePathogen(pathogen: string) {
		if (activePathogen === pathogen) {
			clearActivePathogen();
			return;
		}
		hideAll();
		layerAdded = false;
		activePathogen = pathogen;
		lmAgeGroup = '';
		lmSyndrome = '';
		dataPointsToggled = false;
		rasterToggled = false;
		lmVisualizationType = 'pie-charts';
		visualizationType.set('pie-charts');
		selectedPathogens.set(new Set([pathogen]));
		selectedAgeGroups.set(new Set());
		selectedSyndromes.set(new Set());
		clearFilterCache();
		await handleFilterChange();
	}

	async function selectAgeGroup(val: string) {
		// Changing age group after adding → require explicit "+" click again
		if (layerAdded) { hideAll(); layerAdded = false; dataPointsToggled = false; rasterToggled = false; }
		lmAgeGroup = val;
		lmSyndrome = '';
		selectedAgeGroups.set(val ? new Set([val]) : new Set());
		selectedSyndromes.set(new Set());
		clearFilterCache();
		await handleFilterChange();
	}

	async function selectSyndrome(val: string) {
		// Changing syndrome after adding → require explicit "+" click again
		if (layerAdded) { hideAll(); layerAdded = false; dataPointsToggled = false; rasterToggled = false; }
		lmSyndrome = val;
		selectedSyndromes.set(val ? new Set([val]) : new Set());
		clearFilterCache();
		await handleFilterChange();
	}

	function selectVisualizationType(val: VisualizationType) {
		lmVisualizationType = val;
		visualizationType.set(val);
		// Viz type is a style change — applies immediately if layer is already added
	}

	function showRasterLayers() {
		rasterVisualizationEnabled.set(true);
		$autoVisibleRasterLayers.forEach((layerId) => {
			updateRasterLayerIsActive(layerId, true);
			updateRasterLayerVisibility(layerId, true);
		});
	}

	function hideRasterLayers() {
		rasterVisualizationEnabled.set(false);
		$autoVisibleRasterLayers.forEach((layerId) => {
			updateRasterLayerVisibility(layerId, false);
		});
	}

	function toggleDataPoints() {
		const isActive = layerAdded && dataPointsToggled;
		if (isActive) {
			dataPointsToggled = false;
			dataPointsVisibleStore.set(false);
			applyDataPointsVisibility($mapInstance, false);
			if (!rasterToggled) layerAdded = false;
		} else {
			dataPointsToggled = true;
			layerAdded = true;
			dataPointsVisibleStore.set(true);
			applyDataPointsVisibility($mapInstance, true);
		}
	}

	function toggleRaster() {
		if (!hasRaster) return;
		const isActive = layerAdded && rasterToggled;
		if (isActive) {
			rasterToggled = false;
			hideRasterLayers();
			if (!dataPointsToggled) layerAdded = false;
		} else {
			rasterToggled = true;
			layerAdded = true;
			dataPointsVisibleStore.set(dataPointsToggled);
			applyDataPointsVisibility($mapInstance, dataPointsToggled);
			showRasterLayers();
		}
	}

	function removeLayer() {
		layerAdded = false;
		dataPointsToggled = false;
		rasterToggled = false;
		hideRasterLayers();
		dataPointsVisibleStore.set(false);
		applyDataPointsVisibility($mapInstance, false);
		expandedLayerDetails.delete('pathogen-layer');
		expandedLayerDetails = expandedLayerDetails;
	}

	function toggleActiveLayers() {
		activeLayersExpanded = !activeLayersExpanded;
	}

	function toggleLayerDetail(id: string) {
		if (expandedLayerDetails.has(id)) {
			expandedLayerDetails.delete(id);
		} else {
			expandedLayerDetails.add(id);
			initLayerDateWindow(id);
		}
		expandedLayerDetails = expandedLayerDetails;
	}

	function initLayerDateWindow(id: string) {
		if (!layerDateWindows[id]) {
			const today = new Date();
			const yearAgo = new Date(today);
			yearAgo.setFullYear(today.getFullYear() - 1);
			layerDateWindows[id] = {
				from: yearAgo.toISOString().split('T')[0],
				to: today.toISOString().split('T')[0]
			};
			layerDateWindows = layerDateWindows;
		}
	}

	// Split "Prefix E. coli (Abbrev)" onto two lines for readability
	function formatPathogenDisplay(pathogen: string): string {
		const match = pathogen.match(/^(.*?)\s*((?:__)?E\.\s*coli.*)$/s);
		if (match && match[1].trim()) {
			return `${formatDropdownText(match[1].trim())}<br>${formatDropdownText(match[2].trim())}`;
		}
		return formatDropdownText(pathogen);
	}

	const panelBase =
		'flex-shrink-0 rounded-lg border border-white/30 bg-gradient-to-br from-white/85 to-white/70 backdrop-blur-md shadow-lg overflow-hidden';
</script>

<!-- Panels flow left-to-right: leftmost is main, each new panel appears to its right -->
<div class="flex flex-row items-start gap-2">

	<!-- ── Left column: Main Panel stacked above Active Layers Panel ── -->
	<div class="flex flex-col gap-2">

	<!-- ── Main Panel (leftmost, always visible) ── -->
	<div class="{panelBase} w-48">
		<!-- Header -->
		<div class="border-b border-white/30 bg-white/40 px-2 py-1.5">
			<div class="flex items-center justify-between">
				<h2 class="text-base-content text-sm font-semibold">Layer Manager</h2>
				<button
					class="btn btn-ghost btn-square btn-xs"
					title={collapsed ? 'Expand' : 'Collapse'}
					onclick={() => (collapsed = !collapsed)}
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						{#if collapsed}
							<polyline points="9 18 15 12 9 6"></polyline>
						{:else}
							<polyline points="15 18 9 12 15 6"></polyline>
						{/if}
					</svg>
				</button>
			</div>
		</div>

		{#if !collapsed}
			<div class="p-2 space-y-1">
				<!-- Pathogens category -->
				<button
					class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors {pathogensExpanded
						? 'bg-warning/10 text-warning font-medium'
						: 'hover:bg-white/60 text-base-content'}"
					onclick={togglePathogens}
				>
					<span class="flex items-center gap-2">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<circle cx="12" cy="12" r="3" stroke-width="2" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
						</svg>
						Pathogens
					</span>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
					</svg>
				</button>

				<!-- Risk Factors / Interventions -->
				<button
					class="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors {riskFactorsExpanded
						? 'bg-warning/10 text-warning font-medium'
						: 'hover:bg-white/60 text-base-content'}"
					onclick={toggleRiskFactors}
				>
					<span class="flex items-center gap-2">
						<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
						</svg>
						Risk Factors
					</span>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
					</svg>
				</button>

			</div>
		{/if}
	</div>

	<!-- ── Active Layers Panel (below Main panel) ── -->
	<div class="{panelBase} w-48">
		<!-- Header -->
		<div class="border-b border-white/30 bg-white/40 px-2 py-1.5">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<h2 class="text-base-content text-xs font-semibold">Active Layers</h2>
					{#if activeLayers.length > 0}
						<span class="badge badge-primary badge-xs">{activeLayers.length}</span>
					{/if}
				</div>
				<button
					class="btn btn-ghost btn-square btn-xs"
					title={activeLayersExpanded ? 'Collapse' : 'Expand'}
					onclick={toggleActiveLayers}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5 flex-shrink-0 transition-transform {activeLayersExpanded ? 'rotate-180' : ''}"
						fill="none" viewBox="0 0 24 24" stroke="currentColor"
					>
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
			</div>
		</div>

		{#if activeLayersExpanded}
			<div transition:slide={{ duration: 180 }} class="p-2 space-y-1">
				{#if activeLayers.length === 0}
					<p class="px-3 py-3 text-center text-xs text-base-content/40 italic">No active layers yet</p>
				{:else}
					{#each activeLayers as layer (layer.id)}
						<div class="rounded-md border border-white/50 bg-white/30 overflow-hidden">
							<!-- Layer row header -->
							<div class="flex items-center gap-1 px-2 py-1.5">
								<button
									class="flex flex-1 items-center gap-1.5 text-left min-w-0"
									onclick={() => toggleLayerDetail(layer.id)}
									title="Show layer details"
								>
									<span class="text-xs font-medium leading-tight truncate flex-1">{@html layer.displayName}</span>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-3 w-3 flex-shrink-0 text-base-content/40 transition-transform {expandedLayerDetails.has(layer.id) ? 'rotate-180' : ''}"
										fill="none" viewBox="0 0 24 24" stroke="currentColor"
									>
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
									</svg>
								</button>
								<button
									class="btn btn-ghost btn-square flex-shrink-0 text-error/70 hover:text-error hover:bg-error/10"
									style="min-height:0;height:1.4rem;width:1.4rem;padding:0;"
									onclick={layer.onRemove}
									title="Remove layer"
									aria-label="Remove layer"
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>

							<!-- Expanded layer details -->
							{#if expandedLayerDetails.has(layer.id)}
								<div transition:slide={{ duration: 150 }} class="border-t border-white/40 bg-white/20 px-2.5 py-2 space-y-2.5">
									<!-- Type + subtitle -->
									<div class="flex items-center gap-1.5 flex-wrap">
										<span class="badge badge-xs {layer.type === 'pathogen' ? 'badge-secondary' : 'badge-warning'} badge-outline">
											{layer.type === 'pathogen' ? 'Point Data' : 'Raster'}
										</span>
										{#if layer.type === 'pathogen' && layer.vizType}
											<span class="badge badge-xs badge-ghost">{layer.vizType}</span>
										{/if}
									</div>
									<p class="text-[10px] text-base-content/60 leading-snug">{layer.subtitle}</p>

									<!-- Date Window (demo) -->
									<div>
										<div class="flex items-center gap-1 mb-1">
											<p class="text-[10px] font-semibold text-base-content/70 uppercase tracking-wide">Date Window</p>
											<span class="badge badge-xs badge-ghost text-[9px]">Demo</span>
										</div>
										<div class="flex flex-col gap-1">
											<div class="flex items-center gap-1">
												<span class="text-[10px] text-base-content/50 w-5">From</span>
												<input
													type="date"
													class="input input-xs input-bordered flex-1 bg-white/80 text-[10px] h-6 min-h-0"
													value={layerDateWindows[layer.id]?.from ?? ''}
													onchange={(e) => {
														layerDateWindows[layer.id] = {
															...layerDateWindows[layer.id],
															from: e.currentTarget.value
														};
														layerDateWindows = layerDateWindows;
													}}
												/>
											</div>
											<div class="flex items-center gap-1">
												<span class="text-[10px] text-base-content/50 w-5">To</span>
												<input
													type="date"
													class="input input-xs input-bordered flex-1 bg-white/80 text-[10px] h-6 min-h-0"
													value={layerDateWindows[layer.id]?.to ?? ''}
													onchange={(e) => {
														layerDateWindows[layer.id] = {
															...layerDateWindows[layer.id],
															to: e.currentTarget.value
														};
														layerDateWindows = layerDateWindows;
													}}
												/>
											</div>
										</div>
										<p class="text-[9px] text-base-content/30 italic mt-1">Filtering by date range coming soon</p>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>

	</div><!-- end left column -->

	<!-- ── Pathogens Panel (appears to right of Main when Pathogens is expanded) ── -->
	{#if pathogensExpanded && !collapsed}
		<div
			class="{panelBase} w-48"
			transition:fly={{ x: -40, duration: 220, opacity: 0 }}
		>
			<!-- Header -->
			<div class="border-b border-white/30 bg-white/40 px-2 py-1.5">
				<div class="flex items-center gap-2">
					<button
						class="text-base-content/50 hover:text-base-content transition-colors"
						onclick={togglePathogens}
						title="Collapse Pathogens"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
						</svg>
					</button>
					<h3 class="text-base-content text-xs font-semibold">Pathogens</h3>
				</div>
			</div>

			<!-- Pathogen list -->
			<div class="max-h-[calc(100vh-280px)] overflow-y-auto py-1">
				{#each sortedPathogens as pathogen}
					{@const isActive = activePathogen === pathogen}
					{@const count = $pathogenCounts.get(pathogen) || 0}
					<button
						class="flex w-full items-center justify-between px-2 py-1 text-left text-xs transition-colors {isActive
							? 'bg-warning/10 text-warning font-medium'
							: 'hover:bg-white/60 text-base-content'}"
						onclick={() => activatePathogen(pathogen)}
					>
						<span class="flex items-start gap-2">
							<span
								class="mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full border-2 {isActive
									? 'border-warning bg-warning'
									: 'border-base-300 bg-transparent'}"
							></span>
							<span class="leading-snug">{@html formatPathogenDisplay(pathogen)}</span>
						</span>
						<span class="flex items-center gap-1">
							<span class="text-base-content/40 text-xs">{count}</span>
							{#if isActive}
								<svg xmlns="http://www.w3.org/2000/svg" class="text-warning h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
								</svg>
							{/if}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ── Risk Factors Panel (appears to right of Main when Risk Factors is expanded) ── -->
	{#if riskFactorsExpanded && !collapsed}
		<div
			class="{panelBase} w-48"
			transition:fly={{ x: -40, duration: 220, opacity: 0 }}
		>
			<!-- Header -->
			<div class="border-b border-white/30 bg-white/40 px-2 py-1.5">
				<div class="flex items-center gap-2">
					<button
						class="text-base-content/50 hover:text-base-content transition-colors"
						onclick={toggleRiskFactors}
						title="Collapse Risk Factors"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
						</svg>
					</button>
					<h3 class="text-xs font-semibold truncate">Risk Factors</h3>
				</div>
			</div>

			<!-- Sub-categories (vertical accordion) -->
			<div class="max-h-[calc(100vh-280px)] overflow-y-auto pb-4">
				{#each rfSubcategories as sub}
					{@const isOpen = rfOpenSubcategory === sub.id}

					<!-- Sub-category header -->
					<button
						class="flex w-full items-center justify-between pl-4 pr-2 py-1.5 text-left text-xs font-medium transition-colors {isOpen
							? 'bg-warning/10 text-warning'
							: 'hover:bg-white/60 text-base-content'}"
						onclick={() => toggleRFSubcategory(sub.id)}
					>
						<span class="flex items-center gap-2">
							<span class="inline-block h-2 w-2 flex-shrink-0 rounded-full border-2 {isOpen ? 'border-warning bg-warning' : 'border-base-300 bg-transparent'}"></span>
							{sub.label}
						</span>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-3.5 w-3.5 flex-shrink-0 transition-transform {isOpen ? 'rotate-180' : ''}"
							fill="none" viewBox="0 0 24 24" stroke="currentColor"
						>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
						</svg>
					</button>

					<!-- Layer list (expands downward) -->
					{#if isOpen && sub.layers.length > 0}
						<div class="border-warning/20 bg-warning/5 divide-white/40 divide-y border-t">
							{#each sub.layers as layer}
								{@const added = isRFLayerAdded(layer.storeName)}
								<div class="flex items-center justify-between gap-1.5 py-1 pl-6 pr-2">
									<div class="flex flex-col">
										<span class="text-base-content text-xs font-medium">{layer.display}</span>
										<span class="text-base-content/50 text-xs italic">Raster Layer Description Here</span>
									</div>
									<button
										class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors {added ? 'bg-error/80 hover:bg-error' : 'bg-secondary/80 hover:bg-secondary'}"
										onclick={() => added ? removeRFLayer(layer.storeName) : addRFLayer(layer.storeName)}
										title={added ? 'Remove layer' : 'Add layer'}
									>
										<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
											{#if added}
												<path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" />
											{:else}
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
											{/if}
										</svg>
									</button>
								</div>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	<!-- ── Config Panel (appears to right of Pathogens when a pathogen is active) ── -->
	{#if activePathogen && !collapsed}
		<div
			class="{panelBase} w-48"
			transition:fly={{ x: -40, duration: 220, opacity: 0 }}
		>
			<!-- Header -->
			<div class="border-b border-white/30 bg-white/40 px-2 py-1.5">
				<div class="flex items-center gap-2">
					<button
						class="text-base-content/50 hover:text-base-content transition-colors"
						onclick={() => clearActivePathogen()}
						title="Back to pathogen list"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
						</svg>
					</button>
					<h3 class="text-xs font-semibold leading-snug">
						{@html formatPathogenDisplay(activePathogen)}
					</h3>
				</div>
			</div>

			<!-- Controls group -->
			<div class="max-h-[calc(100vh-280px)] space-y-2 overflow-y-auto p-2.5">

				<!-- Age Group -->
				<div>
					<label class="text-base-content/60 mb-1 block text-xs font-medium uppercase tracking-wide" for="lm-agegroup">
						Age Group
					</label>
					<select
						id="lm-agegroup"
						class="select select-sm select-bordered w-full bg-white/80 text-xs focus:border-primary"
						value={lmAgeGroup}
						onchange={(e) => selectAgeGroup(e.currentTarget.value)}
					>
						<option value="">Select age group</option>
						{#each availableAgeGroups as val}
							{@const { isIndented, text: ageLabel } = parseIndentationPrefix($ageGroupValToLab.get(val) || val)}
							<option value={val}>{isIndented ? '    ' + ageLabel : ageLabel}</option>
						{/each}
					</select>
				</div>

				<!-- Syndrome -->
				<div>
					<label
						class="text-base-content/60 mb-1 block text-xs font-medium uppercase tracking-wide"
						for="lm-syndrome"
					>
						Syndrome
					</label>
					<select
						id="lm-syndrome"
						class="select select-sm select-bordered w-full bg-white/80 text-xs focus:border-primary disabled:opacity-40"
						value={lmSyndrome}
						disabled={!lmAgeGroup}
						onchange={(e) => selectSyndrome(e.currentTarget.value)}
					>
						<option value="">
							{lmAgeGroup ? 'Select syndrome' : 'Select age group first'}
						</option>
						{#each availableSyndromes as val}
							{@const { isIndented, text: synLabel } = parseIndentationPrefix($syndromeValToLab.get(val) || val)}
							<option value={val}>{isIndented ? '    ' + synLabel : synLabel}</option>
						{/each}
					</select>
				</div>

				<!-- Display (always visible) -->
				<div>
					<p class="text-primary mb-1 text-xs font-medium uppercase tracking-wide">
						Display
					</p>
					<div class="space-y-1.5">
						<!-- Data Points row -->
						<div class="border-base-300 rounded-md border bg-white/50 px-2.5 py-1.5">
							<div class="flex items-center justify-between">
								<span class="flex items-center gap-1.5 text-xs">
									<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
										<circle cx="5" cy="12" r="2" /><circle cx="12" cy="5" r="2" />
										<circle cx="19" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
										<circle cx="12" cy="12" r="2" />
									</svg>
									Data Points
								</span>
								<button
									class="flex h-5 w-5 items-center justify-center rounded-full text-white transition-colors {layerAdded && dataPointsToggled ? 'bg-error/80 hover:bg-error' : 'bg-secondary/80 hover:bg-secondary'}"
									onclick={toggleDataPoints}
									title={layerAdded && dataPointsToggled ? 'Remove data points' : 'Add data points'}
								>
									<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
										{#if layerAdded && dataPointsToggled}
											<path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" />
										{:else}
											<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
										{/if}
									</svg>
								</button>
							</div>
							<!-- Pie Charts / Standard Dots sub-buttons -->
							<div class="mt-1.5 flex justify-center gap-1">
								{#each [...visualizationOptions].reverse() as option}
									<button
										class="btn h-5 min-h-0 px-2 text-[10px] {lmVisualizationType === option.value
											? 'btn-primary'
											: 'border-base-300 btn-ghost border'}"
										onclick={() => selectVisualizationType(option.value)}
										title={option.description}
									>
										{option.value === 'pie-charts' ? 'Pies' : 'Dots'}
									</button>
								{/each}
							</div>
						</div>
						<!-- Raster Layer row (grayed out when unavailable) -->
						<div class="border-base-300 flex items-center justify-between rounded-md border px-2.5 py-1.5 {hasRaster ? 'bg-white/50' : 'opacity-40'}">
							<span class="flex items-center gap-1.5 text-xs">
								<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
								</svg>
								Raster Layer
							</span>
							<button
								class="flex h-5 w-5 items-center justify-center rounded-full text-white transition-colors {layerAdded && rasterToggled ? 'bg-error/80 hover:bg-error' : hasRaster ? 'bg-secondary/80 hover:bg-secondary' : 'cursor-not-allowed bg-base-300'}"
								onclick={toggleRaster}
								disabled={!hasRaster}
								title={!hasRaster ? 'No raster available' : layerAdded && rasterToggled ? 'Remove raster layer' : 'Add raster layer'}
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
									{#if layerAdded && rasterToggled}
										<path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4" />
									{:else}
										<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
									{/if}
								</svg>
							</button>
						</div>
					</div>
				</div>

			</div>
		</div>
	{/if}


</div>
