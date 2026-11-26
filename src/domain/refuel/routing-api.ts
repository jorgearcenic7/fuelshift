import { distanceInKm, type Coordinates } from "@/domain/stations";
import type { RoadLeg, RoutingProviderId } from "./road-routing";

/**
 * Contrato HTTP entre la web y el intermediario de rutas (Worker). Lo validan
 * los dos extremos: el navegador para no gastar una petición inválida y el
 * Worker para rechazar cualquier manipulación antes de reservar presupuesto.
 */
export const ROUTING_API_LIMITS = {
  /** Candidatas por búsqueda: 30 créditos base, más los recargos por distancia. */
  maxLocations: 15,
  maxBodyBytes: 4096,
  /** Radio máximo de «cerca de mí», igual al de la preselección. */
  nearbyRadiusKm: 50,
  autocomplete: { minLength: 3, maxLength: 80, results: 5 },
} as const;

export const ROUTING_API_PATHS = {
  legs: "/v1/legs",
  route: "/v1/route",
  autocomplete: "/v1/autocomplete",
} as const;

/**
 * Ámbitos sin conexión por carretera entre sí. Pedir una ruta entre ellos
 * obligaría al proveedor a buscar ferris y disparar recargos por distancia,
 * así que se rechaza. Cajas aproximadas que contienen cada territorio.
 */
export type SpainRegion =
  | "peninsula"
  | "baleares"
  | "canarias"
  | "ceuta"
  | "melilla";

const REGIONS: readonly [SpainRegion, number, number, number, number][] = [
  // [ámbito, sur, norte, oeste, este]; Ceuta, Melilla y Baleares se comprueban antes que la península.
  ["ceuta", 35.86, 35.93, -5.4, -5.26],
  ["melilla", 35.26, 35.33, -2.99, -2.91],
  ["baleares", 38.6, 40.15, 1.1, 4.4],
  ["canarias", 27.6, 29.5, -18.2, -13.3],
  ["peninsula", 35.9, 43.9, -9.5, 3.4],
];

export function spainRegion(point: Coordinates): SpainRegion | null {
  for (const [region, south, north, west, east] of REGIONS) {
    if (
      point.latitude >= south &&
      point.latitude <= north &&
      point.longitude >= west &&
      point.longitude <= east
    ) {
      return region;
    }
  }
  return null;
}

export interface LegsBody {
  start: Coordinates;
  end: Coordinates;
  locations: Coordinates[];
}

export interface RouteBody {
  start: Coordinates;
  end: Coordinates;
  via?: Coordinates;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => actual.includes(key))
  );
}

function parsePoint(value: unknown): Coordinates | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["latitude", "longitude"])
  ) {
    return null;
  }
  const { latitude, longitude } = value;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  const point = { latitude, longitude };
  return spainRegion(point) ? point : null;
}

function sameRegion(points: Coordinates[]): boolean {
  const region = spainRegion(points[0]);
  return points.every((point) => spainRegion(point) === region);
}

export function isRoundTrip(body: LegsBody): boolean {
  return (
    body.start.latitude === body.end.latitude &&
    body.start.longitude === body.end.longitude
  );
}

/** Rechaza claves extra, tipos ajenos, puntos fuera de España y tamaños no permitidos. */
export function parseLegsBody(value: unknown): LegsBody | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, ["start", "end", "locations"])
  ) {
    return null;
  }
  const start = parsePoint(value.start);
  const end = parsePoint(value.end);
  const rawLocations = value.locations;
  if (
    !start ||
    !end ||
    !Array.isArray(rawLocations) ||
    rawLocations.length < 1 ||
    rawLocations.length > ROUTING_API_LIMITS.maxLocations
  ) {
    return null;
  }
  const locations = rawLocations.map(parsePoint);
  if (locations.some((point) => point === null)) return null;

  const body = { start, end, locations: locations as Coordinates[] };
  if (!sameRegion([start, end, ...body.locations])) return null;
  if (
    isRoundTrip(body) &&
    body.locations.some(
      (point) => distanceInKm(start, point) > ROUTING_API_LIMITS.nearbyRadiusKm,
    )
  ) {
    return null;
  }
  return body;
}

export function parseRouteBody(value: unknown): RouteBody | null {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(
      value,
      "via" in value ? ["start", "end", "via"] : ["start", "end"],
    )
  ) {
    return null;
  }
  const start = parsePoint(value.start);
  const end = parsePoint(value.end);
  const via = "via" in value ? parsePoint(value.via) : undefined;
  if (
    !start ||
    !end ||
    via === null ||
    !sameRegion([start, end, ...(via ? [via] : [])])
  )
    return null;
  return { start, end, ...(via ? { via } : {}) };
}

/** Texto de autocompletado normalizado, o null si no cumple longitud o caracteres. */
export function parseAutocompleteText(value: string | null): string | null {
  const text = value?.normalize("NFC").replace(/\s+/g, " ").trim() ?? "";
  const { minLength, maxLength } = ROUTING_API_LIMITS.autocomplete;
  if (text.length < minLength || text.length > maxLength) return null;
  // Letras, números, espacios y la puntuación habitual de una dirección.
  return /^[\p{L}\p{N} .,'ºª/()-]+$/u.test(text) ? text : null;
}

export type RoutingApiErrorCode =
  | "invalid-request"
  | "forbidden"
  | "not-found"
  | "duplicate"
  | "rate-limited"
  | "quota"
  | "disabled"
  /** Sin cota de coste verificable ni garantía del proveedor: bloqueado. */
  | "cost-unbounded"
  | "unavailable"
  | "no-route";

export interface RoutingApiError {
  error: RoutingApiErrorCode;
  message: string;
}

export interface LegsResponse {
  provider: RoutingProviderId;
  computedAt: string;
  toStation: (RoadLeg | null)[];
  fromStation: (RoadLeg | null)[];
}

export interface RouteResponse {
  provider: RoutingProviderId;
  computedAt: string;
  leg: RoadLeg;
  geometry: Coordinates[];
}

export interface AutocompleteResponse {
  results: { label: string; latitude: number; longitude: number }[];
}
