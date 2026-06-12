import { get } from 'svelte/store';
import { isLoading, dataError, pointsData, pathogenColors } from '$lib/stores/data.store';
import {
  pathogens,
  ageGroups,
  syndromes,
  selectedPathogens,
  selectedAgeGroups,
  selectedSyndromes,
  ageGroupValToLab,
  ageGroupLabToVal,
  syndromeValToLab,
  syndromeLabToVal,
  clearFilterCache
} from '$lib/stores/filter.store';
import { convertCsvToGeoJson } from './geoJsonConverter';
import { generateColors } from './colorManager';
import Papa from 'papaparse';
import type { ParseResult, ParseConfig } from 'papaparse';
import type { PointDataRow, PointFeatureCollection } from '$lib/types';

// Helper function to load CSV data with caching
let dataCache: PointFeatureCollection | null = null;
let currentFetchController: AbortController | null = null;

export async function loadPointsData(url: string, forceReload: boolean = false): Promise<void> {
  // console.log('loadPointsData called with URL:', url);

  // Use cached data if available and not forcing reload (before aborting any in-flight request)
  if (dataCache && !forceReload) {
    console.log('Using cached data');
    pointsData.set(dataCache);
    return;
  }

  // Abort any in-flight fetch before starting a new one
  if (currentFetchController) {
    currentFetchController.abort();
  }
  currentFetchController = new AbortController();
  const signal = currentFetchController.signal;

  isLoading.set(true);
  dataError.set(null);

  try {
    // Add cache busting to the URL
    const cacheBuster = url.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
    const fetchUrl = url + cacheBuster;

    // console.log('Fetching from URL:', fetchUrl);
    const response = await fetch(fetchUrl, { signal });
    // console.log('Response status:', response.status, response.ok);
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }

    let csvText = await response.text();
    // console.log('CSV text length:', csvText.length);
    
    // Remove BOM if present
    if (csvText.charCodeAt(0) === 0xFEFF) {
      csvText = csvText.slice(1);
      // console.log('Removed BOM from CSV');
    }
    
    // Detect delimiter by checking first line
    const firstLine = csvText.split('\n')[0];
    const delimiter = firstLine.includes(';') ? ';' : ',';

    // Configure standard Papa Parse with proper typing
    const parseConfig: ParseConfig<PointDataRow> = {
      header: true,
      skipEmptyLines: true,
      delimiter: delimiter,
      quoteChar: '"',
      dynamicTyping: false, // Keep all values as strings initially
      transform: (value, field) => {
        // Manually convert numeric fields to numbers
        const numericFields = ['CASES', 'SAMPLES', 'PREV', 'SE', 'SITE_LAT', 'SITE_LON'];
        
        if (typeof field === 'string' && numericFields.includes(field)) {
          // Convert numeric fields to numbers
          const num = parseFloat(value as string);
          return isNaN(num) ? value : num;
        }
        
        if (typeof value === 'string') {
          // Keep markdown formatting for display purposes
          // The __ markers will be converted to italics in the UI
          return value.trim();
        }
        return value;
      }
    };

    // Parse the CSV data using standard parsing
    const result: ParseResult<PointDataRow> = Papa.parse(csvText, parseConfig);

    // Log any parsing warnings but continue processing
    if (result.errors && result.errors.length > 0) {
      console.warn(`CSV parsing warnings: ${result.errors.length} issues found`);

      // Log a sample of errors for debugging
      if (result.errors.length > 0) {
        console.warn('Sample errors:', result.errors.slice(0, 3));
      }
    }

    if (result.data && result.data.length > 0) {
      // console.log(`Successfully loaded ${result.data.length} data points`);

      // Convert to GeoJSON (this also builds indices)
      const geoData = convertCsvToGeoJson(result.data as PointDataRow[]);
      // Clear stale filter cache before updating data so old indices aren't served
      clearFilterCache();
      pointsData.set(geoData);
      dataCache = geoData; // Cache the data

      // Extract unique filter values and create mappings
      const pathogenSet = new Set<string>();
      const ageGroupValSet = new Set<string>();  // Store VAL values
      const syndromeValSet = new Set<string>();  // Store VAL values
      
      // Create mappings between VAL and LAB
      const ageValToLab = new Map<string, string>();
      const ageLabToVal = new Map<string, string>();
      const synValToLab = new Map<string, string>();
      const synLabToVal = new Map<string, string>();

      // Debug: Log first few rows to see actual data (disabled)
      // console.log('First 3 rows of CSV data:', result.data.slice(0, 3));

      // Validate data before adding to sets
      result.data.forEach((row: any) => {
        // Check if this is actually CSV data (has expected fields)
        if (row && typeof row === 'object') {
          
          // Extract pathogen
          if (row.Pathogen && typeof row.Pathogen === 'string') {
            pathogenSet.add(row.Pathogen);
          }

          // Extract age group VAL and create mappings
          if (row.AGE_VAL && row.AGE_LAB) {
            // Ensure values are strings
            const val = String(row.AGE_VAL);
            const lab = String(row.AGE_LAB);
            ageGroupValSet.add(val);
            ageValToLab.set(val, lab);
            ageLabToVal.set(lab, val);
          }

          // Extract syndrome VAL and create mappings
          if (row.SYNDROME_VAL && row.SYNDROME_LAB) {
            // Ensure values are strings
            const val = String(row.SYNDROME_VAL);
            const lab = String(row.SYNDROME_LAB);
            syndromeValSet.add(val);
            synValToLab.set(val, lab);
            synLabToVal.set(lab, val);
          }
        }
      });
      
      // Sort VAL values based on their numeric prefix
      const sortValSet = (valSet: Set<string>): string[] => {
        return Array.from(valSet).sort((a, b) => {
          // Ensure values are strings before processing
          const strA = String(a);
          const strB = String(b);
          
          // Extract numeric prefix if present (e.g., "01" from "01_Age_PSAC")
          const partsA = strA.includes('_') ? strA.split('_') : [strA];
          const partsB = strB.includes('_') ? strB.split('_') : [strB];
          
          const numA = parseInt(partsA[0]) || 999;
          const numB = parseInt(partsB[0]) || 999;
          
          if (numA !== numB) {
            return numA - numB;
          }
          
          // If numbers are equal or not present, sort alphabetically
          return strA.localeCompare(strB);
        });
      };
      
      const sortedAgeVals = sortValSet(ageGroupValSet);
      const sortedSyndromeVals = sortValSet(syndromeValSet);

      // console.log('Extracted unique values from data:', {
      //   pathogens: Array.from(pathogenSet),
      //   ageGroupVals: sortedAgeVals,
      //   syndromeVals: sortedSyndromeVals
      // });

      // If we have no valid data, the CSV parsing is probably not working correctly
      if (pathogenSet.size === 0 && ageGroupValSet.size === 0 && syndromeValSet.size === 0) {
        console.error('No valid data found in parsed CSV. Parser may have misinterpreted the file format.');
        throw new Error('Failed to parse valid data from CSV file');
      }

      // Check if Campylobacter (without spp.) exists in the data BEFORE adding synthetic entries
      const hasCampylobacter = Array.from(pathogenSet).some(p =>
        p.toLowerCase().includes('campylobacter') && p !== 'Campylobacter spp.');

      // Ensure Shigella and Campylobacter are always available as pathogen options
      // since we have raster layers for them
      // Use the same format as in the data (with __ markers for italics)
      pathogenSet.add('__Shigella__');
      pathogenSet.add('__Campylobacter__');

      // console.log('Campylobacter check:', {
      //   hasCampylobacter,
      //   campylobacterVariants: Array.from(pathogenSet).filter(p => p.toLowerCase().includes('campylobacter'))
      // });

      // console.log('Added Shigella spp. and Campylobacter spp. to pathogens set. Current pathogens:', Array.from(pathogenSet));

      // Don't add duplicate age groups, we'll handle this in the UI
      // console.log('Current age groups from data:', sortedAgeVals);

      // Ensure syndromes needed for raster layers are available - need to add the VAL
      // Find if we have Asymptomatic in the LAB values and get its VAL
      let asymptomaticVal: string | undefined;
      for (const [val, lab] of synValToLab.entries()) {
        if (lab === 'Asymptomatic') {
          asymptomaticVal = val;
          break;
        }
      }
      // If not found, we might need to add it manually
      // console.log('Added syndromes for raster layers. Current syndromes:', sortedSyndromeVals);

      // Update stores with VAL values and mappings
      // console.log('Setting stores with:', {
      //   pathogens: Array.from(pathogenSet),
      //   ageGroupVals: sortedAgeVals,
      //   syndromeVals: sortedSyndromeVals
      // });
      pathogens.set(pathogenSet);
      ageGroups.set(new Set(sortedAgeVals));  // Store VAL values
      syndromes.set(new Set(sortedSyndromeVals));  // Store VAL values
      
      // Store the mappings
      ageGroupValToLab.set(ageValToLab);
      ageGroupLabToVal.set(ageLabToVal);
      syndromeValToLab.set(synValToLab);
      syndromeLabToVal.set(synLabToVal);
      
      // Set default selections if nothing is selected
      const selectedPathogensValue = get(selectedPathogens);
      const selectedAgeGroupsValue = get(selectedAgeGroups);
      const selectedSyndromesValue = get(selectedSyndromes);
      
      if (selectedPathogensValue.size === 0 && selectedAgeGroupsValue.size === 0 && selectedSyndromesValue.size === 0) {
        // Set default selections
        const defaultPathogen = Array.from(pathogenSet).find(p => p.includes('Campylobacter')) || Array.from(pathogenSet)[0];
        
        // Find default age group VAL for "<5 years"
        let defaultAgeVal: string | undefined;
        for (const [val, lab] of ageValToLab.entries()) {
          if (lab.includes('<5 years')) {
            defaultAgeVal = val;
            break;
          }
        }
        if (!defaultAgeVal) defaultAgeVal = sortedAgeVals[0];
        
        // Find default syndrome VAL for "Diarrhea (any severity)"
        let defaultSyndromeVal: string | undefined;
        for (const [val, lab] of synValToLab.entries()) {
          if (lab.includes('Diarrhea (any severity)')) {
            defaultSyndromeVal = val;
            break;
          }
        }
        if (!defaultSyndromeVal) defaultSyndromeVal = sortedSyndromeVals[0];
        
        if (defaultPathogen) selectedPathogens.set(new Set([defaultPathogen]));
        if (defaultAgeVal) selectedAgeGroups.set(new Set([defaultAgeVal]));
        if (defaultSyndromeVal) selectedSyndromes.set(new Set([defaultSyndromeVal]));
        
        console.log('Set default filters:', {
          pathogen: defaultPathogen,
          ageGroup: defaultAgeVal + ' (' + ageValToLab.get(defaultAgeVal) + ')',
          syndrome: defaultSyndromeVal + ' (' + synValToLab.get(defaultSyndromeVal) + ')'
        });
      } else {
        console.log('Filters already set from URL:', {
          pathogens: Array.from(selectedPathogensValue),
          ageGroups: Array.from(selectedAgeGroupsValue),
          syndromes: Array.from(selectedSyndromesValue)
        });
      }

      // Generate colors for pathogens
      const colorMap = generateColors(pathogenSet);
      pathogenColors.set(colorMap);

      // Check for Campylobacter variants in the data
      if (!hasCampylobacter) {
        // Find any Campylobacter variant in the data
        const campyVariant = Array.from(pathogenSet).find(p =>
          p.toLowerCase().includes('campylobacter') && p !== 'Campylobacter spp.');
        
        if (campyVariant) {
          console.log(`Found Campylobacter variant in data: ${campyVariant}`);
          // The filter store will handle mapping between variants
        }
      }

      // console.log(`Data loaded with ${pathogenSet.size} pathogens, ${ageGroupSet.size} age groups, and ${syndromeSet.size} syndromes`);
      // console.log('All pathogens:', Array.from(pathogenSet));
    } else {
      dataError.set('No data found in CSV file');
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return; // Superseded by a newer fetch — silently ignore
    }
    console.error('Error loading point data:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
    }
    dataError.set(error instanceof Error ? error.message : 'Unknown error loading data');
  } finally {
    isLoading.set(false);
  }
}
