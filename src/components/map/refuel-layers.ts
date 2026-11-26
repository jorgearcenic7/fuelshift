import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";

import {
  featureBounds,
  type RefuelFeatureCollection,
} from "@/domain/refuel/map-features";

// Capas del resultado de repostaje: ruta del viaje, salida y destino, y las
// gasolineras numeradas por ahorro neto con el color de su rentabilidad.
// Los colores coinciden con las etiquetas del panel (globals.css).

export const REFUEL_SOURCE = "refuel";
export const REFUEL_LAYER_IDS = [
  "refuel-route-casing",
  "refuel-route",
  "refuel-endpoints",
  "refuel-points",
  "refuel-rank",
] as const;
export const EMPTY_REFUEL: RefuelFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const PROFITABILITY_COLOR: ExpressionSpecification = [
  "match",
  ["get", "profitability"],
  "worthwhile",
  "#0c7a54",
  "not-worthwhile",
  "#b8322a",
  "negligible",
  "#a8740c",
  "#14406f",
];

export function focusedRadius(
  stationId: string | null,
): ExpressionSpecification {
  return ["case", ["==", ["get", "stationId"], stationId ?? ""], 14, 11];
}

export function focusedStroke(
  stationId: string | null,
): ExpressionSpecification {
  return ["case", ["==", ["get", "stationId"], stationId ?? ""], 4, 2.5];
}

export function addRefuelLayers(
  map: MapLibreMap,
  data: RefuelFeatureCollection,
  focusedId: string | null,
) {
  map.addSource(REFUEL_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: "refuel-route-casing",
    type: "line",
    source: REFUEL_SOURCE,
    filter: ["==", ["get", "kind"], "route"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 8 },
  });
  map.addLayer({
    id: "refuel-route",
    type: "line",
    source: REFUEL_SOURCE,
    filter: ["==", ["get", "kind"], "route"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#1f62b0", "line-width": 4.5 },
  });
  map.addLayer({
    id: "refuel-endpoints",
    type: "circle",
    source: REFUEL_SOURCE,
    filter: ["in", ["get", "kind"], ["literal", ["origin", "destination"]]],
    paint: {
      "circle-color": [
        "match",
        ["get", "kind"],
        "origin",
        "#1f62b0",
        "#0f1d2e",
      ],
      "circle-radius": 7,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "refuel-points",
    type: "circle",
    source: REFUEL_SOURCE,
    filter: ["==", ["get", "kind"], "station"],
    layout: { "circle-sort-key": ["-", 0, ["get", "rank"]] },
    paint: {
      "circle-color": PROFITABILITY_COLOR,
      "circle-radius": focusedRadius(focusedId),
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": focusedStroke(focusedId),
    },
  });
  map.addLayer({
    id: "refuel-rank",
    type: "symbol",
    source: REFUEL_SOURCE,
    filter: ["==", ["get", "kind"], "station"],
    layout: {
      "text-field": ["to-string", ["get", "rank"]],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      // Las mejores, encima de las demás cuando se solapan.
      "symbol-sort-key": ["-", 0, ["get", "rank"]],
    },
    paint: { "text-color": "#ffffff" },
  });
}

export function setRefuelData(map: MapLibreMap, data: RefuelFeatureCollection) {
  (map.getSource(REFUEL_SOURCE) as GeoJSONSource | undefined)?.setData(data);
}

/** Clave estable del encuadre: cambia con una búsqueda nueva, no con la referencia. */
export function boundsKey(data: RefuelFeatureCollection): string | null {
  const bounds = featureBounds(data);
  return bounds
    ? bounds
        .flat()
        .map((value) => value.toFixed(5))
        .join(",")
    : null;
}
