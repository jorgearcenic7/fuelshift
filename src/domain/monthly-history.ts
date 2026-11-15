/** Muestras del día 1 de cada mes de MITECO, independientes de la serie diaria. */
export const MONTHLY_FUELS = [
  "gasoline_95_e5",
  "gasoline_98_e5",
  "diesel_a",
] as const;
export type MonthlyFuel = (typeof MONTHLY_FUELS)[number];

/** Una fecha observada, media por estación y número de estaciones con precio. */
export interface MonthlyObservation {
  date: string;
  price: number;
  count: number;
}

/** Años hacia atrás desde la última muestra publicada; "all" es toda la serie. */
export const MONTHLY_PERIODS = [1, 5, 10, 15, 20, "all"] as const;
export type MonthlyPeriod = (typeof MONTHLY_PERIODS)[number];

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
}

const DAY_MS = 86_400_000;

export function dateToTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Resta años de calendario; el 29 de febrero pasa al 28 si el año no es bisiesto. */
export function subtractYears(date: string, years: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year - years, month - 1, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), month, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export interface MonthlySummary {
  points: MonthlyObservation[];
  first: MonthlyObservation;
  last: MonthlyObservation;
  /** Variación entre la primera y la última muestra del periodo, en %. */
  changePercent: number;
  /** Fecha de inicio pedida; el periodo «Todo» empieza en la primera muestra. */
  requestedStart: string;
  /** El histórico empieza después del inicio pedido (periodo más largo que la serie). */
  startsAfterRequested: boolean;
}

/**
 * Muestras del periodo elegido, que siempre termina en la última muestra
 * publicada. `null` si no hay al menos dos muestras para dibujar una evolución.
 */
export function selectMonthlyPeriod(
  observations: readonly MonthlyObservation[],
  period: MonthlyPeriod,
  referenceEnd?: string,
): MonthlySummary | null {
  if (observations.length < 2) return null;

  const end = referenceEnd ?? observations.at(-1)!.date;
  const requestedStart =
    period === "all" ? observations[0].date : subtractYears(end, period);
  const points = observations.filter(
    (item) => item.date >= requestedStart && item.date <= end,
  );
  if (points.length < 2) return null;

  const first = points[0];
  const last = points.at(-1)!;
  return {
    points,
    first,
    last,
    changePercent: ((last.price - first.price) / first.price) * 100,
    requestedStart,
    startsAfterRequested: observations[0].date > requestedStart,
  };
}

/** Tramos de meses consecutivos; los meses ausentes no se unen con una línea. */
export function splitAtGaps(
  points: readonly MonthlyObservation[],
): MonthlyObservation[][] {
  const segments: MonthlyObservation[][] = [];
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (!previous || monthIndex(point.date) - monthIndex(previous.date) !== 1) {
      segments.push([]);
    }
    segments.at(-1)!.push(point);
  }
  return segments;
}

/** Índice de la muestra más cercana a un instante (búsqueda binaria). */
export function nearestPointIndex(
  points: readonly MonthlyObservation[],
  time: number,
): number {
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (dateToTime(points[middle].date) <= time) low = middle;
    else high = middle;
  }
  return Math.abs(dateToTime(points[high].date) - time) <
    Math.abs(dateToTime(points[low].date) - time)
    ? high
    : low;
}

export interface ChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChartGeometry {
  /** Un trazo SVG por tramo sin huecos. */
  paths: string[];
  x: (date: string) => number;
  y: (price: number) => number;
  /** Instante correspondiente a una coordenada horizontal (para el tooltip). */
  timeAt: (x: number) => number;
  minPrice: number;
  maxPrice: number;
}

/**
 * Escalas y trazos del gráfico. El eje horizontal es temporal, no por índice:
 * así un mes sin datos ocupa su sitio y se ve como un hueco.
 */
export function buildChartGeometry(
  points: readonly MonthlyObservation[],
  box: ChartBox,
): ChartGeometry {
  const prices = points.map((point) => point.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  // Margen para que una serie casi plana no exagere las variaciones.
  const padding = Math.max((maxPrice - minPrice) * 0.08, 0.01);
  const low = minPrice - padding;
  const high = maxPrice + padding;
  const start = dateToTime(points[0].date);
  const span = Math.max(dateToTime(points.at(-1)!.date) - start, DAY_MS);
  const plotWidth = box.width - box.left - box.right;
  const plotHeight = box.height - box.top - box.bottom;

  const x = (date: string) =>
    box.left + ((dateToTime(date) - start) / span) * plotWidth;
  const y = (price: number) =>
    box.top + (1 - (price - low) / (high - low)) * plotHeight;
  const timeAt = (position: number) =>
    start + ((position - box.left) / plotWidth) * span;

  const paths = splitAtGaps(points).map((segment) =>
    segment
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(point.date).toFixed(1)},${y(point.price).toFixed(1)}`,
      )
      .join(""),
  );
  return { paths, x, y, timeAt, minPrice, maxPrice };
}

export function availablePeriods(first: string, last: string): MonthlyPeriod[] {
  return MONTHLY_PERIODS.filter(
    (period) => period === "all" || first <= subtractYears(last, period),
  );
}
