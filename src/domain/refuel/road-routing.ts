import type { Coordinates } from "@/domain/stations";

/**
 * Contrato común de los proveedores de rutas por carretera. El motor de
 * FuelShift solo conoce estas formas; cada adaptador (hoy, Geoapify a través
 * del Worker) traduce su API a ellas.
 *
 * Unidades fijas: metros y segundos. Coordenadas WGS84 en grados decimales
 * con el orden del dominio (latitud, longitud); el adaptador se encarga del
 * orden [longitud, latitud] que exige cada API.
 */
export type RoutingProviderId = "geoapify" | "openrouteservice";

export interface RoadLeg {
  distanceMeters: number;
  durationSeconds: number;
}

export interface RoadMatrixRequest {
  sources: readonly Coordinates[];
  targets: readonly Coordinates[];
}

/** `cells[i][j]` es el trayecto de `sources[i]` a `targets[j]`; null si no hay ruta. */
export interface RoadMatrix {
  provider: RoutingProviderId;
  /** Instante en que se obtuvo la respuesta (ISO 8601), para declarar su antigüedad. */
  computedAt: string;
  cells: (RoadLeg | null)[][];
}

export interface RoadRoute {
  provider: RoutingProviderId;
  computedAt: string;
  leg: RoadLeg;
  /** Trazado de la ruta para dibujarlo y para preseleccionar estaciones cercanas. */
  geometry: Coordinates[];
}

/** Proveedor con matriz: lo implementan los adaptadores directos de cada API. */
export interface RoadMatrixProvider {
  readonly id: RoutingProviderId;
  /** Celdas máximas (orígenes × destinos) que admite una petición de matriz. */
  readonly maxMatrixCells: number;
  matrix(request: RoadMatrixRequest, signal?: AbortSignal): Promise<RoadMatrix>;
  route(
    waypoints: readonly Coordinates[],
    signal?: AbortSignal,
  ): Promise<RoadRoute>;
}

/**
 * Tramos de una búsqueda: de `start` a cada punto (1 × N) y de cada punto a
 * `end` (N × 1). En «cerca de mí» `start` y `end` coinciden (ida y vuelta).
 */
export interface RoadLegsRequest {
  start: Coordinates;
  end: Coordinates;
  locations: readonly Coordinates[];
}

export interface RoadLegs {
  toStation: RoadMatrix;
  fromStation: RoadMatrix;
}

/**
 * Lo que consume el motor. Una búsqueda es una sola operación `legs`, de modo
 * que el intermediario puede reservar y contabilizar su coste completo antes
 * de enviar nada al proveedor.
 */
export interface RoadRoutingProvider {
  readonly id: RoutingProviderId;
  /** Puntos máximos por operación `legs`. */
  readonly maxLocations: number;
  legs(request: RoadLegsRequest, signal?: AbortSignal): Promise<RoadLegs>;
  route(
    waypoints: readonly Coordinates[],
    signal?: AbortSignal,
  ): Promise<RoadRoute>;
}

/** Mensaje acordado para la degradación cuando se agota la cuota gratuita. */
export const ROUTING_RATE_LIMIT_MESSAGE =
  "Has hecho muchas búsquedas de rutas seguidas. Espera un poco antes de repetir; los precios siguen disponibles.";

export const ROUTING_DISABLED_MESSAGE =
  "El cálculo de rutas está desactivado. Puedes seguir consultando los precios de las gasolineras.";

export const ROUTING_LIMIT_MESSAGE =
  "El servicio gratuito de rutas ha alcanzado temporalmente su límite. Puedes seguir consultando los precios de las gasolineras.";

/** Adapta un proveedor con matriz: dos matrices en paralelo por operación. */
export function legsViaMatrix(
  provider: RoadMatrixProvider,
): RoadRoutingProvider {
  return {
    id: provider.id,
    maxLocations: provider.maxMatrixCells,
    async legs({ start, end, locations }, signal) {
      const [toStation, fromStation] = await Promise.all([
        provider.matrix({ sources: [start], targets: locations }, signal),
        provider.matrix({ sources: locations, targets: [end] }, signal),
      ]);
      return { toStation, fromStation };
    },
    route: (waypoints, signal) => provider.route(waypoints, signal),
  };
}

export type RoutingErrorKind =
  | "invalid-request"
  | "unauthorized"
  | "quota-exceeded"
  | "rate-limited"
  /** Servicio apagado por configuración o por falta de garantía económica. */
  | "disabled"
  | "unavailable"
  | "timeout"
  | "aborted"
  | "invalid-response"
  | "no-route";

export class RoutingError extends Error {
  readonly kind: RoutingErrorKind;
  readonly provider: RoutingProviderId | null;

  constructor(
    kind: RoutingErrorKind,
    message: string,
    provider: RoutingProviderId | null = null,
  ) {
    super(message);
    this.name = "RoutingError";
    this.kind = kind;
    this.provider = provider;
  }
}

/** Rango WGS84 válido. Se descarta (0, 0), que en las fuentes indica coordenada ausente. */
export function isValidCoordinates(point: Coordinates): boolean {
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

/**
 * Reduce la precisión de la ubicación del usuario antes de enviarla a un
 * proveedor: cuatro decimales son unos 11 m, suficiente para calcular la ruta
 * y menos revelador que la lectura completa del GPS.
 */
export function coarsenCoordinates(
  point: Coordinates,
  decimals = 4,
): Coordinates {
  const factor = 10 ** decimals;
  return {
    latitude: Math.round(point.latitude * factor) / factor,
    longitude: Math.round(point.longitude * factor) / factor,
  };
}

export function assertMatrixRequest(
  request: RoadMatrixRequest,
  maxCells: number,
  provider: RoutingProviderId,
): void {
  const { sources, targets } = request;
  if (sources.length === 0 || targets.length === 0) {
    throw new RoutingError(
      "invalid-request",
      "La matriz necesita al menos un origen y un destino.",
      provider,
    );
  }
  if (sources.length * targets.length > maxCells) {
    throw new RoutingError(
      "invalid-request",
      `La matriz supera las ${maxCells} celdas por petición.`,
      provider,
    );
  }
  if (![...sources, ...targets].every(isValidCoordinates)) {
    throw new RoutingError(
      "invalid-request",
      "Hay coordenadas fuera de rango.",
      provider,
    );
  }
}

/** Una celda sin distancia o duración finita y no negativa se trata como ruta inexistente. */
export function toRoadLeg(
  distanceMeters: unknown,
  durationSeconds: unknown,
): RoadLeg | null {
  if (
    typeof distanceMeters !== "number" ||
    typeof durationSeconds !== "number" ||
    !Number.isFinite(distanceMeters) ||
    !Number.isFinite(durationSeconds) ||
    distanceMeters < 0 ||
    durationSeconds < 0
  ) {
    return null;
  }
  return { distanceMeters, durationSeconds };
}
