<script>
	import Map from '$lib/components/Map/Map.svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { SHOW_HEADER } from '$lib/config/layout';

	let isEmbedded = $derived(browser && $page.url.searchParams.get('embed') === 'true');
</script>

<div class={isEmbedded || !SHOW_HEADER ? 'h-full w-full' : '-mt-[80px]'}>
	<Map />
</div>
