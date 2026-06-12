<script lang="ts">
	// Props
	export let visible = true;

	// Define the color mappings for the legend
	// const positiveNegativeColors = [
	// 	{ label: 'Positive', color: '#808080' }, // Dark gray
	// 	{ label: 'Negative', color: '#D3D3D3' } // Light gray
	// ];

	const designColors = [
		{ label: 'Surveillance', color: '#FFE5B4' }, // Pastel Orange (matches map dot)
		{ label: 'Intervention Trial', color: '#B7EFC5' }, // Pastel Green (matches map dot)
		{ label: 'Case-Control', color: '#FFB3C6' }, // Pastel Red (matches map dot)
		{ label: 'Cohort', color: '#9197FF' }, // Pastel Blue (matches map dot)
		{ label: 'Cross-Sectional', color: '#E6B3FF' }, // Pastel Purple
		{ label: 'Other: Mixed Design', color: '#C0C0C0' } // Light Gray
	];
</script>

{#if visible}
	<div
		class="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-white/30 bg-gradient-to-r from-white/80 to-white/70 shadow-lg backdrop-blur-md backdrop-filter"
		style="padding: 12px 48px 12px 12px;"
	>
		<!-- Positive/Negative section -->
		<!-- <div class="mb-3">
			{#each positiveNegativeColors as item}
				<div class="mb-1 flex items-center">
					<div class="mr-2 h-4 w-4 rounded-sm" style="background-color: {item.color};"></div>
					<span class="text-base-content text-sm">{item.label}</span>
				</div>
			{/each}
		</div> -->

		<!-- Design types section - Horizontal layout -->
		<div class="flex items-center gap-4">
			<span class="flex-none text-sm font-bold">Design types</span>
			<div class="flex items-center gap-3">
				{#each designColors as item}
					<div class="flex items-center gap-1.5">
						<div class="h-3 w-3 rounded-sm" style="background-color: {item.color};"></div>
						<span class="text-base-content whitespace-nowrap text-xs">{item.label}</span>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}
