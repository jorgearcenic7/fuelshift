import {
  isValidCoordinates,
  ROUTING_DISABLED_MESSAGE,
  ROUTING_LIMIT_MESSAGE,
  ROUTING_RATE_LIMIT_MESSAGE,
  RoutingError,
  toRoadLeg,
  type RoadLeg,
  type RoadMatrix,
  type RoadRoutingProvider,
  type RoutingErrorKind,
} from "@/domain/refuel/road-routing";
import {
  parseAutocompleteText,
  ROUTING_API_LIMITS,
  ROUTING_API_PATHS,
  spainRegion,
  type RoutingApiErrorCode,
} from "@/domain/refuel/routing-api";
import type { Coordinates } from "@/domain/stations";

import { DEFAULT_TIMEOUT_MS, isRecord } from "./http";
import { parseLineGeometry } from "./geometry";

/**
 * Cliente del intermediario de rutas. No reintenta: el único reintento lo
 * decide el Worker cuando tiene presupuesto reservado, y repetirlo aquí
 * contaría dos búsquedas al visitante. Solo debe llamarse tras una acción
 * explícita del usuario, nunca al cargar la página ni al mover el mapa.
 */
export interface WorkerClientConfig {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const PROVIDER = "geoapify" as const;

/**
 * URL del intermediario, fijada al compilar con `NEXT_PUBLIC_ROUTING_URL`.
 * Sin ella, o si no es HTTPS, el servicio se considera desactivado y la web
 * no hace ninguna petición de rutas. Activarla exige además añadir el origen
 * del Worker a `connect-src` en `public/_headers`.
 */
export function routingServiceUrl(
  value: string | undefined = process.env.NEXT_PUBLIC_ROUTING_URL,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.search && !url.hash
      ? url.toString().replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}

/** Petición al Worker con tiempo límite y cancelación; devuelve el cuerpo si es correcto. */
async function send(
  config: WorkerClientConfig,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (signal?.aborted) {
    throw new RoutingError("aborted", "Búsqueda cancelada.", PROVIDER);
  }
  // Dos intentos de 8 s del Worker más la contabilidad y el tránsito.
  const timeout = AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS * 2 + 4000);
  let response: Response;
  try {
    response = await (config.fetch ?? fetch)(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (signal?.aborted) {
      throw new RoutingError("aborted", "Búsqueda cancelada.", PROVIDER);
    }
    throw new RoutingError(
      timeout.aborted ? "timeout" : "unavailable",
      "Servicio de rutas inaccesible.",
      PROVIDER,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorFrom(response.status, body);
  if (!isRecord(body)) {
    throw new RoutingError("invalid-response", "Respuesta inesperada.", PROVIDER);
  }
  return body;
}

const KIND_BY_CODE: Record<RoutingApiErrorCode, RoutingErrorKind> = {
  "invalid-request": "invalid-request",
  forbidden: "unauthorized",
  "not-found": "invalid-request",
  duplicate: "rate-limited",
  "rate-limited": "rate-limited",
  quota: "quota-exceeded",
  disabled: "disabled",
  "cost-unbounded": "disabled",
  unavailable: "unavailable",
  "no-route": "no-route",
};

function errorFrom(status: number, body: unknown): RoutingError {
  const code =
    isRecord(body) && typeof body.error === "string" && body.error in KIND_BY_CODE
      ? (body.error as RoutingApiErrorCode)
      : status === 429
        ? "rate-limited"
        : "unavailable";
  const kind = KIND_BY_CODE[code];
  const message =
    kind === "quota-exceeded"
      ? ROUTING_LIMIT_MESSAGE
      : kind === "rate-limited"
        ? ROUTING_RATE_LIMIT_MESSAGE
        : kind === "disabled"
          ? ROUTING_DISABLED_MESSAGE
          : `Servicio de rutas no disponible (${code}).`;
  return new RoutingError(kind, message, PROVIDER);
}

function legsColumn(value: unknown, length: number): (RoadLeg | null)[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new RoutingError("invalid-response", "Tramos incompletos.", PROVIDER);
  }
  return value.map((cell: unknown) =>
    isRecord(cell) ? toRoadLeg(cell.distanceMeters, cell.durationSeconds) : null,
  );
}

function computedAt(body: Record<string, unknown>): string {
  const value = body.computedAt;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new RoutingError("invalid-response", "Fecha ausente.", PROVIDER);
  }
  return value;
}

export function createWorkerRoutingProvider(
  config: WorkerClientConfig,
): RoadRoutingProvider {
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  async function post(path: string, payload: unknown, signal?: AbortSignal) {
    const body = await send(
      config,
      `${baseUrl}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      signal,
    );
    if (body.provider !== PROVIDER) {
      throw new RoutingError("invalid-response", "Respuesta inesperada.", PROVIDER);
    }
    return body;
  }

  const matrix = (cells: RoadMatrix["cells"], at: string): RoadMatrix => ({
    provider: PROVIDER,
    computedAt: at,
    cells,
  });

  return {
    id: PROVIDER,
    maxLocations: ROUTING_API_LIMITS.maxLocations,

    async legs({ start, end, locations }, signal) {
      const body = await post(
        ROUTING_API_PATHS.legs,
        { start, end, locations },
        signal,
      );
      const at = computedAt(body);
      const toStation = legsColumn(body.toStation, locations.length);
      const fromStation = legsColumn(body.fromStation, locations.length);
      return {
        toStation: matrix([toStation], at),
        fromStation: matrix(
          fromStation.map((leg) => [leg]),
          at,
        ),
      };
    },

    async route(waypoints: readonly Coordinates[], signal?: AbortSignal) {
      if ((waypoints.length !== 2 && waypoints.length !== 3) || !waypoints.every(isValidCoordinates)) {
        throw new RoutingError(
          "invalid-request",
          "La ruta necesita origen y destino válidos.",
          PROVIDER,
        );
      }
      const start = waypoints[0];
      const end = waypoints[waypoints.length - 1];
      const body = await post(ROUTING_API_PATHS.route, { start, end, ...(waypoints.length === 3 ? { via: waypoints[1] } : {}) }, signal);
      const leg = isRecord(body.leg)
        ? toRoadLeg(body.leg.distanceMeters, body.leg.durationSeconds)
        : null;
      if (!leg) {
        throw new RoutingError("invalid-response", "Ruta sin distancia.", PROVIDER);
      }
      const geometry = Array.isArray(body.geometry)
        ? parseLineGeometry(
            {
              type: "LineString",
              coordinates: body.geometry.map((point: unknown) =>
                isRecord(point) ? [point.longitude, point.latitude] : null,
              ),
            },
            PROVIDER,
          )
        : parseLineGeometry(null, PROVIDER);
      return { provider: PROVIDER, computedAt: computedAt(body), leg, geometry };
    },
  };
}

export interface AddressSuggestion {
  label: string;
  location: Coordinates;
}

/**
 * Autocompletado de direcciones a través del Worker (1 crédito por consulta).
 * Valida el texto antes de enviarlo para no gastar una petición que el Worker
 * rechazaría, y descarta resultados fuera de España.
 */
export function createWorkerAutocomplete(config: WorkerClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  return async (
    text: string,
    signal?: AbortSignal,
  ): Promise<AddressSuggestion[]> => {
    const normalized = parseAutocompleteText(text);
    if (!normalized) {
      throw new RoutingError(
        "invalid-request",
        "Escribe entre 3 y 80 caracteres de una dirección.",
        PROVIDER,
      );
    }
    const url = new URL(`${baseUrl}${ROUTING_API_PATHS.autocomplete}`);
    url.searchParams.set("text", normalized);
    const body = await send(config, url.toString(), { method: "GET" }, signal);
    if (!Array.isArray(body.results)) {
      throw new RoutingError("invalid-response", "Sin resultados.", PROVIDER);
    }
    return body.results
      .slice(0, ROUTING_API_LIMITS.autocomplete.results)
      .flatMap((item: unknown) => {
        if (!isRecord(item) || typeof item.label !== "string") return [];
        const location = {
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
        };
        return isValidCoordinates(location) && spainRegion(location)
          ? [{ label: item.label.slice(0, 200), location }]
          : [];
      });
  };
}
