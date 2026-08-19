<script lang="ts">
	import '$lib/assets/css/app.css';
	import '$lib/assets/css/code-highlighted-prisma.css';
	import Header from '$components/ui/Header.svelte';
	import { SHOW_HEADER } from '$lib/config/layout';
	// import Analytics from '$components/ui/Analytics.svelte';
	import SideMenu from '$components/ui/SideMenu.svelte';
	import GlobalToast from '$components/ui/GlobalToast.svelte';
	// Password protection imports - commented out for production release
	// import PasswordModal from '$components/ui/PasswordModal.svelte';
	// import { isAuthenticated } from '$lib/stores/auth.store';
	// import { browser, dev } from '$app/environment';
	import { page } from '$app/stores';
	import { browser, dev } from '$app/environment';
	// import { env } from '$env/dynamic/public';
	interface Props {
		children?: import('svelte').Snippet;
	}

	let { children }: Props = $props();

	// Check if embed parameter is present in URL
	let isEmbedded = $derived(browser && $page.url.searchParams.get('embed') === 'true');
	// import FooterMain from '$components/ui/footerMain.svelte';

	// Password authentication handler - commented out for production release
	// function handleAuthenticated() {
	// 	isAuthenticated.set(true);
	// }
</script>

<!-- <Analytics /> -->
<GlobalToast />

<svelte:head>
	<title>{dev ? 'DEV - ' : ''}PLAN-EO</title>
</svelte:head>

<div
	class="relative grid h-dvh w-dvw {isEmbedded || !SHOW_HEADER
		? 'grid-rows-[1fr]'
		: 'grid-rows-[auto_auto_1fr] sm:grid-rows-[auto_1fr]'} overflow-clip"
>
	<!-- Password protection commented out for production release
	{#if browser && !dev && !$isAuthenticated}
		<PasswordModal on:authenticated={handleAuthenticated} />
		<div class="blur-md filter">
			<Header />
			<SideMenu />
			{#if children}{@render children()}{:else}
				Content here
			{/if}
		</div>
	{:else} -->
	{#if !isEmbedded}
		{#if SHOW_HEADER}<Header />{/if}
		<SideMenu />
	{/if}
	{#if children}{@render children()}{:else}
		<!-- Content here -->
	{/if}
	<!-- {/if} -->
	<!-- <FooterMain /> -->
	<!-- {#if env.PUBLIC_LOCALHOST}
		<div class="bg-warning text-warning-content fixed bottom-0 left-0 w-full pl-4 text-xs">
			dev database
		</div>
	{/if} -->
</div>
