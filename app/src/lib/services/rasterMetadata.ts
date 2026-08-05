/**
 * Service for managing raster layer metadata.
 * Metadata is loaded from raster-layers.json via rasterConfig.
 */

export interface RasterMetadata {
  type: 'Pathogen' | 'Risk Factor';
  variableName: string;
  fileName: string;
  ageGroup?: string;
  syndrome?: string;
  indicator: string;
  definition: string;
  period: string;
  study: string;
  source: string;
  hyperlink: string;
  popupHeading?: string;
  popupSubheading?: string;
}

import { loadRasterConfig, configToMetadata } from '$lib/services/rasterConfig';

// Map of file names (without extension) to metadata
let metadataMap = new Map<string, RasterMetadata>();
let initialized = false;

/**
 * Load metadata from raster-layers.json config.
 * Called once at app startup.
 */
export async function initRasterMetadata(): Promise<void> {
  if (initialized) return;

  const config = await loadRasterConfig();
  metadataMap = new Map();

  for (const layer of config.layers) {
    const meta = configToMetadata(layer) as RasterMetadata;
    const fileName = layer.path.split('/').pop()?.replace(/\.tif$/i, '') || '';
    if (fileName) {
      metadataMap.set(fileName, meta);
    }
  }

	metadataMap.set('SHIG_0011_Medi_Pr', {
		...shigellaMeta,
		variableName: 'SHIG',
		fileName: 'SHIG_0011_Medi_Pr',
		ageGroup: '0-11 months',
		syndrome: 'Medically attended diarrhea - outpatient',
		indicator: 'Prevalence (%)'
	});

	// SHIG 12-23 months
	metadataMap.set('SHIG_1223_Asym_Pr', {
		...shigellaMeta,
		variableName: 'SHIG',
		fileName: 'SHIG_1223_Asym_Pr',
		ageGroup: '12-23 months',
		syndrome: 'Asymptomatic',
		indicator: 'Prevalence (%)'
	});

	metadataMap.set('SHIG_1223_Comm_Pr', {
		...shigellaMeta,
		variableName: 'SHIG',
		fileName: 'SHIG_1223_Comm_Pr',
		ageGroup: '12-23 months',
		syndrome: 'Community detected diarrhea',
		indicator: 'Prevalence (%)'
	});

	metadataMap.set('SHIG_1223_Medi_Pr', {
		...shigellaMeta,
		variableName: 'SHIG',
		fileName: 'SHIG_1223_Medi_Pr',
		ageGroup: '12-23 months',
		syndrome: 'Medically attended diarrhea - outpatient',
		indicator: 'Prevalence (%)'
	});

	// SHIG 24-59 months
	metadataMap.set('SHIG_2459_Asym_Pr', {
		...shigellaMeta,
		variableName: 'SHIG',
		fileName: 'SHIG_2459_Asym_Pr',
		ageGroup: '24-59 months',
		syndrome: 'Asymptomatic',
		indicator: 'Prevalence (%)'
	});

	metadataMap.set('SHIG_2459_Comm_Pr', {
		...shigellaMeta,
		variableName: 'SHIG',
		fileName: 'SHIG_2459_Comm_Pr',
		ageGroup: '24-59 months',
		syndrome: 'Community detected diarrhea',
		indicator: 'Prevalence (%)'
	});

	metadataMap.set('SHIG_2459_Medi_Pr', {
		...shigellaMeta,
		variableName: 'SHIG',
		fileName: 'SHIG_2459_Medi_Pr',
		ageGroup: '24-59 months',
		syndrome: 'Medically attended diarrhea - outpatient',
		indicator: 'Prevalence (%)'
	});

	// Standard error entries for SHIG
	const shigellaStdError = {
		...shigellaMeta,
		indicator: 'Standard error'
	};

	// SHIG SE 0-11 months
	metadataMap.set('SHIG_0011_Asym_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_0011_Asym_SE',
		ageGroup: '0-11 months',
		syndrome: 'Asymptomatic'
	});

	metadataMap.set('SHIG_0011_Comm_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_0011_Comm_SE',
		ageGroup: '0-11 months',
		syndrome: 'Community detected diarrhea'
	});

	metadataMap.set('SHIG_0011_Medi_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_0011_Medi_SE',
		ageGroup: '0-11 months',
		syndrome: 'Medically attended diarrhea - outpatient'
	});

	// SHIG SE 12-23 months
	metadataMap.set('SHIG_1223_Asym_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_1223_Asym_SE',
		ageGroup: '12-23 months',
		syndrome: 'Asymptomatic'
	});

	metadataMap.set('SHIG_1223_Comm_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_1223_Comm_SE',
		ageGroup: '12-23 months',
		syndrome: 'Community detected diarrhea'
	});

	metadataMap.set('SHIG_1223_Medi_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_1223_Medi_SE',
		ageGroup: '12-23 months',
		syndrome: 'Medically attended diarrhea - outpatient'
	});

	// SHIG SE 24-59 months
	metadataMap.set('SHIG_2459_Asym_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_2459_Asym_SE',
		ageGroup: '24-59 months',
		syndrome: 'Asymptomatic'
	});

	metadataMap.set('SHIG_2459_Comm_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_2459_Comm_SE',
		ageGroup: '24-59 months',
		syndrome: 'Community detected diarrhea'
	});

	metadataMap.set('SHIG_2459_Medi_SE', {
		...shigellaStdError,
		variableName: 'SHIG',
		fileName: 'SHIG_2459_Medi_SE',
		ageGroup: '24-59 months',
		syndrome: 'Medically attended diarrhea - outpatient'
	});

	// Risk Factors
	const riskFactorMeta = {
		type: 'Risk Factor' as const,
		period: '2023',
		study: 'Spatial variation in housing construction material',
		source: 'Colston et al. 2024, PLOS GPH'
	};

	// Floor
	metadataMap.set('Flr_Fin_Pr', {
		...riskFactorMeta,
		variableName: 'Floor',
		fileName: 'Flr_Fin_Pr',
		indicator: 'Coverage (%)',
		definition: 'Predicted coverage of improved floor material',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003338'
	});

	metadataMap.set('Flr_Fin_SE', {
		...riskFactorMeta,
		variableName: 'Floor',
		fileName: 'Flr_Fin_SE',
		indicator: 'Standard error',
		definition: 'Standard error of predicted coverage',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003339'
	});

	// Roofs
	metadataMap.set('Rfs_Fin_Pr', {
		...riskFactorMeta,
		variableName: 'Roofs',
		fileName: 'Rfs_Fin_Pr',
		indicator: 'Coverage (%)',
		definition: 'Predicted coverage of improved roof material',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003340'
	});

	metadataMap.set('Rfs_Fin_SE', {
		...riskFactorMeta,
		variableName: 'Roofs',
		fileName: 'Rfs_Fin_SE',
		indicator: 'Standard error',
		definition: 'Standard error of predicted coverage',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003341'
	});

	// Walls
	metadataMap.set('Wll_Fin_Pr', {
		...riskFactorMeta,
		variableName: 'Walls',
		fileName: 'Wll_Fin_Pr',
		indicator: 'Coverage (%)',
		definition: 'Predicted coverage of improved wall material',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003342'
	});

	metadataMap.set('Wll_Fin_SE', {
		...riskFactorMeta,
		variableName: 'Walls',
		fileName: 'Wll_Fin_SE',
		indicator: 'Standard error',
		definition: 'Standard error of predicted coverage',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003343'
	});

	// Animal Interventions
	const animalMeta = {
		...riskFactorMeta,
		study: 'Spatial variation in animal ownership'
	};

	metadataMap.set('Pty_Yes_Pr', {
		...animalMeta,
		variableName: 'Poultry',
		fileName: 'Pty_Yes_Pr',
		indicator: 'Coverage (%)',
		definition: 'Predicted coverage of poultry ownership',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003338'
	});

	metadataMap.set('Rum_Yes_Pr', {
		...animalMeta,
		variableName: 'Ruminant',
		fileName: 'Rum_Yes_Pr',
		indicator: 'Coverage (%)',
		definition: 'Predicted coverage of ruminant ownership',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003338'
	});

	metadataMap.set('Pig_Yes_Pr', {
		...animalMeta,
		variableName: 'Swine',
		fileName: 'Pig_Yes_Pr',
		indicator: 'Coverage (%)',
		definition: 'Predicted coverage of swine ownership',
		hyperlink: 'https://doi.org/10.1371/journal.pgph.0003338'
	});

  initialized = true;
}

/**
 * Get metadata for a raster layer by file name
 */
export function getRasterMetadata(fileName: string): RasterMetadata | undefined {
  if (metadataMap.has(fileName)) {
    return metadataMap.get(fileName);
  }

  const fileNameMatch = fileName.match(/([^/]+)\.(tif|tiff)$/i);
  if (fileNameMatch) {
    const baseName = fileNameMatch[1];
    return metadataMap.get(baseName);
  }

  return undefined;
}

/**
 * Get metadata by matching the source URL
 */
export function getRasterMetadataByUrl(sourceUrl: string): RasterMetadata | undefined {
  const urlParts = sourceUrl.split('/');
  const fileNameWithExt = urlParts[urlParts.length - 1];
  const fileName = fileNameWithExt.replace(/\.(tif|tiff)$/i, '');
  return getRasterMetadata(fileName);
}
