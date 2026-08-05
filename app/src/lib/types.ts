import type { Feature, FeatureCollection, Point } from 'geojson';

export enum Role {
  USER = 'user',
  ADMIN = 'admin'
}

// Define the CSV row interface for the new data structure
export interface PointDataRow {
  EST_ID: string;
  Design: string;
  Pathogen: string;
  Indicator?: string; // e.g., "Prevalence (%)"
  AGE_VAL: string; // e.g., "01_Age_PSAC"
  AGE_LAB: string; // e.g., "Pre-school age children (<5 years)"
  SYNDROME_VAL: string; // e.g., "02_Synd_Diar"
  SYNDROME_LAB: string; // e.g., "Diarrhea (any severity)"
  Heading: string;
  Subheading: string;
  Prevalence: string;
  Age_range: string;
  Location: string;
  Duration: string;
  Source: string;
  Hyperlink: string;
  Footnote: string;
  CASES: string;
  SAMPLES: string;
  PREV: string;
  SE: string;
  SITE_LAT: string;
  SITE_LON: string;
}

// Define the GeoJSON feature properties interface
export interface PointProperties {
  id: string;
  pathogen: string;
  ageGroup: string;
  ageGroupVal: string; // For sorting
  ageGroupLab: string; // Display label
  syndrome: string;
  syndromeVal: string; // For sorting
  syndromeLab: string; // Display label
  design: string;
  location: string;
  heading: string;
  subheading: string;
  footnote: string;
  footnoteDetail?: string;
  prevalence: string;
  ageRange: string;
  duration: string;
  source: string;
  hyperlink: string;
  cases: number;
  samples: number;
  prevalenceValue: number;
  standardError: number;
  layerType?: 'Pathogen' | 'Risk Factor';
  rescaleMin?: number;
  rescaleMax?: number;
}


export type PointFeature = Feature<Point, PointProperties>;
export type PointFeatureCollection = FeatureCollection<Point, PointProperties>;

// Type for feature indices used in filtering
export type FeatureIndex = Map<string, Set<number>>;

// --- Raster Layer Types ---

// Metadata from CSV for raster layers
export interface RasterLayerMetadata {
  type?: 'Pathogen' | 'Risk Factor';
  variableName?: string;
  fileName?: string;
  ageGroup?: string;
  syndrome?: string;
  indicator?: string;
  definition?: string;
  period?: string;
  study?: string;
  source?: string;
  hyperlink?: string;
  popupHeading?: string;
  popupSubheading?: string;
  panelHeading?: string;
  panelSubheading?: string;
  layerDescription?: string;
  footnoteDetail?: string;
  layerManagerCategory?: string;
}

export interface RasterLayer {
  id: string; // Unique identifier for the layer
  name: string; // Display name (e.g., derived from URL or metadata)
  sourceUrl: string; // The original URL provided by the user
  dataUrl?: string; // Canvas data URL for the processed GeoTIFF
  bounds?: [number, number, number, number]; // Optional geographic bounds [west, south, east, north]
  isVisible: boolean; // Whether the layer is rendered on the map (toggled in Active Raster Layers list)
  isActive?: boolean; // Whether the layer is in the Active Raster Layers list (set by Risk Factors section / auto-show)
  opacity: number; // Current opacity state (0 to 1)
  isLoading?: boolean; // Optional flag for loading state (e.g., while fetching metadata)
  error?: string | null; // Optional error message if loading failed
  autoShown?: boolean; // Flag to indicate if layer was automatically shown by filter selection
  metadata?: any; // Store GeoTIFF metadata
  colormap?: string; // Store colormap name (e.g., 'viridis')
  rescale?: [number, number]; // Min/max values for rescaling
  rasterData?: Float32Array; // Raw raster data values
  width?: number; // Raster width in pixels
  height?: number; // Raster height in pixels
  layerMetadata?: RasterLayerMetadata; // Scientific metadata from CSV
}

// Mapping types for filter to raster layer connections
export interface FilterToRasterMapping {
  pathogen: string;
  ageGroup: string;
  syndrome: string;
  layerId: string;
}
