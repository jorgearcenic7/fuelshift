import { isStale } from "@/domain/freshness";
import type { Coordinates, Station } from "@/domain/stations";
import {
  NEARBY_PRESELECTION,
  preselectAlongRoute,
  preselectNearby,
  ROUTE_PRESELECTION,
  uniqueLocations,
  type Candidate,
  type PreselectionOptions,
} from "./candidates";
import {
  dedicatedTripLeg,
  detourLeg,
  findInvalidRefuelInputs,
  isRefuelFuel,
  rankRefuelOptions,
  type RefuelAssumptions,
  type RefuelEntry,
  type RefuelMovement,
  type RefuelRanking,
} from "./economics";
import {
  coarsenCoordinates,
  isValidCoordinates,
  RoutingError,
  type RoadLeg,
  type RoadLegs,
  type RoadMatrix,
  type RoadRoute,
  type RoadRoutingProvider,
  type RoutingProviderId,
} from "./road-routing";

/**
 * Orquesta las dos modalidades de búsqueda sobre cualquier proveedor del
 * contrato común. Ida, vuelta y trayecto directo se piden siempre al mismo
 * proveedor y perfil, para que las distancias de una búsqueda sean comparables.
 */

export interface PriceFreshness {
  retrievedAt: string;
  stale: boolean;
}

export type InvalidSearchField =
  | "fuel"
  | "quantity"
  | "consumptionPer100Km"
  | "origin"
  | "destination";

export type RefuelSearchResult<T extends Station> =
  | {
      status: "ok";
      movement: RefuelMovement;
      provider: RoutingProviderId;
      /** Respuesta de rutas más antigua utilizada. */
      routesComputedAt: string;
      freshness: PriceFreshness;
      ranking: RefuelRanking<T>;
      /** Candidatas sin ruta por carretera: se excluyen, no se aproximan. */
      unreachable: T[];
      /** Trayecto directo del viaje (solo en `detour`). */
      route: RoadRoute | null;
    }
  | { status: "invalid-input"; fields: InvalidSearchField[] }
  | { status: "no-candidates"; freshness: PriceFreshness }
  | { status: "no-route"; freshness: PriceFreshness; unreachable: T[] }
  | { status: "error"; error: RoutingError };

interface SearchBase<T extends Station> {
  stations: readonly T[];
  origin: Coordinates;
  assumptions: RefuelAssumptions;
  /** Fecha de descarga del conjunto de precios publicado. */
  pricesRetrievedAt: string;
  referenceStationId?: string | null;
  preselection?: PreselectionOptions;
  now?: number;
  signal?: AbortSignal;
}

export type NearbySearch<T extends Station> = SearchBase<T>;

export interface TripSearch<T extends Station> extends SearchBase<T> {
  destination: Coordinates;
}

function freshnessOf(retrievedAt: string, now: number): PriceFreshness {
  // Una fecha ilegible no permite afirmar que el precio esté al día.
  const readable = Number.isFinite(new Date(retrievedAt).getTime());
  return { retrievedAt, stale: !readable || isStale(retrievedAt, now) };
}

function invalidFields(
  search: SearchBase<Station>,
  destination?: Coordinates,
): InvalidSearchField[] {
  const fields: InvalidSearchField[] = [];
  if (!isRefuelFuel(search.assumptions.fuel)) fields.push("fuel");
  fields.push(...findInvalidRefuelInputs(search.assumptions));
  if (!isValidCoordinates(search.origin)) fields.push("origin");
  if (destination && !isValidCoordinates(destination)) {
    fields.push("destination");
  }
  return fields;
}

function assertShape(
  matrix: RoadMatrix,
  provider: RoadRoutingProvider,
  rows: number,
  columns: number,
): void {
  if (matrix.provider !== provider.id) {
    throw new RoutingError(
      "invalid-response",
      "La matriz procede de otro proveedor: las distancias no serían comparables.",
      provider.id,
    );
  }
  if (
    matrix.cells.length !== rows ||
    matrix.cells.some((row) => row.length !== columns)
  ) {
    throw new RoutingError(
      "invalid-response",
      "La matriz no tiene las dimensiones pedidas.",
      provider.id,
    );
  }
}

/** Respeta el máximo de puntos por operación del proveedor. */
function capped(
  options: PreselectionOptions,
  provider: RoadRoutingProvider,
): PreselectionOptions {
  return {
    ...options,
    maxCandidates: Math.min(options.maxCandidates, provider.maxLocations),
  };
}

/** Ida (1 × N) y vuelta o continuación (N × 1), una vez por punto distinto. */
async function requestLegs(
  provider: RoadRoutingProvider,
  start: Coordinates,
  end: Coordinates,
  locations: Coordinates[],
  signal?: AbortSignal,
): Promise<RoadLegs> {
  const legs = await provider.legs({ start, end, locations }, signal);
  assertShape(legs.toStation, provider, 1, locations.length);
  assertShape(legs.fromStation, provider, locations.length, 1);
  return legs;
}

function oldest(...timestamps: string[]): string {
  return timestamps.reduce((left, right) =>
    new Date(right).getTime() < new Date(left).getTime() ? right : left,
  );
}

async function search<T extends Station>(
  provider: RoadRoutingProvider,
  base: SearchBase<T>,
  movement: RefuelMovement,
  destination: Coordinates | null,
): Promise<RefuelSearchResult<T>> {
  const fields = invalidFields(base, destination ?? undefined);
  if (fields.length > 0) return { status: "invalid-input", fields };

  const freshness = freshnessOf(base.pricesRetrievedAt, base.now ?? Date.now());
  const origin = coarsenCoordinates(base.origin);
  const end = destination ? coarsenCoordinates(destination) : origin;
  const { fuel } = base.assumptions;

  try {
    let route: RoadRoute | null = null;
    let candidates: Candidate<T>[];
    if (movement === "detour") {
      route = await provider.route([origin, end], base.signal);
      if (route.provider !== provider.id) {
        throw new RoutingError(
          "invalid-response",
          "La ruta procede de otro proveedor.",
          provider.id,
        );
      }
      candidates = preselectAlongRoute(
        base.stations,
        fuel,
        route.geometry,
        capped(base.preselection ?? ROUTE_PRESELECTION, provider),
      );
    } else {
      candidates = preselectNearby(
        base.stations,
        fuel,
        origin,
        capped(base.preselection ?? NEARBY_PRESELECTION, provider),
      );
    }
    if (candidates.length === 0) return { status: "no-candidates", freshness };

    const { locations, indexOf } = uniqueLocations(
      candidates.map(({ station }) => station.location),
    );
    const legs = await requestLegs(
      provider,
      origin,
      end,
      locations,
      base.signal,
    );

    const entries: RefuelEntry<T>[] = [];
    const unreachable: T[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const position = indexOf[index];
      const toStation = legs.toStation.cells[0][position];
      const fromStation = legs.fromStation.cells[position][0];
      if (!toStation || !fromStation) {
        unreachable.push(candidate.station);
        continue;
      }
      const attributable: RoadLeg = route
        ? detourLeg(route.leg, toStation, fromStation)
        : dedicatedTripLeg(toStation, fromStation);
      entries.push({
        station: candidate.station,
        price: candidate.price,
        attributable,
      });
    }

    const ranking = rankRefuelOptions(
      entries,
      base.assumptions,
      base.referenceStationId ?? null,
    );
    if (!ranking) return { status: "no-route", freshness, unreachable };

    return {
      status: "ok",
      movement,
      provider: provider.id,
      routesComputedAt: oldest(
        legs.toStation.computedAt,
        legs.fromStation.computedAt,
        ...(route ? [route.computedAt] : []),
      ),
      freshness,
      ranking,
      unreachable,
      route,
    };
  } catch (error) {
    // Los fallos del proveedor se devuelven tipados para que la interfaz siga
    // mostrando los precios oficiales; cualquier otro error es un defecto y se propaga.
    if (error instanceof RoutingError) return { status: "error", error };
    throw error;
  }
}

/** «Repostar cerca de mí»: ida y vuelta desde el origen solo para repostar. */
export function findNearbyRefuel<T extends Station>(
  provider: RoadRoutingProvider,
  request: NearbySearch<T>,
): Promise<RefuelSearchResult<T>> {
  return search(provider, request, "dedicated-trip", null);
}

/** Repostar durante un viaje: kilómetros añadidos al trayecto directo. */
export function findTripRefuel<T extends Station>(
  provider: RoadRoutingProvider,
  request: TripSearch<T>,
): Promise<RefuelSearchResult<T>> {
  return search(provider, request, "detour", request.destination);
}

/** Geometría de una sola estación, con el mismo perfil que las matrices.
 * Si el proveedor devuelve un recorrido distinto, exige recalcular el ahorro. */
export async function findSelectedRefuelRoute(
  provider: RoadRoutingProvider,
  origin: Coordinates,
  destination: Coordinates | null,
  station: Coordinates,
  attributable: RoadLeg,
  direct: RoadRoute | null,
  signal?: AbortSignal,
): Promise<RoadRoute> {
  const start = coarsenCoordinates(origin);
  const end = destination ? coarsenCoordinates(destination) : start;
  const route = await provider.route([start, station, end], signal);
  const distance =
    attributable.distanceMeters + (direct?.leg.distanceMeters ?? 0);
  const duration =
    attributable.durationSeconds + (direct?.leg.durationSeconds ?? 0);
  if (
    route.provider !== provider.id ||
    Math.abs(route.leg.distanceMeters - distance) >
      Math.max(50, distance * 0.01) ||
    Math.abs(route.leg.durationSeconds - duration) >
      Math.max(60, duration * 0.01)
  ) {
    throw new RoutingError(
      "invalid-response",
      "El recorrido ha cambiado. Vuelve a calcular el ahorro antes de mostrar la ruta.",
      provider.id,
    );
  }
  return route;
}
