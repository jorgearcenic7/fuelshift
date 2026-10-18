import type { FuelCode } from "./stations";

export interface HistoryFuel {
  national: { mean: number; min: number; max: number; count: number };
  /** Solo provincias con datos ese día; una ausencia no equivale a cero. */
  provinces: Record<string, { mean: number; count: number }>;
}

/** Una observación real por fecha comunicada por MITECO. */
export interface HistoryEntry {
  date: string;
  retrieved_at: string;
  reported_at: string;
  station_count: number;
  province_count: number;
  fuels: Partial<Record<FuelCode, HistoryFuel>>;
}

export interface PriceHistory {
  source: { attribution: string; catalog: string; license_url: string };
  entries: HistoryEntry[];
}

export const HISTORY_PERIODS = [7, 30, 90] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];
/** Con menos observaciones en el periodo no se dibuja una evolución. */
export const MIN_CHART_OBSERVATIONS = 2;

export interface HistoryPoint {
  date: string;
  /** `null` si ese día no hay observación: nunca se interpola. */
  mean: number | null;
  count: number | null;
}

export interface HistorySeries {
  periodDays: number;
  startDate: string | null;
  endDate: string | null;
  points: HistoryPoint[];
  observedDays: number;
  complete: boolean;
  /**
   * El histórico empieza después del inicio del periodo: la serie arranca en
   * la primera observación en lugar de mostrar días previos a la recogida.
   */
  startsAfterPeriod: boolean;
  chartable: boolean;
  /** Fecha de la primera observación registrada. */
  collectingSince: string | null;
}

/** Suma días de calendario a una fecha AAAA-MM-DD. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Serie diaria de un combustible, nacional o de una provincia, para los
 * `periodDays` días que terminan en la última observación registrada.
 */
export function buildHistorySeries(
  history: PriceHistory,
  fuel: FuelCode,
  {
    periodDays,
    provinceId = null,
  }: { periodDays: number; provinceId?: string | null },
): HistorySeries {
  const collectingSince = history.entries[0]?.date ?? null;
  const endDate = history.entries.at(-1)?.date ?? null;
  if (!endDate) {
    return {
      periodDays,
      startDate: null,
      endDate: null,
      points: [],
      observedDays: 0,
      complete: false,
      startsAfterPeriod: false,
      chartable: false,
      collectingSince,
    };
  }

  const byDate = new Map(history.entries.map((entry) => [entry.date, entry]));
  const startDate = addDays(endDate, -(periodDays - 1));
  // Sin datos anteriores a la primera observación, la serie empieza en ella.
  const startsAfterPeriod = collectingSince! > startDate;
  const firstDate = startsAfterPeriod ? collectingSince! : startDate;
  const visibleDays =
    (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${firstDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  const points = Array.from(
    { length: visibleDays },
    (_, index): HistoryPoint => {
      const date = addDays(firstDate, index);
      const data = byDate.get(date)?.fuels[fuel];
      const value = provinceId ? data?.provinces[provinceId] : data?.national;
      return { date, mean: value?.mean ?? null, count: value?.count ?? null };
    },
  );
  const observedDays = points.filter((point) => point.mean !== null).length;

  return {
    periodDays,
    startDate,
    endDate,
    points,
    observedDays,
    complete: observedDays === periodDays,
    startsAfterPeriod,
    chartable: observedDays >= MIN_CHART_OBSERVATIONS,
    collectingSince,
  };
}
