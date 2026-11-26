import { chargeMode } from "./costs";

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
  // Margen de 600 créditos sobre la cuota gratuita. No es una garantía: el
  // recargo por distancia no tiene cota previa y por eso matriz y ruta exigen
  // la garantía del proveedor (costs.ts). Sin ella solo se reservan costes fijos.
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

/**
 * Presupuesto de la activación provisional (ADR 0007): 300 créditos en
 * cualquier ventana de 24 h, un 10 % de la cuota gratuita. Mantiene el reparto
 * proporcional de los límites iniciales. No es una cota del coste real: el
 * recargo por distancia no tiene límite previo, así que la liquidación de la
 * última operación admitida puede superar 300; en cuanto se liquida, corta las
 * siguientes. Solo cambia el presupuesto; el resto de protecciones son las
 * mismas.
 */
export const PROVISIONAL_LIMITS: RoutingLimits = {
  ...DEFAULT_LIMITS,
  providerCredits: { geoapify: 300 },
  endpointCredits: { matrix: 220, routing: 40, autocomplete: 40 },
};

/**
 * El presupuesto inicial solo se aplica con la confirmación escrita del
 * proveedor. En modo provisional, y también cuando matriz y ruta están
 * bloqueadas, se usa el reducido: ante la duda, el menor.
 */
export function limitsFor(guarantee: string | undefined): RoutingLimits {
  return chargeMode(guarantee) === "confirmed"
    ? DEFAULT_LIMITS
    : PROVISIONAL_LIMITS;
}
