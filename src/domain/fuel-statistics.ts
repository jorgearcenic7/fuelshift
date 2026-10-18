import { getStationPrice, type FuelCode, type Station } from "./stations";

/**
 * Por debajo de este número de estaciones, una provincia se muestra con aviso
 * de muestra reducida y no compite por los puestos de más barata o más cara.
 */
export const MIN_PROVINCE_SAMPLE = 10;

export interface PriceSummary {
  mean: number;
  min: number;
  max: number;
  /** Estaciones con precio válido incluidas en el cálculo. */
  count: number;
}

export interface PriceDifference {
  absolute: number;
  /** `null` si la referencia es cero. */
  percent: number | null;
}

export interface ProvinceStatistics {
  id: string;
  name: string;
  /** `null` si ninguna estación de la provincia comunica este combustible. */
  summary: PriceSummary | null;
  sufficient: boolean;
  differenceFromNational: PriceDifference | null;
}

export interface FuelStatistics {
  fuel: FuelCode;
  national: PriceSummary | null;
  provinces: ProvinceStatistics[];
  /** Entre provincias con muestra suficiente. */
  cheapest: ProvinceStatistics | null;
  priciest: ProvinceStatistics | null;
  /** Diferencia de la más cara respecto a la más barata. */
  spread: PriceDifference | null;
  /** Estaciones cargadas sin un precio válido de este combustible. */
  excludedStations: number;
}

export interface StatisticsProvince {
  id: string;
  name: string;
  stations: readonly Station[];
}

export type ProvinceSort = "price-asc" | "price-desc" | "name" | "stations";

export function summarizePrices(
  prices: readonly number[],
): PriceSummary | null {
  if (prices.length === 0) return null;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const price of prices) {
    sum += price;
    min = Math.min(min, price);
    max = Math.max(max, price);
  }
  return { mean: sum / prices.length, min, max, count: prices.length };
}

export function percentDifference(
  value: number,
  reference: number,
): number | null {
  return reference === 0 ? null : ((value - reference) / reference) * 100;
}

function difference(value: number, reference: number): PriceDifference {
  return {
    absolute: value - reference,
    percent: percentDifference(value, reference),
  };
}

function validPrices(stations: readonly Station[], fuel: FuelCode): number[] {
  return stations.flatMap((station) => {
    const price = getStationPrice(station, fuel);
    return price !== null && price > 0 ? [price] : [];
  });
}

/**
 * Estadísticas de un único combustible. La media nacional se calcula con todas
 * las estaciones válidas, no promediando las medias provinciales.
 */
export function computeFuelStatistics(
  provinces: readonly StatisticsProvince[],
  fuel: FuelCode,
): FuelStatistics {
  const nationalPrices: number[] = [];
  let excludedStations = 0;
  const provinceSummaries = provinces.map(({ id, name, stations }) => {
    const prices = validPrices(stations, fuel);
    nationalPrices.push(...prices);
    excludedStations += stations.length - prices.length;
    return { id, name, summary: summarizePrices(prices) };
  });
  const national = summarizePrices(nationalPrices);

  const provinceStatistics = provinceSummaries.map(
    ({ id, name, summary }): ProvinceStatistics => ({
      id,
      name,
      summary,
      sufficient: summary !== null && summary.count >= MIN_PROVINCE_SAMPLE,
      differenceFromNational:
        summary && national ? difference(summary.mean, national.mean) : null,
    }),
  );
  const ranked = sortProvinces(
    provinceStatistics.filter((item) => item.sufficient),
    "price-asc",
  );
  const cheapest = ranked[0] ?? null;
  const priciest = ranked.at(-1) ?? null;

  return {
    fuel,
    national,
    provinces: provinceStatistics,
    cheapest,
    priciest,
    spread:
      cheapest?.summary && priciest?.summary
        ? difference(priciest.summary.mean, cheapest.summary.mean)
        : null,
    excludedStations,
  };
}

/** Devuelve una copia ordenada; las provincias sin datos quedan siempre al final. */
export function sortProvinces(
  provinces: readonly ProvinceStatistics[],
  sort: ProvinceSort,
): ProvinceStatistics[] {
  const byName = (left: ProvinceStatistics, right: ProvinceStatistics) =>
    left.name.localeCompare(right.name, "es");
  return [...provinces].sort((left, right) => {
    if (!left.summary || !right.summary) {
      return (
        Number(!left.summary) - Number(!right.summary) || byName(left, right)
      );
    }
    switch (sort) {
      case "price-asc":
        return left.summary.mean - right.summary.mean || byName(left, right);
      case "price-desc":
        return right.summary.mean - left.summary.mean || byName(left, right);
      case "stations":
        return right.summary.count - left.summary.count || byName(left, right);
      case "name":
        return byName(left, right);
    }
  });
}
