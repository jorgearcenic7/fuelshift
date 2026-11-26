import {
  isValidCoordinates,
  RoutingError,
  type RoutingProviderId,
} from "@/domain/refuel/road-routing";
import type { Coordinates } from "@/domain/stations";

import { isRecord } from "./http";

/** GeoJSON LineString o MultiLineString ([longitud, latitud]) a coordenadas del dominio. */
export function parseLineGeometry(
  geometry: unknown,
  provider: RoutingProviderId,
): Coordinates[] {
  const lines =
    isRecord(geometry) && Array.isArray(geometry.coordinates)
      ? geometry.type === "LineString"
        ? [geometry.coordinates]
        : geometry.type === "MultiLineString"
          ? geometry.coordinates
          : null
      : null;
  if (!lines) {
    throw new RoutingError("invalid-response", "Trazado ausente.", provider);
  }

  const points = (lines as unknown[]).flatMap((line) =>
    Array.isArray(line)
      ? line.map((pair: unknown) =>
          Array.isArray(pair)
            ? { longitude: Number(pair[0]), latitude: Number(pair[1]) }
            : { longitude: NaN, latitude: NaN },
        )
      : [{ longitude: NaN, latitude: NaN }],
  );
  if (points.length < 2 || !points.every(isValidCoordinates)) {
    throw new RoutingError("invalid-response", "Trazado no válido.", provider);
  }
  return points;
}
