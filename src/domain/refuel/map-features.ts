import type { Coordinates, Station } from "@/domain/stations";
import type { Profitability, RefuelRanking } from "./economics";
import type { RoadRoute } from "./road-routing";

/**
 * GeoJSON para dibujar un resultado sobre el mapa actual (MapLibre lo consume
 * como fuente `geojson`). Las propiedades son planas para usarlas en
 * expresiones de estilo; GeoJSON exige el orden [longitud, latitud].
 */
export interface RefuelPointProperties {
  kind: "station";
  stationId: string;
  /** Puesto en el orden por ahorro neto, desde 1. */
  rank: number;
  profitability: Profitability;
  netSaving: number;
}

export interface RefuelEndpointProperties {
  kind: "origin" | "destination";
}

type Point<P> = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: P;
};

export interface RefuelFeatureCollection {
  type: "FeatureCollection";
  features: (
    | Point<RefuelPointProperties>
    | Point<RefuelEndpointProperties>
    | {
        type: "Feature";
        geometry: { type: "LineString"; coordinates: [number, number][] };
        properties: { kind: "route" };
      }
  )[];
}

const lonLat = ({ latitude, longitude }: Coordinates): [number, number] => [
  longitude,
  latitude,
];

export interface RefuelMapInput<T extends Station> {
  ranking: RefuelRanking<T>;
  route: RoadRoute | null;
  origin: Coordinates;
  /** Solo en un viaje; en «cerca de mí» se vuelve al origen. */
  destination: Coordinates | null;
}

/** Orden de dibujo: ruta, extremos y estaciones encima. */
export function refuelResultToGeoJSON<T extends Station>({
  ranking,
  route,
  origin,
  destination,
}: RefuelMapInput<T>): RefuelFeatureCollection {
  const points = ranking.options.map(
    (option, index): Point<RefuelPointProperties> => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: lonLat(option.station.location) },
      properties: {
        kind: "station",
        stationId: option.station.id,
        rank: index + 1,
        profitability: option.profitability,
        netSaving: option.versusReference.netSaving,
      },
    }),
  );
  const endpoint = (
    point: Coordinates,
    kind: RefuelEndpointProperties["kind"],
  ): Point<RefuelEndpointProperties> => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: lonLat(point) },
    properties: { kind },
  });
  return {
    type: "FeatureCollection",
    features: [
      ...(route
        ? [
            {
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: route.geometry.map(lonLat),
              },
              properties: { kind: "route" as const },
            },
          ]
        : []),
      endpoint(origin, "origin"),
      ...(destination ? [endpoint(destination, "destination")] : []),
      ...points,
    ],
  };
}

/** Recuadro [[oeste, sur], [este, norte]] de todas las geometrías, para encuadrarlas. */
export function featureBounds(
  collection: RefuelFeatureCollection,
): [[number, number], [number, number]] | null {
  const coordinates = collection.features.flatMap((feature) =>
    feature.geometry.type === "Point"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates,
  );
  if (coordinates.length === 0) return null;
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}
