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
export const formatLongDate = (value: string) =>
  longDate.format(new Date(`${value}T00:00:00Z`));
