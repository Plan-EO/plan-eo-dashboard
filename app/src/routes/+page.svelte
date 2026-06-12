<script>
	import Map from '$lib/components/Map/Map.svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';

	let isEmbedded = $derived(browser && $page.url.searchParams.get('embed') === 'true');
</script>

<div class={isEmbedded ? 'h-full w-full' : '-mt-[80px]'}>
	<Map />
</div>
