import {
  HEATMAP_REGIONS,
  scalePosition,
  type HeatmapRaster,
  type HeatmapRegion,
  type PriceScale,
} from "@/domain/price-heatmap";

export type MapView = "stations" | "heat";

/**
 * Extremos y centro de la rampa. Validados para daltonismo como pares (ΔE ≥ 12
 * en protanopia/deuteranopia); el amarillo es claro, así que la leyenda rotula
 * los extremos con texto además del color.
 */
export const HEAT_COLOR_STOPS = ["#00552d", "#f2c94c", "#e8503a"] as const;
/** Peso acumulado a partir del cual un píxel se dibuja con opacidad completa. */
const FULL_COVERAGE = 1;

const STOP_RGB = HEAT_COLOR_STOPS.map((color) => [
  Number.parseInt(color.slice(1, 3), 16),
  Number.parseInt(color.slice(3, 5), 16),
  Number.parseInt(color.slice(5, 7), 16),
]);

export const HEAT_GRADIENT_CSS = `linear-gradient(to right, ${HEAT_COLOR_STOPS.join(", ")})`;

export const STATION_LAYER_IDS = [
  "station-cluster-halo",
  "station-clusters",
  "station-cluster-count",
  "station-points",
] as const;
export const HEAT_LAYER_IDS = HEATMAP_REGIONS.map(
  (region) => `price-heat-${region.id}`,
);

export function layerVisibility(
  view: MapView,
): Record<string, "visible" | "none"> {
  const show = (visible: boolean) => (visible ? "visible" : "none");
  return Object.fromEntries([
    ...STATION_LAYER_IDS.map((id) => [id, show(view === "stations")]),
    ...HEAT_LAYER_IDS.map((id) => [id, show(view === "heat")]),
  ]);
}

/** Color continuo para una posición de la escala (0 barato, 1 caro). */
export function heatColor(position: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, position));
  const segment = clamped < 0.5 ? 0 : 1;
  const local = clamped < 0.5 ? clamped * 2 : (clamped - 0.5) * 2;
  const [from, to] = [STOP_RGB[segment], STOP_RGB[segment + 1]];
  return [0, 1, 2].map((channel) =>
    Math.round(from[channel] + (to[channel] - from[channel]) * local),
  ) as [number, number, number];
}

/** Píxeles RGBA de una región; transparentes donde no hay estaciones cerca. */
export function heatmapPixels(
  raster: HeatmapRaster,
  scale: PriceScale,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let index = 0; index < raster.values.length; index++) {
    const value = raster.values[index];
    if (Number.isNaN(value)) continue;
    const [red, green, blue] = heatColor(scalePosition(value, scale));
    const offset = index * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = Math.round(
      255 * Math.min(1, raster.coverage[index] / FULL_COVERAGE),
    );
  }
  return pixels;
}

/** Esquinas en el orden que espera una fuente `image` de MapLibre. */
export function imageCoordinates(
  region: HeatmapRegion,
): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    [region.west, region.north],
    [region.east, region.north],
    [region.east, region.south],
    [region.west, region.south],
  ];
}

/** Solo en el navegador: convierte la región en una imagen para MapLibre. */
export function heatmapDataUrl(
  raster: HeatmapRaster,
  scale: PriceScale,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(heatmapPixels(raster, scale), raster.width, raster.height),
      0,
      0,
    );
  return canvas.toDataURL("image/png");
}

/** PNG transparente de 1 × 1 para crear las fuentes antes de tener datos. */
export const EMPTY_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
