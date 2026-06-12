import type { Map as MaplibreMap } from 'maplibre-gl';
import type { MapGeoJSONFeature } from 'maplibre-gl';

/**
 * Calculate the pie chart radius based on sample count
 * This mirrors the logic in pieChartUtils.ts
 */
function getPieChartRadius(samples: number): number {
  // Size calculation from pieChartUtils: optimized for 10-50,000 sample range
  const size = Math.max(20, Math.min(100, 20 * Math.log10(samples + 1))); // ~20px at 10 samples, ~94px at 50k samples
  return size / 2; // Return radius, not diameter
}

/**
 * Detects overlapping features at a specific coordinate
 * For pie charts, considers visual overlap based on their rendered sizes
 * @param map - MapLibre map instance
 * @param coordinates - The clicked coordinates [lng, lat]
 * @param clickPoint - The click point in pixels
 * @returns Array of features at this location
 */
export function detectOverlappingFeatures(
  map: MaplibreMap,
  coordinates: [number, number],
  clickPoint: { x: number; y: number }
): MapGeoJSONFeature[] {
  // Query all visualization layers at the click point
  const layers = ['points-layer', 'pie-charts'];
  
  // Use a larger buffer for pie charts to catch overlapping ones
  const buffer = 100; // Maximum pie chart radius (updated for larger max size)
  
  const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
    [clickPoint.x - buffer, clickPoint.y - buffer],
    [clickPoint.x + buffer, clickPoint.y + buffer]
  ];
  
  const allFeatures: MapGeoJSONFeature[] = [];
  const seenIds = new Set<string>();
  
  // Check if we're in pie chart mode
  const hasPieChartLayer = map.getLayer('pie-charts');
  
  layers.forEach(layerId => {
    if (map.getLayer(layerId)) {
      const features = map.queryRenderedFeatures(bbox, {
        layers: [layerId]
      });
      
      features.forEach(feature => {
        // Create unique key for deduplication
        const uniqueKey = `${feature.properties?.pathogen}_${feature.properties?.ageGroup || feature.properties?.age_group}_${feature.properties?.syndrome}_${feature.properties?.prevalenceValue || feature.properties?.prevalence_value}`;
        
        if (!seenIds.has(uniqueKey)) {
          seenIds.add(uniqueKey);
          allFeatures.push(feature);
        }
      });
    }
  });
  
  // If we're showing pie charts, detect visual overlap
  if (hasPieChartLayer && allFeatures.length > 0) {
    const clickedFeature = findClickedFeature(allFeatures, clickPoint, map);
    if (!clickedFeature) return [];
    
    return findVisuallyOverlappingFeatures(clickedFeature, allFeatures, map);
  }
  
  // For non-pie chart visualizations, use exact coordinate matching
  const exactMatches = allFeatures.filter(feature => {
    if (feature.geometry.type === 'Point') {
      const coords = feature.geometry.coordinates as [number, number];
      return Math.abs(coords[0] - coordinates[0]) < 0.000001 && 
             Math.abs(coords[1] - coordinates[1]) < 0.000001;
    }
    return false;
  });
  
  return exactMatches;
}

/**
 * Find which feature was actually clicked
 */
function findClickedFeature(
  features: MapGeoJSONFeature[], 
  clickPoint: { x: number; y: number },
  map: MaplibreMap
): MapGeoJSONFeature | null {
  let closestFeature: MapGeoJSONFeature | null = null;
  let minDistance = Infinity;
  
  features.forEach(feature => {
    if (feature.geometry.type === 'Point') {
      const coords = feature.geometry.coordinates as [number, number];
      const screenPoint = map.project(coords as [number, number]);
      const distance = Math.sqrt(
        Math.pow(screenPoint.x - clickPoint.x, 2) + 
        Math.pow(screenPoint.y - clickPoint.y, 2)
      );
      
      const samples = feature.properties?.samples || feature.properties?.n || 100;
      const radius = getPieChartRadius(samples);
      
      // Check if click is within this pie chart
      if (distance <= radius && distance < minDistance) {
        minDistance = distance;
        closestFeature = feature;
      }
    }
  });
  
  return closestFeature;
}

/**
 * Find all features that visually overlap with the clicked feature
 */
function findVisuallyOverlappingFeatures(
  clickedFeature: MapGeoJSONFeature,
  allFeatures: MapGeoJSONFeature[],
  map: MaplibreMap
): MapGeoJSONFeature[] {
  const overlappingFeatures: MapGeoJSONFeature[] = [clickedFeature];
  const processed = new Set<string>();
  const toProcess = [clickedFeature];
  
  // Create unique key for a feature
  const getFeatureKey = (f: MapGeoJSONFeature) => 
    `${f.properties?.pathogen}_${f.properties?.ageGroup || f.properties?.age_group}_${f.properties?.syndrome}_${f.properties?.prevalenceValue || f.properties?.prevalence_value}`;
  
  processed.add(getFeatureKey(clickedFeature));
  
  // Process features to find chains of overlaps
  while (toProcess.length > 0) {
    const currentFeature = toProcess.pop()!;
    
    if (currentFeature.geometry.type !== 'Point') continue;
    
    const currentCoords = currentFeature.geometry.coordinates as [number, number];
    const currentScreenPoint = map.project(currentCoords);
    const currentSamples = currentFeature.properties?.samples || currentFeature.properties?.n || 100;
    const currentRadius = getPieChartRadius(currentSamples);
    
    // Check against all other features
    allFeatures.forEach(otherFeature => {
      const otherKey = getFeatureKey(otherFeature);
      
      if (!processed.has(otherKey) && otherFeature.geometry.type === 'Point') {
        const otherCoords = otherFeature.geometry.coordinates as [number, number];
        const otherScreenPoint = map.project(otherCoords);
        const otherSamples = otherFeature.properties?.samples || otherFeature.properties?.n || 100;
        const otherRadius = getPieChartRadius(otherSamples);
        
        // Calculate distance between centers in pixels
        const distance = Math.sqrt(
          Math.pow(currentScreenPoint.x - otherScreenPoint.x, 2) + 
          Math.pow(currentScreenPoint.y - otherScreenPoint.y, 2)
        );
        
        // Check if circles overlap or touch (with negative tolerance for tighter grouping)
        const tolerance = -5; // Negative tolerance means they need to overlap by 5px
        if (distance <= currentRadius + otherRadius + tolerance) {
          overlappingFeatures.push(otherFeature);
          toProcess.push(otherFeature);
          processed.add(otherKey);
        }
      }
    });
  }
  
  return overlappingFeatures;
}