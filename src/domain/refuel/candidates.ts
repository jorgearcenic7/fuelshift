import type { InputLimit } from "@/domain/energy-comparison";
import {
  distanceInKm,
  getStationPrice,
  type Coordinates,
  type FuelCode,
  type Station,
} from "@/domain/stations";
import { isValidCoordinates } from "./road-routing";

/**
 * Preselección geográfica de candidatas. La distancia en línea recta solo
 * decide a qué estaciones se pide ruta: no acredita acceso por carretera ni se
 * muestra al usuario como distancia real.
 */
export interface Candidate<T extends Station = Station> {
  station: T;
  price: number;
  /** Distancia de cribado (al origen o al trazado), nunca un resultado. */
  screeningKm: number;
}

export interface PreselectionOptions {
  /** Radio en línea recta alrededor del origen, o anchura del pasillo a cada lado de la ruta. */
  radiusKm: number;
  maxCandidates: number;
}

export const PRESELECTION_LIMITS: Readonly<
  Record<keyof PreselectionOptions, InputLimit>
> = {
  radiusKm: { min: 1, max: 50 },
  maxCandidates: { min: 1, max: 50, integer: true },
};

/**
 * Cada búsqueda cercana pide dos matrices de 1 × N (ida y vuelta). Con 15
 * candidatas son 30 créditos de Geoapify, un 1 % de la cuota diaria gratuita.
 */
export const NEARBY_PRESELECTION: PreselectionOptions = {
  radiusKm: 10,
  maxCandidates: 15,
};

export const ROUTE_PRESELECTION: PreselectionOptions = {
  radiusKm: 2,
  maxCandidates: 15,
};

/**
 * Alterna la más cercana y la más barata pendientes hasta llenar el cupo. Solo
 * por precio se perdería la estación de referencia (la más próxima); solo por
 * cercanía, las que justifican el desplazamiento.
 */
function interleaveNearestAndCheapest<T extends Station>(
  candidates: Candidate<T>[],
  maxCandidates: number,
): Candidate<T>[] {
  const byDistance = [...candidates].sort(
    (left, right) =>
      left.screeningKm - right.screeningKm || left.price - right.price,
  );
  const byPrice = [...candidates].sort(
    (left, right) =>
      left.price - right.price || left.screeningKm - right.screeningKm,
  );

  const chosen = new Map<string, Candidate<T>>();
  const limit = Math.min(maxCandidates, candidates.length);
  for (let index = 0; chosen.size < limit; index += 1) {
    for (const list of [byDistance, byPrice]) {
      const item = list[index];
      if (item && chosen.size < limit) chosen.set(item.station.id, item);
    }
  }
  return [...chosen.values()];
}

function pricedStations<T extends Station>(
  stations: readonly T[],
  fuel: FuelCode,
  screening: (location: Coordinates) => number,
  radiusKm: number,
): Candidate<T>[] {
  return stations.flatMap((station) => {
    const price = getStationPrice(station, fuel);
    // Un precio cero o negativo es un error de la fuente, no una oferta.
    if (price === null || price <= 0) return [];
    if (!isValidCoordinates(station.location)) return [];
    const screeningKm = screening(station.location);
    return screeningKm <= radiusKm ? [{ station, price, screeningKm }] : [];
  });
}

export function preselectNearby<T extends Station>(
  stations: readonly T[],
  fuel: FuelCode,
  origin: Coordinates,
  options: PreselectionOptions = NEARBY_PRESELECTION,
): Candidate<T>[] {
  const candidates = pricedStations(
    stations,
    fuel,
    (location) => distanceInKm(origin, location),
    options.radiusKm,
  );
  return interleaveNearestAndCheapest(candidates, options.maxCandidates);
}

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Distancia aproximada de un punto a una polilínea, proyectando en un plano
 * local equirrectangular centrado en el punto. El error es despreciable para
 * cribar a pocos kilómetros, que es su único uso.
 */
export function distanceToPolylineKm(
  point: Coordinates,
  polyline: readonly Coordinates[],
): number {
  if (polyline.length === 0) return Infinity;
  const scaleX = Math.cos(toRadians(point.latitude)) * EARTH_RADIUS_KM;
  const project = ({ latitude, longitude }: Coordinates) => ({
    x: toRadians(longitude - point.longitude) * scaleX,
    y: toRadians(latitude - point.latitude) * EARTH_RADIUS_KM,
  });

  let previous = project(polyline[0]);
  let best = Math.hypot(previous.x, previous.y);
  for (const vertex of polyline.slice(1)) {
    const current = project(vertex);
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const lengthSquared = dx * dx + dy * dy;
    // Proyección del punto (origen del plano) sobre el segmento, acotada a sus extremos.
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(
            1,
            Math.max(0, -(previous.x * dx + previous.y * dy) / lengthSquared),
          );
    best = Math.min(best, Math.hypot(previous.x + t * dx, previous.y + t * dy));
    previous = current;
  }
  return best;
}

/** Caja que envuelve el trazado ampliada en `marginKm`, para descartar rápido. */
function expandedBounds(polyline: readonly Coordinates[], marginKm: number) {
  // Bucle en lugar de Math.min(...) para no desbordar la pila con trazados largos.
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const { latitude, longitude } of polyline) {
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
  }
  const latitudeMargin = (marginKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  // El grado de longitud se estrecha hacia el norte: se usa la latitud más alejada del ecuador.
  const widestLatitude = Math.max(Math.abs(south), Math.abs(north));
  const longitudeMargin =
    latitudeMargin / Math.max(Math.cos(toRadians(widestLatitude)), 0.01);
  return {
    south: south - latitudeMargin,
    north: north + latitudeMargin,
    west: west - longitudeMargin,
    east: east + longitudeMargin,
  };
}

export function preselectAlongRoute<T extends Station>(
  stations: readonly T[],
  fuel: FuelCode,
  geometry: readonly Coordinates[],
  options: PreselectionOptions = ROUTE_PRESELECTION,
): Candidate<T>[] {
  if (geometry.length === 0) return [];
  const bounds = expandedBounds(geometry, options.radiusKm);
  const candidates = pricedStations(
    stations,
    fuel,
    (location) =>
      location.latitude < bounds.south ||
      location.latitude > bounds.north ||
      location.longitude < bounds.west ||
      location.longitude > bounds.east
        ? Infinity
        : distanceToPolylineKm(location, geometry),
    options.radiusKm,
  );
  return interleaveNearestAndCheapest(candidates, options.maxCandidates);
}

/**
 * Estaciones distintas pueden compartir coordenadas (varios surtidores de un
 * mismo área). Se pide ruta una sola vez por punto y se reparte el resultado.
 */
export function uniqueLocations(points: readonly Coordinates[]): {
  locations: Coordinates[];
  indexOf: number[];
} {
  const positions = new Map<string, number>();
  const locations: Coordinates[] = [];
  const indexOf = points.map((point) => {
    const key = `${point.latitude},${point.longitude}`;
    let position = positions.get(key);
    if (position === undefined) {
      position = locations.push(point) - 1;
      positions.set(key, position);
    }
    return position;
  });
  return { locations, indexOf };
}
