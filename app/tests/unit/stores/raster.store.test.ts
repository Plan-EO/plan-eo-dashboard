/**
 * Unit tests for raster layer config loading.
 *
 * Covers two things:
 *  1. Regression: `loadRasterLayersFromConfig()` / `loadFilterRasterMappings()` must
 *     actually be called and populate their stores (previously they were defined but
 *     never invoked, so selecting any raster layer silently did nothing).
 *  2. Fallback: when the primary raster source (RC storage mounted at /data/cogs/ in
 *     production) doesn't have raster-layers.json — e.g. in local dev where that mount
 *     doesn't exist — loading falls back to a bundled config and serves the .tif files
 *     from the public R2 bucket instead.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test';
import { get, writable } from 'svelte/store';

// Simulate the production-style primary raster base URL (RC storage mount), which
// doesn't exist in local dev — the fetch for it will 404 below.
process.env.VITE_RASTER_BASE_URL = '/data/cogs/';

// $app/environment is a SvelteKit virtual module bun's resolver can't load directly.
mock.module('$app/environment', () => ({
	browser: false,
	dev: false,
	building: false,
	version: 'test'
}));

// raster.store.ts pulls in svelte-french-toast via toast.store.ts, which bun's test
// resolver can't load — stub it out since toasts aren't relevant to this test.
mock.module('$lib/stores/toast.store', () => ({
	toastStore: { subscribe: writable({}).subscribe, success: () => {}, error: () => {} }
}));

const { rasterLayers, loadRasterLayersFromConfig } = await import('$lib/stores/raster.store');
const { filterToRasterMappings, loadFilterRasterMappings } = await import('$lib/components/Map/store/filterRasterMapping');
const { getLayerSourceUrl, __resetRasterConfigCache } = await import('$lib/services/rasterConfig');

const R2_COGS_URL = 'https://pub-6e8836a7d8be4fd1adc1317bb416ad75.r2.dev/cogs/';

// Risk Factor display names referenced by LayerManager.svelte's rfSubcategories
const expectedRiskFactorNames = [
	'Floor Finished – Coverage',
	'Roofs Finished – Coverage',
	'Walls Finished – Coverage',
	'Poultry Ownership – Coverage',
	'Ruminant Ownership – Coverage',
	'Swine Ownership – Coverage'
];

let originalFetch: typeof fetch;

beforeAll(() => {
	originalFetch = global.fetch;
	// Simulate /data/cogs/raster-layers.json not existing locally (no RC storage mount).
	global.fetch = (async (url: string | URL) => {
		return new Response('Not found', { status: 404 });
	}) as typeof fetch;
});

afterAll(() => {
	global.fetch = originalFetch;
});

beforeEach(() => {
	rasterLayers.set(new Map());
	filterToRasterMappings.set([]);
	__resetRasterConfigCache();
});

describe('raster config loading (RC storage unavailable -> R2 fallback)', () => {
	test('loadRasterLayersFromConfig falls back to the bundled config and populates rasterLayers', async () => {
		await loadRasterLayersFromConfig();

		const layers = get(rasterLayers);
		expect(layers.size).toBe(18);
	});

	test('layer source URLs fall back to the public R2 bucket', async () => {
		await loadRasterLayersFromConfig();

		const layers = Array.from(get(rasterLayers).values());
		for (const layer of layers) {
			expect(layer.sourceUrl.startsWith(R2_COGS_URL)).toBe(true);
		}

		expect(getLayerSourceUrl('01_Pathogens/SHIG/SHIG_0011_Asym_Pr.tif')).toBe(
			`${R2_COGS_URL}01_Pathogens/SHIG/SHIG_0011_Asym_Pr.tif`
		);
	});

	test('Risk Factor layers referenced by the Layer Manager UI exist in the loaded config', async () => {
		await loadRasterLayersFromConfig();

		const names = Array.from(get(rasterLayers).values()).map((l) => l.name);
		for (const expectedName of expectedRiskFactorNames) {
			expect(names).toContain(expectedName);
		}
	});

	test('loadFilterRasterMappings populates pathogen-to-raster mappings', async () => {
		await loadFilterRasterMappings();

		const mappings = get(filterToRasterMappings);
		expect(mappings.length).toBeGreaterThan(0);

		const shigellaMapping = mappings.find(
			(m) => m.pathogen === '__Shigella__' && m.ageGroup === '0-11 months' && m.syndrome === 'Asymptomatic'
		);
		expect(shigellaMapping).toBeDefined();
	});
});
