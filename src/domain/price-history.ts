/**
 * Una observación real de un ámbito (España o una provincia) y combustible:
 * la media del día comunicado por MITECO y las estaciones que la forman.
 */
export interface HistoryObservation {
  date: string;
  mean: number;
  count: number;
}

/** Días que abarca el histórico registrado, comunes a todos los ámbitos. */
export interface HistoryTimeline {
  /** Primera observación registrada. */
  first: string;
  /** Última observación registrada. */
  last: string;
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
 * Serie diaria de un ámbito para los `periodDays` días que terminan en la
 * última observación registrada del histórico.
 */
export function buildHistorySeries(
  observations: readonly HistoryObservation[],
  timeline: HistoryTimeline | null,
  periodDays: number,
): HistorySeries {
  if (!timeline) {
    return {
      periodDays,
      startDate: null,
      endDate: null,
      points: [],
      observedDays: 0,
      complete: false,
      startsAfterPeriod: false,
      chartable: false,
      collectingSince: null,
    };
  }

  const { first: collectingSince, last: endDate } = timeline;
  const byDate = new Map(observations.map((item) => [item.date, item]));
  const startDate = addDays(endDate, -(periodDays - 1));
  // Sin datos anteriores a la primera observación, la serie empieza en ella.
  const startsAfterPeriod = collectingSince > startDate;
  const firstDate = startsAfterPeriod ? collectingSince : startDate;
  const visibleDays =
    (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${firstDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  const points = Array.from(
    { length: visibleDays },
    (_, index): HistoryPoint => {
      const date = addDays(firstDate, index);
      const value = byDate.get(date);
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
