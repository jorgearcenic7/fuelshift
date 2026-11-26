import {
  assertMatrixRequest,
  isValidCoordinates,
  RoutingError,
  toRoadLeg,
  type RoadMatrix,
  type RoadMatrixRequest,
  type RoadRoute,
  type RoadMatrixProvider,
} from "@/domain/refuel/road-routing";
import type { Coordinates } from "@/domain/stations";

import { isRecord, requestJson, type HttpOptions } from "./http";
import { parseLineGeometry } from "./geometry";

/**
 * Adaptador de Geoapify (Routing y Route Matrix, perfil `drive`, unidades
 * métricas: metros y segundos). Consultado el 2026-11-26 en
 * https://apidocs.geoapify.com/docs/route-matrix/ y /docs/routing/:
 * - matriz: hasta 1000 celdas; coste max(N, M) × min(N, M, 10) créditos,
 *   así que 1 × N cuesta N;
 * - ruta: 1 crédito por par de puntos (+1 cada 500 km).
 *
 * - autocompletado: 1 crédito por petición.
 *
 * Solo lo usa el intermediario de rutas (`workers/routing/`), que guarda la
 * clave como secreto y contabiliza cada llamada. El navegador nunca llama a
 * Geoapify directamente.
 */
export interface GeoapifyConfig {
  baseUrl?: string;
  apiKey?: string;
  http?: HttpOptions;
  now?: () => Date;
}

const PROVIDER = "geoapify" as const;
export const GEOAPIFY_MAX_MATRIX_CELLS = 1000;

const lonLat = ({ latitude, longitude }: Coordinates) => [longitude, latitude];

export function parseGeoapifyMatrix(
  body: unknown,
  rows: number,
  columns: number,
): RoadMatrix["cells"] {
  const grid = isRecord(body) ? body.sources_to_targets : undefined;
  if (!Array.isArray(grid) || grid.length !== rows) {
    throw new RoutingError("invalid-response", "Matriz incompleta.", PROVIDER);
  }
  return grid.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== columns) {
      throw new RoutingError("invalid-response", "Fila incompleta.", PROVIDER);
    }
    // Una celda sin ruta llega vacía o sin valores numéricos.
    return row.map((cell: unknown) =>
      isRecord(cell) ? toRoadLeg(cell.distance, cell.time) : null,
    );
  });
}

export function parseGeoapifyRoute(
  body: unknown,
): Pick<RoadRoute, "leg" | "geometry"> {
  const feature =
    isRecord(body) && Array.isArray(body.features) ? body.features[0] : null;
  if (!isRecord(feature) || !isRecord(feature.properties)) {
    throw new RoutingError("no-route", "Sin ruta entre los puntos.", PROVIDER);
  }
  const { distance, time, distance_units: units } = feature.properties;
  // Se piden unidades métricas; si llegaran millas, mezclarlas falsearía el cálculo.
  if (units !== undefined && units !== "meters") {
    throw new RoutingError("invalid-response", "Unidades inesperadas.", PROVIDER);
  }
  const leg = toRoadLeg(distance, time);
  if (!leg) {
    throw new RoutingError("invalid-response", "Ruta sin distancia.", PROVIDER);
  }
  return { leg, geometry: parseLineGeometry(feature.geometry, PROVIDER) };
}

export function createGeoapifyProvider(
  config: GeoapifyConfig = {},
): RoadMatrixProvider {
  const baseUrl = (config.baseUrl ?? "https://api.geoapify.com").replace(
    /\/$/,
    "",
  );
  const now = config.now ?? (() => new Date());
  const withKey = (url: URL) => {
    if (config.apiKey) url.searchParams.set("apiKey", config.apiKey);
    return url.toString();
  };

  return {
    id: PROVIDER,
    maxMatrixCells: GEOAPIFY_MAX_MATRIX_CELLS,

    async matrix(request: RoadMatrixRequest, signal?: AbortSignal) {
      assertMatrixRequest(request, GEOAPIFY_MAX_MATRIX_CELLS, PROVIDER);
      const body = await requestJson(
        PROVIDER,
        withKey(new URL(`${baseUrl}/v1/routematrix`)),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "drive",
            type: "balanced",
            units: "metric",
            sources: request.sources.map((point) => ({ location: lonLat(point) })),
            targets: request.targets.map((point) => ({ location: lonLat(point) })),
          }),
        },
        config.http,
        signal,
      );
      return {
        provider: PROVIDER,
        computedAt: now().toISOString(),
        cells: parseGeoapifyMatrix(
          body,
          request.sources.length,
          request.targets.length,
        ),
      };
    },

    async route(waypoints: readonly Coordinates[], signal?: AbortSignal) {
      if (waypoints.length < 2 || !waypoints.every(isValidCoordinates)) {
        throw new RoutingError(
          "invalid-request",
          "La ruta necesita al menos dos puntos válidos.",
          PROVIDER,
        );
      }
      const url = new URL(`${baseUrl}/v1/routing`);
      // Ojo: este parámetro de Geoapify usa el orden latitud,longitud.
      url.searchParams.set(
        "waypoints",
        waypoints.map((p) => `${p.latitude},${p.longitude}`).join("|"),
      );
      url.searchParams.set("mode", "drive");
      url.searchParams.set("type", "balanced");
      url.searchParams.set("intermediate_waypoint_mode", "stopover");
      url.searchParams.set("units", "metric");
      const body = await requestJson(
        PROVIDER,
        withKey(url),
        { method: "GET" },
        config.http,
        signal,
      );
      return {
        provider: PROVIDER,
        computedAt: now().toISOString(),
        ...parseGeoapifyRoute(body),
      };
    },
  };
}

export interface AutocompleteSuggestion {
  label: string;
  latitude: number;
  longitude: number;
}

/** Resultados de `format=json`: `results[].formatted`, `lat` y `lon`. */
export function parseGeoapifyAutocomplete(
  body: unknown,
  limit: number,
): AutocompleteSuggestion[] {
  const results = isRecord(body) ? body.results : undefined;
  if (!Array.isArray(results)) {
    throw new RoutingError("invalid-response", "Sin resultados.", PROVIDER);
  }
  return results.slice(0, limit).flatMap((result: unknown) => {
    if (!isRecord(result) || typeof result.formatted !== "string") return [];
    const point = { latitude: Number(result.lat), longitude: Number(result.lon) };
    return isValidCoordinates(point)
      ? [{ label: result.formatted.slice(0, 200), ...point }]
      : [];
  });
}

/**
 * Autocompletado de direcciones limitado a España y sin sesgo por la
 * ubicación del usuario, que no se envía.
 */
export function createGeoapifyAutocomplete(config: GeoapifyConfig = {}) {
  const baseUrl = (config.baseUrl ?? "https://api.geoapify.com").replace(
    /\/$/,
    "",
  );
  return async (
    text: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<AutocompleteSuggestion[]> => {
    const url = new URL(`${baseUrl}/v1/geocode/autocomplete`);
    url.searchParams.set("text", text);
    url.searchParams.set("filter", "countrycode:es");
    url.searchParams.set("lang", "es");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("format", "json");
    if (config.apiKey) url.searchParams.set("apiKey", config.apiKey);
    const body = await requestJson(
      PROVIDER,
      url.toString(),
      { method: "GET" },
      config.http,
      signal,
    );
    return parseGeoapifyAutocomplete(body, limit);
  };
}
