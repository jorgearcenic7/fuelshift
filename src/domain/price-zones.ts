import {
  getStationPrice,
  type FuelCode,
  type MapBounds,
  type Station,
} from "./stations";

/**
 * Celdas fijas de 0,2° de latitud × 0,25° de longitud: unos 22 km de lado en la
 * península. Se expresan como divisiones por grado para evitar errores de coma
 * flotante al asignar cada estación a su celda.
 */
export const ZONE_CELLS_PER_DEGREE = { latitude: 5, longitude: 4 } as const;
/** Por debajo de este número de estaciones no se calcula un precio representativo. */
export const MIN_ZONE_STATIONS = 3;

/** 0: tercio más barato · 1: intermedio · 2: tercio más caro. */
export type PriceClass = 0 | 1 | 2;

export interface PriceZone {
  id: string;
  /** Municipio con más estaciones de la celda; solo orienta, no delimita. */
  place: string;
  bounds: MapBounds;
  /** Estaciones con precio válido del combustible en la celda. */
  stationCount: number;
  /** `null` cuando la muestra no alcanza `MIN_ZONE_STATIONS`. */
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceClass: PriceClass | null;
}

/** Tercios de las medianas de todas las zonas suficientes del conjunto cargado. */
export interface PriceScale {
  min: number;
  lowerBreak: number;
  upperBreak: number;
  max: number;
  zoneCount: number;
}

export interface PriceZoneMap {
  fuel: FuelCode;
  zones: PriceZone[];
  scale: PriceScale | null;
  /** Estaciones con precio válido utilizadas en el cálculo. */
  stationCount: number;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Cuantil con interpolación lineal sobre valores ya ordenados. */
function quantile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (position - lower) * (sorted[upper] - sorted[lower]);
}

function mostFrequent(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(
    ([leftName, left], [rightName, right]) =>
      right - left || leftName.localeCompare(rightName, "es"),
  )[0][0];
}

/** Intervalos semiabiertos: ≤ `lowerBreak`, hasta `upperBreak` y por encima. */
export function classifyPrice(price: number, scale: PriceScale): PriceClass {
  if (scale.min === scale.max) return 1;
  if (price <= scale.lowerBreak) return 0;
  return price <= scale.upperBreak ? 1 : 2;
}

/**
 * Agrega en celdas fijas las estaciones con precio válido de un único
 * combustible. El resultado no depende de la zona visible del mapa.
 */
export function buildPriceZones(
  stations: readonly Station[],
  fuel: FuelCode,
): PriceZoneMap {
  const cells = new Map<
    string,
    { row: number; column: number; prices: number[]; places: string[] }
  >();
  let stationCount = 0;

  for (const station of stations) {
    const price = getStationPrice(station, fuel);
    if (price === null || price <= 0) continue;
    const row = Math.floor(
      station.location.latitude * ZONE_CELLS_PER_DEGREE.latitude,
    );
    const column = Math.floor(
      station.location.longitude * ZONE_CELLS_PER_DEGREE.longitude,
    );
    const id = `${row}:${column}`;
    const cell = cells.get(id) ?? { row, column, prices: [], places: [] };
    cell.prices.push(price);
    cell.places.push(station.municipality);
    cells.set(id, cell);
    stationCount += 1;
  }

  const zones = [...cells.entries()]
    .sort(
      ([, left], [, right]) =>
        left.row - right.row || left.column - right.column,
    )
    .map(([id, { row, column, prices, places }]): PriceZone => {
      const sufficient = prices.length >= MIN_ZONE_STATIONS;
      return {
        id,
        place: mostFrequent(places),
        bounds: {
          south: row / ZONE_CELLS_PER_DEGREE.latitude,
          north: (row + 1) / ZONE_CELLS_PER_DEGREE.latitude,
          west: column / ZONE_CELLS_PER_DEGREE.longitude,
          east: (column + 1) / ZONE_CELLS_PER_DEGREE.longitude,
        },
        stationCount: prices.length,
        medianPrice: sufficient ? median(prices) : null,
        minPrice: sufficient ? Math.min(...prices) : null,
        maxPrice: sufficient ? Math.max(...prices) : null,
        priceClass: null,
      };
    });

  const medians = zones
    .map((zone) => zone.medianPrice)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const scale: PriceScale | null =
    medians.length === 0
      ? null
      : {
          min: medians[0],
          lowerBreak: quantile(medians, 1 / 3),
          upperBreak: quantile(medians, 2 / 3),
          max: medians[medians.length - 1],
          zoneCount: medians.length,
        };

  if (scale) {
    for (const zone of zones) {
      if (zone.medianPrice !== null) {
        zone.priceClass = classifyPrice(zone.medianPrice, scale);
      }
    }
  }
  return { fuel, zones, scale, stationCount };
}
