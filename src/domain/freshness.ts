/** Antigüedad a partir de la cual se avisa de que los datos pueden no ser actuales. */
export const STALE_AFTER_HOURS = 48;

/** Compara la fecha de descarga con el instante de la visita, no con el del build. */
export function isStale(retrievedAt: string, now = Date.now()): boolean {
  const age = now - new Date(retrievedAt).getTime();
  return Number.isFinite(age) && age > STALE_AFTER_HOURS * 60 * 60 * 1000;
}
