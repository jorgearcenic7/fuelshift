// Personalización del estilo Positron de OpenFreeMap (gratuito): tierra clara,
// mar gris azulado, etiquetas discretas y nombres en español cuando la tesela
// los trae. Se aplica antes de pintar el estilo, sin parpadeo.

import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

export const BASE_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export const BASE_COLORS = {
  land: "#f4f3ef",
  water: "#c9d6e0",
  waterLabel: "#5f7487",
  park: "#e7ebe4",
  wood: "#e3e8e1",
  boundary: "#b9c2cc",
  labelStrong: "#3d4d5e",
  labelSoft: "#66788b",
  halo: "#ffffff",
} as const;

/** Nombre en español si existe; si no, el latino o el original. */
export const SPANISH_NAME: ExpressionSpecification = [
  "coalesce",
  ["get", "name:es"],
  ["get", "name:latin"],
  ["get", "name"],
];

/** Capas de etiquetas cuyo texto es un nombre de lugar o de agua. */
const NAMED_LABEL_SOURCES = new Set([
  "place",
  "water_name",
  "waterway",
  "aerodrome_label",
]);

function withPaint(
  layer: LayerSpecification,
  paint: Record<string, unknown>,
): LayerSpecification {
  return {
    ...layer,
    paint: { ...(layer.paint ?? {}), ...paint },
  } as LayerSpecification;
}

function customizeLayer(layer: LayerSpecification): LayerSpecification {
  // Positron compara ref_length con 6 incluso en teselas sin ese atributo.
  // Mantener las referencias numéricas y excluir las ausentes evita avisos de
  // evaluación al ampliar hasta una estación. No modifica los datos del mapa.
  if (
    layer.type === "symbol" &&
    [
      "highway-shield-non-us",
      "highway-shield-us-interstate",
      "road_shield_us",
    ].includes(layer.id) &&
    Array.isArray(layer.filter) &&
    layer.filter?.[0] === "all" &&
    JSON.stringify(layer.filter[1]) === '["<=",["get","ref_length"],6]'
  ) {
    layer = {
      ...layer,
      filter: [
        "all",
        ["<=", ["number", ["get", "ref_length"], 7], 6],
        ...layer.filter.slice(2),
      ] as FilterSpecification,
    };
  }
  const sourceLayer =
    "source-layer" in layer ? (layer["source-layer"] ?? "") : "";

  if (layer.type === "background") {
    return withPaint(layer, { "background-color": BASE_COLORS.land });
  }
  if (layer.type === "fill" && sourceLayer === "water") {
    return withPaint(layer, { "fill-color": BASE_COLORS.water });
  }
  if (layer.type === "line" && sourceLayer === "waterway") {
    return withPaint(layer, { "line-color": BASE_COLORS.water });
  }
  if (layer.type === "fill" && layer.id === "park") {
    return withPaint(layer, { "fill-color": BASE_COLORS.park });
  }
  if (layer.type === "fill" && layer.id === "landcover_wood") {
    return withPaint(layer, { "fill-color": BASE_COLORS.wood });
  }
  if (layer.type === "line" && sourceLayer === "boundary") {
    return withPaint(layer, { "line-color": BASE_COLORS.boundary });
  }
  if (layer.type === "symbol" && NAMED_LABEL_SOURCES.has(sourceLayer)) {
    const isWater = sourceLayer === "water_name" || sourceLayer === "waterway";
    // Países y ciudades un poco más marcados; el resto, discreto.
    const strong = /country|city|state/.test(layer.id);
    return {
      ...withPaint(layer, {
        "text-color": isWater
          ? BASE_COLORS.waterLabel
          : strong
            ? BASE_COLORS.labelStrong
            : BASE_COLORS.labelSoft,
        "text-halo-color": BASE_COLORS.halo,
        "text-halo-width": 1.4,
      }),
      layout: { ...(layer.layout ?? {}), "text-field": SPANISH_NAME },
    } as LayerSpecification;
  }
  return layer;
}

/** Colores y nombres del mapa, con filtros seguros para referencias ausentes. */
export function customizeBaseStyle(
  _previous: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification {
  return { ...next, layers: next.layers.map(customizeLayer) };
}
