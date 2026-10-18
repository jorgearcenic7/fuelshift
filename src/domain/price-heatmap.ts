import { getStationPrice, type FuelCode, type Station } from "./stations";

/**
 * Superficie continua de precios: en cada píxel, media de los precios cercanos
 * ponderada con un núcleo gaussiano. Al ser una media, una zona con más
 * estaciones no se ve más cara ni más barata; solo gana cobertura.
 */
export const HEATMAP_SIGMA_KM = 8;
const CUTOFF_KM = 3 * HEATMAP_SIGMA_KM;
/** Unos 5 km por píxel; MapLibre interpola entre píxeles al dibujar. */
export const HEATMAP_STEP_DEGREES = 0.05;
/** Peso acumulado mínimo para considerar que un píxel tiene datos. */
export const MIN_COVERAGE = 0.1;
/** Solo los píxeles con cobertura suficiente fijan la escala de color. */
const SCALE_COVERAGE = 0.5;
/**
 * Percentiles de la superficie que se usan como extremos de la escala. Con el
 * 5 %, territorios pequeños y mucho más baratos (Canarias, Ceuta y Melilla)
 * saturan en verde sin desplazar la escala del resto de España.
 */
export const SCALE_PERCENTILES = { low: 0.05, high: 0.95 } as const;

const KM_PER_DEGREE_LATITUDE = 110.57;
const KM_PER_DEGREE_LONGITUDE_AT_EQUATOR = 111.32;

export interface HeatmapRegion {
  id: string;
  west: number;
  east: number;
  south: number;
  north: number;
}

export const HEATMAP_REGIONS: readonly HeatmapRegion[] = [
  // Península, Baleares, Ceuta y Melilla.
  { id: "peninsula", west: -9.6, east: 4.6, south: 35, north: 44 },
  { id: "canarias", west: -18.3, east: -13.3, south: 27.5, north: 29.5 },
];

export interface HeatmapRaster {
  region: HeatmapRegion;
  width: number;
  height: number;
  /** Latitud del centro de cada fila, de norte a sur y equiespaciada en Mercator. */
  rowLatitudes: number[];
  /** Precio suavizado por píxel (fila a fila); `NaN` si no hay datos cerca. */
  values: Float64Array;
  /** Peso acumulado por píxel: indica cuánta información respalda el valor. */
  coverage: Float64Array;
}

export interface PriceScale {
  low: number;
  high: number;
}

export interface PriceHeatmap {
  fuel: FuelCode;
  stationCount: number;
  /** Precios reales de la estación más barata y la más cara del conjunto. */
  cheapest: number | null;
  priciest: number | null;
  scale: PriceScale | null;
  rasters: HeatmapRaster[];
}

export function mercatorY(latitude: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
}

export function latitudeFromMercatorY(y: number): number {
  return (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;
}

function createRaster(region: HeatmapRegion): HeatmapRaster {
  const width = Math.round((region.east - region.west) / HEATMAP_STEP_DEGREES);
  const height = Math.round(
    (region.north - region.south) / HEATMAP_STEP_DEGREES,
  );
  // Filas equiespaciadas en Mercator para que la imagen encaje con el mapa.
  const top = mercatorY(region.north);
  const bottom = mercatorY(region.south);
  const rowLatitudes = Array.from({ length: height }, (_, row) =>
    latitudeFromMercatorY(top - ((row + 0.5) * (top - bottom)) / height),
  );
  return {
    region,
    width,
    height,
    rowLatitudes,
    values: new Float64Array(width * height),
    coverage: new Float64Array(width * height),
  };
}

function contains(region: HeatmapRegion, latitude: number, longitude: number) {
  return (
    latitude >= region.south &&
    latitude <= region.north &&
    longitude >= region.west &&
    longitude <= region.east
  );
}

/** Suma la contribución gaussiana de una estación a los píxeles cercanos. */
function splat(
  raster: HeatmapRaster,
  latitude: number,
  longitude: number,
  price: number,
) {
  const { region, width, rowLatitudes, values, coverage } = raster;
  const kmPerLongitude =
    KM_PER_DEGREE_LONGITUDE_AT_EQUATOR * Math.cos((latitude * Math.PI) / 180);
  const latitudeReach = CUTOFF_KM / KM_PER_DEGREE_LATITUDE;
  const firstColumn = Math.max(
    0,
    Math.floor(
      (longitude - CUTOFF_KM / kmPerLongitude - region.west) /
        HEATMAP_STEP_DEGREES,
    ),
  );
  const lastColumn = Math.min(
    width - 1,
    Math.ceil(
      (longitude + CUTOFF_KM / kmPerLongitude - region.west) /
        HEATMAP_STEP_DEGREES,
    ),
  );
  const twoSigmaSquared = 2 * HEATMAP_SIGMA_KM * HEATMAP_SIGMA_KM;
  // Las filas son equiespaciadas en Mercator: se localizan sin recorrerlas todas.
  const top = mercatorY(region.north);
  const rowHeight = (top - mercatorY(region.south)) / rowLatitudes.length;
  const rowOf = (lat: number) => (top - mercatorY(lat)) / rowHeight - 0.5;
  const firstRow = Math.max(0, Math.floor(rowOf(latitude + latitudeReach)));
  const lastRow = Math.min(
    rowLatitudes.length - 1,
    Math.ceil(rowOf(latitude - latitudeReach)),
  );

  for (let row = firstRow; row <= lastRow; row++) {
    const rowLatitude = rowLatitudes[row];
    const dy = (rowLatitude - latitude) * KM_PER_DEGREE_LATITUDE;
    for (let column = firstColumn; column <= lastColumn; column++) {
      const columnLongitude =
        region.west + (column + 0.5) * HEATMAP_STEP_DEGREES;
      const dx = (columnLongitude - longitude) * kmPerLongitude;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > CUTOFF_KM * CUTOFF_KM) continue;
      const weight = Math.exp(-distanceSquared / twoSigmaSquared);
      const index = row * width + column;
      values[index] += weight * price;
      coverage[index] += weight;
    }
  }
}

function percentile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

function percentileScale(sorted: readonly number[]): PriceScale | null {
  if (sorted.length === 0) return null;
  return {
    low: percentile(sorted, SCALE_PERCENTILES.low),
    high: percentile(sorted, SCALE_PERCENTILES.high),
  };
}

/**
 * Construye la superficie de un único combustible a partir de las estaciones
 * recibidas. No depende de la zona visible: mover el mapa no la altera.
 * Con `fixedScale` reutiliza una escala ya calculada en lugar de derivarla de
 * esta superficie.
 */
export function buildPriceHeatmap(
  stations: readonly Station[],
  fuel: FuelCode,
  fixedScale?: PriceScale | null,
): PriceHeatmap {
  const rasters = HEATMAP_REGIONS.map(createRaster);
  let stationCount = 0;
  let cheapest = Infinity;
  let priciest = -Infinity;

  for (const station of stations) {
    const price = getStationPrice(station, fuel);
    if (price === null || price <= 0) continue;
    const { latitude, longitude } = station.location;
    const raster = rasters.find(({ region }) =>
      contains(region, latitude, longitude),
    );
    if (!raster) continue;
    splat(raster, latitude, longitude, price);
    stationCount += 1;
    cheapest = Math.min(cheapest, price);
    priciest = Math.max(priciest, price);
  }

  const scaleValues: number[] = [];
  for (const raster of rasters) {
    for (let index = 0; index < raster.values.length; index++) {
      const weight = raster.coverage[index];
      if (weight < MIN_COVERAGE) {
        raster.values[index] = Number.NaN;
        continue;
      }
      raster.values[index] /= weight;
      if (fixedScale === undefined && weight >= SCALE_COVERAGE) {
        scaleValues.push(raster.values[index]);
      }
    }
  }
  scaleValues.sort((left, right) => left - right);

  return {
    fuel,
    stationCount,
    cheapest: stationCount > 0 ? cheapest : null,
    priciest: stationCount > 0 ? priciest : null,
    scale: fixedScale !== undefined ? fixedScale : percentileScale(scaleValues),
    rasters,
  };
}

/**
 * Superficie de las estaciones filtradas coloreada con la escala nacional, para
 * que un mismo precio conserve su color al cambiar búsqueda, marca o rango.
 * Sin filtros activos, las estaciones coinciden con el conjunto nacional y se
 * reutiliza ese cálculo en lugar de repetirlo.
 */
export function buildFilteredHeatmap(
  national: PriceHeatmap,
  filteredStations: readonly Station[],
  filtersActive: boolean,
): PriceHeatmap {
  return filtersActive
    ? buildPriceHeatmap(filteredStations, national.fuel, national.scale)
    : national;
}

/** Posición en la escala: 0 es lo más barato y 1 lo más caro; satura fuera. */
export function scalePosition(price: number, scale: PriceScale): number {
  if (scale.high - scale.low < 1e-9) return 0.5;
  return Math.min(
    1,
    Math.max(0, (price - scale.low) / (scale.high - scale.low)),
  );
}

/** Valor del píxel más cercano a unas coordenadas, o `null` si no hay datos. */
export function sampleHeatmap(
  heatmap: PriceHeatmap,
  latitude: number,
  longitude: number,
): { value: number; coverage: number } | null {
  const raster = heatmap.rasters.find(({ region }) =>
    contains(region, latitude, longitude),
  );
  if (!raster) return null;
  const column = Math.min(
    raster.width - 1,
    Math.floor((longitude - raster.region.west) / HEATMAP_STEP_DEGREES),
  );
  let row = 0;
  for (let index = 1; index < raster.rowLatitudes.length; index++) {
    if (
      Math.abs(raster.rowLatitudes[index] - latitude) <
      Math.abs(raster.rowLatitudes[row] - latitude)
    ) {
      row = index;
    }
  }
  const index = row * raster.width + column;
  const value = raster.values[index];
  return Number.isNaN(value)
    ? null
    : { value, coverage: raster.coverage[index] };
}
