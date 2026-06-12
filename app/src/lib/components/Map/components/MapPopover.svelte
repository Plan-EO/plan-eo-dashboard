<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import type { Map } from 'maplibre-gl';
	import { createEventDispatcher } from 'svelte';
	import type { PointProperties } from '$lib/types';
	import { formatItalicText, formatDropdownText } from '../utils/textFormatter';

	// Props
	export let map: Map | null = null;
	export let coordinates: [number, number] | null = null;
	export let properties: PointProperties | null = null;
	export let visible = false;

	// Event dispatcher for popup close
	const dispatch = createEventDispatcher();

	// Local popup instance
	let popup: maplibregl.Popup | null = null;
	let overlayElement: any = null;
	let clickMarker: maplibregl.Marker | null = null;

	// Create or update popup when data changes
	$: if (map && coordinates && properties && visible) {
		showPopup();
	} else if (popup) {
		cleanup();
	}

	function showPopup() {
		cleanup();

		if (!map || !coordinates || !properties) return;

		createOverlay();

		// Place a small dot at the click location so it stays visible when the popup is moved
		if (properties.layerType) {
			const dotEl = document.createElement('div');
			dotEl.style.cssText =
				'width:10px;height:10px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.5);pointer-events:none;';
			clickMarker = new maplibregl.Marker({ element: dotEl })
				.setLngLat(coordinates)
				.addTo(map);
		}

		// Create new popup
		popup = new maplibregl.Popup({
			closeButton: true,
			closeOnClick: false,
			maxWidth: '360px',
			className: 'study-point-popup',
			offset: 12
		})
			.setLngLat(coordinates)
			.setHTML(createPopupContent(properties))
			.addTo(map);

		// Make popup draggable after it is rendered
		requestAnimationFrame(() => {
			if (popup) makePopupDraggable(popup);
		});

		popup.on('close', () => {
			cleanup();
			visible = false;
			dispatch('close');
		});
	}

	function makePopupDraggable(p: maplibregl.Popup) {
		const el = p.getElement();
		if (!el) return;

		const content = el.querySelector('.maplibregl-popup-content') as HTMLElement | null;
		if (!content) return;

		content.style.cursor = 'grab';

		let dragging = false;
		let detached = false;
		let startMouseX = 0, startMouseY = 0;
		let startElX = 0, startElY = 0;

		const onMouseDown = (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest('.maplibregl-popup-close-button')) return;
			e.preventDefault();
			e.stopPropagation();
			dragging = true;
			content!.style.cursor = 'grabbing';

			if (!detached) {
				// Freeze the popup in screen space on first drag
				const rect = el.getBoundingClientRect();
				el.style.position = 'fixed';
				el.style.left = `${rect.left}px`;
				el.style.top = `${rect.top}px`;
				el.style.transform = 'none';
				el.style.margin = '0';
				el.style.zIndex = '10000';
				// Hide the directional tip since the popup is now floating freely
				const tip = el.querySelector('.maplibregl-popup-tip') as HTMLElement | null;
				if (tip) tip.style.display = 'none';
				detached = true;
			}

			startMouseX = e.clientX;
			startMouseY = e.clientY;
			startElX = parseFloat(el.style.left) || 0;
			startElY = parseFloat(el.style.top) || 0;
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!dragging) return;
			el.style.left = `${startElX + e.clientX - startMouseX}px`;
			el.style.top = `${startElY + e.clientY - startMouseY}px`;
		};

		const onMouseUp = () => {
			dragging = false;
			if (content) content.style.cursor = 'grab';
		};

		content.addEventListener('mousedown', onMouseDown);
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);

		(p as any)._dragCleanup = () => {
			content!.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		};
	}

	function createOverlay() {
		if (!map) return;

		// Add document-level click listener to detect clicks outside popup
		const handleDocumentClick = (e: MouseEvent) => {
			// Check if the click target is inside the popup content
			const popupContent = document.querySelector('.maplibregl-popup-content');
			const popupContainer = document.querySelector('.maplibregl-popup');

			if (
				popupContent &&
				(popupContent.contains(e.target as Node) ||
					(popupContainer && popupContainer.contains(e.target as Node)))
			) {
				// Click is inside popup, don't close it
				return;
			}

			// Click is outside popup, close it
			closePopup();
		};

		// Use requestAnimationFrame to ensure the popup is rendered before adding click listener
		// This prevents immediate closure on the same click that opened the popup
		requestAnimationFrame(() => {
			document.addEventListener('click', handleDocumentClick);
		});

		// Store the handler function so we can remove it later
		overlayElement = { handleDocumentClick } as any;
	}

	function closePopup() {
		cleanup();
		visible = false;
		dispatch('close');
	}

	function cleanup() {
		if (popup) {
			(popup as any)._dragCleanup?.();
			popup.remove();
			popup = null;
		}
		if (clickMarker) {
			clickMarker.remove();
			clickMarker = null;
		}
		if (overlayElement?.handleDocumentClick) {
			document.removeEventListener('click', overlayElement.handleDocumentClick);
			overlayElement = null;
		}
	}

	function createPopupContent(props: PointProperties): string {
		console.log('MapPopover: Creating popup content with properties:', props);
		if (!props) {
			console.error('MapPopover: No properties provided!');
			return '<div class="popup-content">No data available</div>';
		}
		// Color is based on PREV (decimal 0-1). Label comes from the Prevalence column (includes CI).
		const prevalencePercent =
			typeof props.prevalenceValue === 'number' && isFinite(props.prevalenceValue)
				? props.prevalenceValue * 100
				: 0;
		const prevalenceLabel =
			(props.prevalence && props.prevalence.trim()) || prevalencePercent.toFixed(2) + '%';

		// Determine prevalence color based on decimal value
		const prevalenceColor = getPrevalenceColor(props.prevalenceValue);

		// Format pathogen name with italic support
		const pathogenFormatted = formatItalicText(props.pathogen);

		// Use heading as title (with italic formatting)
		const title = formatItalicText(props.heading);
		const subtitle = formatItalicText(props.subheading);

		// Decide whether to show the source link (hide for raster popovers or invalid links)
		const showSourceLink = Boolean(
			props.source &&
				props.source.trim() &&
				props.source.trim() !== 'Raster Layer' &&
				props.hyperlink &&
				props.hyperlink.trim() &&
				props.hyperlink.trim() !== '#'
		);

		const colorBar = props.layerType
			? createColorBarHTML(props.rescaleMin ?? 0, props.rescaleMax ?? 11)
			: '';

		return `
      <div class="popup-content">
        <h3 class="popup-title">
          <span class="pathogen-name">
            ${title}
          </span>
        </h3>
        ${subtitle && subtitle.trim() ? `<div class="popup-subtitle">${subtitle}</div>` : ''}

        <div class="popup-section">
          ${props.layerType !== 'Risk Factor' ? `
          <div class="info-row">
            <div class="info-label">Pathogen:</div>
            <div class="info-value">${pathogenFormatted}</div>
          </div>` : ''}
					<div class="info-row">
						<div class="info-label">Prevalence (%):</div>
            <div class="info-value">
              <span class="prevalence-badge" style="background-color: ${prevalenceColor}">
				${prevalenceLabel}
              </span>
            </div>
          </div>
          ${colorBar}
          ${props.layerType !== 'Risk Factor' ? `
          <div class="info-row">
            <div class="info-label">Age Range:</div>
            <div class="info-value">${formatDropdownText(props.ageRange)}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Syndrome:</div>
            <div class="info-value">${formatDropdownText(props.syndrome)}</div>
          </div>` : ''}
          <div class="info-row">
            <div class="info-label">Location:</div>
            <div class="info-value">${formatItalicText(props.location)}</div>
          </div>
        </div>

        <div class="popup-section">
          <div class="info-row">
            <div class="info-label">Duration:</div>
            <div class="info-value">${formatItalicText(props.duration)}</div>
          </div>
          <div class="info-row">
            <div class="info-label">Design:</div>
            <div class="info-value">
              <span class="design-indicator-inline" style="background-color: ${getDesignColor(props.design)}"></span>
              ${formatItalicText(props.design)}
            </div>
          </div>
        </div>

        ${
					props.footnote && props.footnote.trim()
						? `
        <div class="popup-footnote">
          <small>${formatItalicText(props.footnote)}</small>
        </div>
        `
						: ''
				}

				${
					showSourceLink
						? `<div class="popup-footer">
					<a href="${props.hyperlink}" target="_blank" class="source-link">
						${props.source}
						<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
							<polyline points="15 3 21 3 21 9"></polyline>
							<line x1="10" y1="14" x2="21" y2="3"></line>
						</svg>
					</a>
				</div>`
						: ''
				}
      </div>
    `;
	}

	// Build inline viridis color bar HTML for raster popups
	function createColorBarHTML(minVal: number, maxVal: number): string {
		const stops = [
			[0,    'rgb(68,1,84)'],
			[0.11, 'rgb(72,40,120)'],
			[0.22, 'rgb(62,73,137)'],
			[0.33, 'rgb(49,104,142)'],
			[0.44, 'rgb(38,130,142)'],
			[0.55, 'rgb(31,158,137)'],
			[0.66, 'rgb(53,183,121)'],
			[0.77, 'rgb(109,205,89)'],
			[0.88, 'rgb(180,222,44)'],
			[1,    'rgb(253,231,37)']
		] as [number, string][];

		const gradient = stops.map(([s, c]) => `${c} ${s * 100}%`).join(', ');

		const numTicks = 5;
		const ticksHTML = Array.from({ length: numTicks }, (_, i) => {
			const frac = i / (numTicks - 1);
			const val = Math.round((minVal + (maxVal - minVal) * frac) * 10) / 10;
			return `<div style="position:absolute;left:${frac * 100}%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;">
				<div style="width:1px;height:5px;background:#888;"></div>
				<div style="font-size:10px;color:#666;white-space:nowrap;margin-top:1px;">${val}%</div>
			</div>`;
		}).join('');

		return `
			<div style="margin-top:12px;padding-bottom:10px;border-bottom:1px solid #eee;margin-bottom:8px;">
				<div style="height:14px;border-radius:3px;border:1px solid #ddd;background:linear-gradient(to right,${gradient});"></div>
				<div style="position:relative;height:22px;margin-top:2px;">${ticksHTML}</div>
			</div>`;
	}

	// Helper function to get color based on prevalence value
	function getPrevalenceColor(prevalence: number): string {
		if (prevalence < 0.1) return '#4daf4a'; // Low: green
		if (prevalence < 0.3) return '#ff7f00'; // Medium: orange
		if (prevalence < 0.5) return '#E4581C'; // High: lighter red
		return '#e41a1c'; // Very high: red
	}

	// Helper function to get design color
	function getDesignColor(design: string): string {
		// Design type color mapping (consistent with map dots)
		const designColors: { [key: string]: string } = {
			Surveillance: '#FFE5B4', // Pastel Orange
			'Intervention Trial': '#B7EFC5', // Pastel Green
			'Case-Control': '#FFB3C6', // Pastel Red
			Cohort: '#9197FF', // Pastel Blue
			'Cross-Sectional': '#E6B3FF', // Pastel Purple
			'Other: Cohort': '#9197FF', // Same as Cohort
			'Other: Mixed Design': '#C0C0C0' // Light Gray
		};
		return designColors[design] || '#C0C0C0'; // Default to gray if not found
	}
</script>

<style>
	/* These styles will be applied to the popup via the popup class */
	:global(.study-point-popup) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
			'Open Sans', 'Helvetica Neue', sans-serif;
	}

	:global(.study-point-popup .maplibregl-popup-content) {
		padding: 15px;
		border-radius: 8px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
	}

	:global(.maplibregl-popup-close-button) {
		width: 30px;
		height: 30px;
		font-size: 18px;
		border-radius: 8px;
	}
	:global(.popup-title) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin: 0 0 10px 0;
		padding-bottom: 8px;
		border-bottom: 1px solid #eee;
		font-size: 16px;
		font-weight: 600;
	}

	:global(.pathogen-name) {
		color: #333;
	}

	:global(.pathogen-name em) {
		font-style: italic;
		font-weight: 500;
	}

	:global(.popup-subtitle) {
		font-size: 14px;
		color: #666;
		margin: -5px 0 10px 0;
		font-style: italic;
	}

	:global(.popup-footnote) {
		margin-top: 10px;
		padding-top: 8px;
		border-top: 1px solid #eee;
		color: #666;
		font-size: 12px;
		line-height: normal;
	}

	:global(.popup-footnote em) {
		font-style: italic;
	}

	:global(.prevalence-badge) {
		display: inline-block;
		padding: 2px 8px;
		margin-right: 10px;
		border-radius: 12px;
		color: white;
		font-size: 13px;
		font-weight: 600;
	}

	:global(.popup-section) {
		margin-bottom: 12px;
	}

	:global(.info-row) {
		display: flex;
		margin-bottom: 6px;
		font-size: 14px;
	}

	:global(.info-label) {
		flex: 0 0 112px;
		font-weight: 500;
		color: #666;
	}

	:global(.info-value) {
		flex: 1;
		color: #333;
	}

	:global(.popup-footer) {
		padding-top: 8px;
		margin-top: 8px;
		border-top: 1px solid #eee;
		font-size: 13px;
	}

	:global(.source-link) {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #0066cc;
		text-decoration: none;
		font-size: 13px;
	}

	:global(.source-link:hover) {
		text-decoration: underline;
	}

	:global(.design-indicator-inline) {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin-right: 6px;
		border: 1px solid rgba(0, 0, 0, 0.2);
	}
</style>
