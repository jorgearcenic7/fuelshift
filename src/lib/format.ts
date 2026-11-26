// Formateadores en español reutilizados por toda la interfaz. Se crean una vez
// porque Intl.NumberFormat es caro de construir.
const price = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
const signedPrice = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
  signDisplay: "exceptZero",
});
const signedPercent = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const dateTime = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Madrid",
});
const shortDate = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const monthYear = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const longDate = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeZone: "UTC",
});

/** Tres decimales, como publica MITECO; la unidad la aporta `priceUnit`. */
export const formatPrice = (value: number) => price.format(value);
export const formatSignedPrice = (value: number) => signedPrice.format(value);
export const formatSignedPercent = (value: number) =>
  `${signedPercent.format(value)} %`;
export const formatCount = (value: number) => value.toLocaleString("es-ES");
export const formatRetrievedAt = (value: string) =>
  dateTime.format(new Date(value));
/** Fechas AAAA-MM-DD del histórico, que no llevan hora. */
export const formatShortDate = (value: string) =>
  shortDate.format(new Date(`${value}T00:00:00Z`));
/** «ene 2005»: etiquetas de ejes que abarcan varios años. */
export const formatMonthYear = (value: string) =>
  monthYear.format(new Date(`${value}T00:00:00Z`));
export const formatLongDate = (value: string) =>
  longDate.format(new Date(`${value}T00:00:00Z`));

const euros = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const signedEuros = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
const kilometres = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Importes en euros con dos decimales; el redondeo es solo de presentación. */
export const formatEuros = (value: number) => euros.format(value);
// -0,004 se presentaría como «-0,00 €»: se normaliza a cero.
export const formatSignedEuros = (value: number) =>
  signedEuros.format(Math.abs(value) < 0.005 ? 0 : value);
export const formatKilometres = (meters: number) =>
  `${kilometres.format(meters / 1000)} km`;
/** Minutos redondeados; a partir de una hora, «1 h 05 min». */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
