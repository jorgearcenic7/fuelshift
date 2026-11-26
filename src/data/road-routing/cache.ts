import type {
  RoadLegs,
  RoadRoute,
  RoadRoutingProvider,
} from "@/domain/refuel/road-routing";
import type { Coordinates } from "@/domain/stations";

export interface RoutingCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

const key = (points: readonly Coordinates[]) =>
  points.map((point) => `${point.latitude},${point.longitude}`).join(";");

/**
 * Memoria en el navegador para no repetir peticiones idénticas (volver a pulsar
 * «buscar» o cambiar litros o consumo, que no alteran las rutas). Solo vive en
 * la sesión: no se escribe en `localStorage` ni se envía a ningún sitio. Guarda
 * únicamente respuestas correctas, de modo que una cancelación o un fallo no
 * se reutilizan. Ahorra cuota, pero no es una garantía de coste: esa la da el
 * presupuesto persistente del Worker.
 */
export function withRoutingCache(
  provider: RoadRoutingProvider,
  options: RoutingCacheOptions = {},
): RoadRoutingProvider {
  const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 30;
  const now = options.now ?? Date.now;
  const entries = new Map<
    string,
    { storedAt: number; value: RoadLegs | RoadRoute }
  >();

  async function cached<T extends RoadLegs | RoadRoute>(
    entryKey: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = entries.get(entryKey);
    if (hit && now() - hit.storedAt <= ttlMs) return hit.value as T;
    entries.delete(entryKey);

    const value = await load();
    entries.set(entryKey, { storedAt: now(), value });
    // Map conserva el orden de inserción: la primera clave es la más antigua.
    if (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value!);
    }
    return value;
  }

  return {
    id: provider.id,
    maxLocations: provider.maxLocations,
    legs: (request, signal) =>
      cached(
        `l|${key([request.start, request.end])}|${key(request.locations)}`,
        () => provider.legs(request, signal),
      ),
    route: (waypoints, signal) =>
      cached(`r|${key(waypoints)}`, () => provider.route(waypoints, signal)),
  };
}
