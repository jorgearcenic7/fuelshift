// Frases con datos que se calculan a partir de los precios cargados: coste de
// llenar un depósito y posición frente a la media nacional. Son plantillas: si
// falta un dato, se omite su parte de la frase en lugar de inventarla.

import type { PriceUnit } from "./fuel-units";

/** Litros de referencia para «llenar el depósito». */
export const FILL_LITRES = 50;

/** Espacio duro entre la cifra y su unidad, para que no se separen. */
export const NBSP = " ";

const euroAmount = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const unitPrice = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const longDate = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeZone: "UTC",
});

/** «64,95 €» con espacio duro. */
export function formatEuros(value: number): string {
  return `${euroAmount.format(value)}${NBSP}€`;
}

/** «1,299 €/L» con espacio duro. */
export function formatUnitPrice(value: number, unit: PriceUnit): string {
  return `${unitPrice.format(value)}${NBSP}${unit}`;
}

/** Redondeo a milésimas, la precisión con la que MITECO publica. */
function roundPrice(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const isPrice = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Frase de la ficha de una estación: diferencia con la media nacional y coste
 * de llenar 50 L. Las cifras se redondean antes de restar, para que las que se
 * leen cuadren entre sí. Devuelve `null` si no hay nada que decir.
 */
export function describeStationPrice({
  price,
  unit,
  nationalMean,
}: {
  price: number;
  unit: PriceUnit;
  /** `null` si la media no es fiable (carga incompleta) o no existe. */
  nationalMean: number | null;
}): string | null {
  if (!isPrice(price)) return null;
  const parts: string[] = [];
  const mean = isPrice(nationalMean) ? roundPrice(nationalMean) : null;
  const difference = mean === null ? null : roundPrice(mean - price);

  if (mean !== null && difference !== null) {
    const meanText = formatUnitPrice(mean, unit);
    if (difference === 0) {
      parts.push(`Está en la media nacional (${meanText}).`);
    } else {
      const direction = difference > 0 ? "por debajo" : "por encima";
      parts.push(
        `${formatUnitPrice(Math.abs(difference), unit)} ${direction} de la media nacional (${meanText}).`,
      );
    }
  }

  // Llenar un depósito solo tiene sentido con precios por litro.
  if (unit === "€/L") {
    let fill = `Llenar ${FILL_LITRES}${NBSP}L cuesta ${formatEuros(roundPrice(price) * FILL_LITRES)}`;
    if (difference !== null && difference !== 0) {
      const saving = formatEuros(Math.abs(difference) * FILL_LITRES);
      fill += `, ${saving} ${difference > 0 ? "menos" : "más"} que a precio medio`;
    }
    parts.push(`${fill}.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/** Fecha AAAA-MM-DD en la zona de Madrid, para comparar con la de los datos. */
export function madridDate(date: Date): string {
  // en-CA produce AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** «15/11/2026 17:07:37» (formato de MITECO) → «2026-11-15»; `null` si no encaja. */
export function mitecoDate(raw: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/**
 * Titular de Estadísticas: «Llenar 50 litros de Gasolina 95 E5 cuesta hoy
 * 80,70 € de media: entre 63,85 € y 107,50 €.» «Hoy» solo si los datos son de
 * hoy; si no, se dice la fecha. Las partes sin dato se omiten.
 */
export function describeFillHeadline({
  fuelLabel,
  mean,
  min,
  max,
  dataDate,
  today,
}: {
  fuelLabel: string;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** AAAA-MM-DD de los datos; `null` si se desconoce. */
  dataDate: string | null;
  /** AAAA-MM-DD de hoy en Madrid; `null` mientras no se conoce (HTML estático). */
  today: string | null;
}): string | null {
  const average = isPrice(mean)
    ? formatEuros(roundPrice(mean) * FILL_LITRES)
    : null;
  const low = isPrice(min) ? formatEuros(roundPrice(min) * FILL_LITRES) : null;
  const high = isPrice(max) ? formatEuros(roundPrice(max) * FILL_LITRES) : null;
  if (!average && !low && !high) return null;

  let range: string | null = null;
  if (low && high) range = `entre ${low} y ${high}`;
  else if (low) range = `desde ${low}`;
  else if (high) range = `hasta ${high}`;

  const isToday = dataDate !== null && today !== null && dataDate === today;
  const when = isToday
    ? "cuesta hoy"
    : dataDate
      ? `costaba el ${longDate.format(new Date(`${dataDate}T00:00:00Z`))}`
      : "cuesta";

  const subject = `Llenar ${FILL_LITRES}${NBSP}litros de ${fuelLabel} ${when}`;
  if (average) {
    return `${subject} ${average} de media${range ? `: ${range}` : ""}.`;
  }
  return `${subject} ${range}.`;
}
