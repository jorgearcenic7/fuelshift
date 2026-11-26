import type { RoadLeg } from "@/domain/refuel/road-routing";

/**
 * Coste en créditos de Geoapify, consultado el 2026-11-26 en
 * https://www.geoapify.com/pricing-details/,
 * https://apidocs.geoapify.com/docs/route-matrix/ y
 * https://apidocs.geoapify.com/docs/routing/:
 *
 * - Matriz: max(N, M) × min(N, M, 10); +1 por cada opción `avoid`
 *   (green_zones, tolls, ferries, highways), +1 por país excluido,
 *   +ceil(lugares evitados / 20), +1 por polígono evitado; y
 *   +floor(distancia / 500 km) por **cada** distancia devuelta.
 * - Ruta: puntos − 1; +1 por opción `avoid`, +1 por polígono o lote de
 *   lugares evitados, +1 por par con `route_details`, +1 por par con
 *   `elevation`; y +floor(distancia / 500 km).
 * - Autocompletado: 1 crédito.
 * - Reintentos: cada intento es una petición nueva y se reserva aparte.
 * - Peticiones fallidas o sin respuesta: Geoapify no publica si las cobra; se
 *   contabilizan como cobradas.
 *
 * La parte fija se conoce antes de llamar. El recargo por distancia no: depende
 * de la ruta que calcule el proveedor (rodeos, ferris, cortes de carretera) y
 * ninguna estimación geográfica lo acota. Por eso matriz y ruta no tienen cota
 * máxima verificable y solo se permiten con una garantía efectiva del
 * proveedor de que superar la cuota no genera cargos o con la activación
 * provisional explícita del propietario (ver `chargePolicy`).
 */
const SURCHARGE_METERS = 500_000;

/** Opciones con recargo. El adaptador actual no envía ninguna. */
export interface GeoapifyModifiers {
  avoidToggles: number;
  excludedCountries: number;
  avoidLocations: number;
  avoidPolygons: number;
  routeDetails: boolean;
  elevation: boolean;
}

export const NO_MODIFIERS: Readonly<GeoapifyModifiers> = {
  avoidToggles: 0,
  excludedCountries: 0,
  avoidLocations: 0,
  avoidPolygons: 0,
  routeDetails: false,
  elevation: false,
};

/**
 * Cota previa a la petición:
 * - `fixed`: el coste es exactamente `credits`, sea cual sea la respuesta;
 * - `unbounded`: `minimumCredits` es seguro, pero el total puede ser mayor
 *   sin límite conocido antes de llamar.
 */
export type CostBound =
  | { kind: "fixed"; credits: number }
  | { kind: "unbounded"; minimumCredits: number };

const distanceSurcharge = (meters: number) =>
  Math.floor(meters / SURCHARGE_METERS);

export function matrixBaseCredits(sources: number, targets: number): number {
  return Math.max(sources, targets) * Math.min(sources, targets, 10);
}

function matrixModifierCredits(modifiers: GeoapifyModifiers): number {
  return (
    modifiers.avoidToggles +
    modifiers.excludedCountries +
    Math.ceil(modifiers.avoidLocations / 20) +
    modifiers.avoidPolygons
  );
}

function routeModifierCredits(
  modifiers: GeoapifyModifiers,
  pairs: number,
): number {
  return (
    modifiers.avoidToggles +
    modifiers.avoidPolygons +
    (modifiers.avoidLocations > 0 ? 1 : 0) +
    (modifiers.routeDetails ? pairs : 0) +
    (modifiers.elevation ? pairs : 0)
  );
}

export function matrixCost(
  sources: number,
  targets: number,
  modifiers: GeoapifyModifiers = NO_MODIFIERS,
): CostBound {
  return {
    kind: "unbounded",
    minimumCredits:
      matrixBaseCredits(sources, targets) + matrixModifierCredits(modifiers),
  };
}

export function matrixActualCredits(
  cells: (RoadLeg | null)[][],
  modifiers: GeoapifyModifiers = NO_MODIFIERS,
): number {
  const rows = cells.length;
  const columns = cells[0]?.length ?? 0;
  if (rows === 0 || columns === 0) return 0;
  const surcharge = cells
    .flat()
    .reduce(
      (total, leg) => total + (leg ? distanceSurcharge(leg.distanceMeters) : 0),
      0,
    );
  return (
    matrixBaseCredits(rows, columns) +
    matrixModifierCredits(modifiers) +
    surcharge
  );
}

export function routeCost(
  waypoints: number,
  modifiers: GeoapifyModifiers = NO_MODIFIERS,
): CostBound {
  const pairs = waypoints - 1;
  return {
    kind: "unbounded",
    minimumCredits: pairs + routeModifierCredits(modifiers, pairs),
  };
}

export function routeActualCredits(
  leg: RoadLeg,
  waypoints: number,
  modifiers: GeoapifyModifiers = NO_MODIFIERS,
): number {
  const pairs = waypoints - 1;
  return (
    pairs +
    routeModifierCredits(modifiers, pairs) +
    distanceSurcharge(leg.distanceMeters)
  );
}

export const AUTOCOMPLETE_CREDITS = 1;

export function autocompleteCost(): CostBound {
  return { kind: "fixed", credits: AUTOCOMPLETE_CREDITS };
}

/**
 * Valor exacto que el propietario asigna a `GEOAPIFY_CHARGE_GUARANTEE` solo
 * tras obtener de Geoapify, por escrito, que la cuenta no puede generar cargos
 * aunque se supere la cuota. No basta con que la cuenta no tenga tarjeta: los
 * términos permiten cobrar excesos sin excluir Free, aunque la guía oficial
 * dice que nunca se cobra. Se mantiene el bloqueo hasta aclarar la discrepancia.
 */
export const CHARGE_GUARANTEE_CONFIRMED = "confirmada-por-escrito";

/**
 * Activación provisional decidida por el propietario mientras Geoapify no
 * responde (ADR 0007). No equivale a una confirmación escrita: acepta el
 * riesgo económico residual y solo funciona con el presupuesto reducido de
 * `PROVISIONAL_LIMITS` (limits.ts).
 */
export const CHARGE_GUARANTEE_PROVISIONAL = "provisional-sin-confirmacion";

/**
 * Modo económico según el valor exacto de `GEOAPIFY_CHARGE_GUARANTEE`.
 * Cualquier otro valor, incluido uno vacío o mal escrito, bloquea.
 */
export type ChargeMode = "blocked" | "provisional" | "confirmed";

export function chargeMode(guarantee: string | undefined): ChargeMode {
  if (guarantee === CHARGE_GUARANTEE_CONFIRMED) return "confirmed";
  if (guarantee === CHARGE_GUARANTEE_PROVISIONAL) return "provisional";
  return "blocked";
}

export type ChargeDecision =
  | { allowed: true; reserveCredits: number }
  | { allowed: false; reason: "cost-unbounded" };

/**
 * Política económica previa a cada petición:
 * - coste fijo: se reserva exactamente ese coste;
 * - coste sin cota: bloqueado salvo garantía escrita o activación provisional;
 *   en ambos casos se reserva el mínimo y se liquida el coste real, que sigue
 *   contando en el presupuesto y corta peticiones posteriores.
 */
export function chargePolicy(
  bound: CostBound,
  guarantee: string | undefined,
): ChargeDecision {
  if (bound.kind === "fixed") {
    return { allowed: true, reserveCredits: bound.credits };
  }
  if (chargeMode(guarantee) === "blocked") {
    return { allowed: false, reason: "cost-unbounded" };
  }
  return { allowed: true, reserveCredits: bound.minimumCredits };
}
