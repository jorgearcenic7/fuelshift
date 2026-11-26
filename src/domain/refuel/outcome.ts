import { FUEL_LABELS, type FuelCode, type Station } from "@/domain/stations";
import {
  rankRefuelOptions,
  type RefuelAssumptions,
  type RefuelRanking,
} from "./economics";
import type { InvalidSearchField, RefuelSearchResult } from "./planner";
import {
  ROUTING_DISABLED_MESSAGE,
  ROUTING_LIMIT_MESSAGE,
  ROUTING_RATE_LIMIT_MESSAGE,
} from "./road-routing";

/**
 * Traducción de un resultado del planificador a lo que muestra la interfaz.
 * Los fallos de rutas nunca ocultan los precios oficiales: cada mensaje lo
 * recuerda cuando el servicio no responde.
 */
export type RefuelNoticeKind =
  | "disabled"
  | "quota"
  | "rate-limited"
  | "unavailable"
  | "no-route"
  | "no-candidates"
  | "invalid-input"
  | "invalid-request";

export interface RefuelNotice {
  kind: RefuelNoticeKind;
  title: string;
  message: string;
  /** `alert` interrumpe al lector de pantalla; `status` se anuncia sin cortar. */
  role: "alert" | "status";
}

const FIELD_NAMES: Record<InvalidSearchField, string> = {
  fuel: "combustible",
  quantity: "cantidad a repostar",
  consumptionPer100Km: "consumo",
  origin: "origen",
  destination: "destino",
};

export const SERVICE_DISABLED_NOTICE: RefuelNotice = {
  kind: "disabled",
  title: "Servicio desactivado",
  message: ROUTING_DISABLED_MESSAGE,
  role: "status",
};

export function describeRefuelOutcome(
  result: RefuelSearchResult<Station>,
  fuel: FuelCode,
  movement: "dedicated-trip" | "detour",
): RefuelNotice | null {
  switch (result.status) {
    case "ok":
      return null;
    case "invalid-input":
      return {
        kind: "invalid-input",
        title: "Revisa los datos",
        message: `Corrige: ${result.fields.map((field) => FIELD_NAMES[field]).join(", ")}.`,
        role: "alert",
      };
    case "no-candidates":
      return {
        kind: "no-candidates",
        title: "Sin gasolineras candidatas",
        message:
          movement === "detour"
            ? `No hay gasolineras con precio de ${FUEL_LABELS[fuel]} cerca de la ruta.`
            : `No hay gasolineras con precio de ${FUEL_LABELS[fuel]} en el radio de búsqueda.`,
        role: "status",
      };
    case "no-route":
      return {
        kind: "no-route",
        title: "Sin ruta por carretera",
        message:
          "Ninguna gasolinera candidata tiene ruta por carretera desde el origen.",
        role: "status",
      };
    case "error":
      break;
  }
  switch (result.error.kind) {
    case "aborted":
      return null;
    case "disabled":
      return SERVICE_DISABLED_NOTICE;
    case "quota-exceeded":
      return {
        kind: "quota",
        title: "Cuota agotada",
        message: ROUTING_LIMIT_MESSAGE,
        role: "status",
      };
    case "rate-limited":
      return {
        kind: "rate-limited",
        title: "Demasiadas búsquedas",
        message: ROUTING_RATE_LIMIT_MESSAGE,
        role: "status",
      };
    case "no-route":
      return {
        kind: "no-route",
        title: "Sin ruta por carretera",
        message: "No hay ruta por carretera entre el origen y el destino.",
        role: "status",
      };
    case "invalid-request":
      return {
        kind: "invalid-request",
        title: "Trayecto no admitido",
        message:
          "Origen, destino y gasolineras deben estar en el mismo territorio (península, Baleares, Canarias, Ceuta o Melilla).",
        role: "alert",
      };
    default:
      return {
        kind: "unavailable",
        title: "Servicio de rutas no disponible",
        message:
          "No se ha podido calcular la ruta. Inténtalo más tarde; los precios siguen disponibles.",
        role: "alert",
      };
  }
}

/**
 * Cambia la estación de referencia reutilizando las distancias ya obtenidas:
 * no repite la petición de rutas ni consume presupuesto.
 */
export function rerankWithReference<T extends Station>(
  ranking: RefuelRanking<T>,
  assumptions: RefuelAssumptions,
  referenceStationId: string | null,
): RefuelRanking<T> {
  const entries = ranking.options.map(({ station, cost }) => ({
    station,
    price: cost.price,
    attributable: cost.attributable,
  }));
  return rankRefuelOptions(entries, assumptions, referenceStationId) ?? ranking;
}
