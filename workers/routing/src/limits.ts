/**
 * Límites iniciales y revisables del intermediario de rutas. Cambiarlos exige
 * revisar que la suma de presupuestos por endpoint no supere el global y que
 * este quede por debajo de la cuota gratuita del proveedor (3000 créditos/día
 * en Geoapify, consultado el 2026-11-26).
 */
export type BillableProvider = "geoapify";
export type Endpoint = "matrix" | "routing" | "autocomplete";
export type Action =
  | "nearby"
  | "trip-route"
  | "trip-legs"
  | "selected-route"
  | "autocomplete"
  | "retry";

export const ENDPOINTS: readonly Endpoint[] = [
  "matrix",
  "routing",
  "autocomplete",
];
export const ACTIONS: readonly Action[] = [
  "nearby",
  "trip-route",
  "trip-legs",
  "selected-route",
  "autocomplete",
  "retry",
];

export interface RoutingLimits {
  /**
   * Ventana móvil de 24 h. Geoapify no publica a qué hora reinicia su cuota
   * diaria; si no se gastan más de N créditos en ninguna ventana de 24 h,
   * tampoco se gastan en ningún día natural, sea cual sea su zona horaria.
   */
  windowMs: number;
  /** Conservación de registros: más que la ventana, nunca menos. */
  retentionMs: number;
  providerCredits: Record<BillableProvider, number>;
  endpointCredits: Record<Endpoint, number>;
  /** Coste máximo de una sola reserva; protege frente a errores de cálculo. */
  maxCreditsPerReservation: number;
  visitor: {
    searchesPerMinute: number;
    searchesPerDay: number;
    autocompletePerMinute: number;
    autocompletePerDay: number;
  };
  global: {
    searchesPerMinute: number;
    autocompletePerMinute: number;
    /** Llamadas al proveedor en curso a la vez. */
    maxInFlight: number;
    requestsPerSecond: number;
  };
  duplicateWindowMs: number;
  cooldownAfterQuotaMs: number;
  cooldownAfterAuthMs: number;
  providerTimeoutMs: number;
}

export const DEFAULT_LIMITS: RoutingLimits = {
  windowMs: 24 * 60 * 60 * 1000,
  retentionMs: 48 * 60 * 60 * 1000,
  // Margen de 600 créditos sobre la cuota gratuita, por disponibilidad: el
  // recargo por distancia no tiene cota previa y la liquidación de la última
  // operación admitida puede superar el presupuesto. Sin la garantía escrita
  // del proveedor solo se reservan costes fijos (costs.ts).
  providerCredits: { geoapify: 2400 },
  endpointCredits: { matrix: 1800, routing: 300, autocomplete: 300 },
  maxCreditsPerReservation: 120,
  visitor: {
    searchesPerMinute: 3,
    searchesPerDay: 10,
    autocompletePerMinute: 20,
    autocompletePerDay: 100,
  },
  global: {
    searchesPerMinute: 30,
    autocompletePerMinute: 60,
    maxInFlight: 4,
    requestsPerSecond: 5,
  },
  duplicateWindowMs: 30_000,
  cooldownAfterQuotaMs: 15 * 60_000,
  cooldownAfterAuthMs: 60 * 60_000,
  providerTimeoutMs: 8000,
};
