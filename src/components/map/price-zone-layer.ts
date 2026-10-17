import {
  MIN_ZONE_STATIONS,
  type PriceClass,
  type PriceScale,
  type PriceZone,
  type PriceZoneMap,
} from "@/domain/price-zones";
import { FUEL_LABELS, type FuelCode } from "@/domain/stations";

export type MapView = "stations" | "zones";

/**
 * Paleta validada para daltonismo (protanopia, deuteranopia y tritanopia) en
 * todos los pares. El amarillo tiene poco contraste con el mapa base, así que
 * cada celda lleva un borde más oscuro y la leyenda nombra cada clase.
 */
export const PRICE_CLASS_STYLES: Record<
  PriceClass,
  { label: string; fill: string; outline: string }
> = {
  0: { label: "Más barata", fill: "#00552d", outline: "#00381e" },
  1: { label: "Intermedia", fill: "#f2c94c", outline: "#9a7a12" },
  2: { label: "Más cara", fill: "#e8503a", outline: "#a3301f" },
};
export const INSUFFICIENT_STYLE = {
  label: "Sin datos suficientes",
  fill: "#8a96a3",
  outline: "#6b7785",
};
/** Valor de `priceClass` en el GeoJSON para las zonas sin muestra suficiente. */
export const INSUFFICIENT_CLASS = -1;

export const STATION_LAYER_IDS = [
  "station-cluster-halo",
  "station-clusters",
  "station-cluster-count",
  "station-points",
] as const;
export const ZONE_LAYER_IDS = [
  "price-zone-fill",
  "price-zone-outline",
] as const;

export function layerVisibility(
  view: MapView,
): Record<string, "visible" | "none"> {
  const show = (visible: boolean) => (visible ? "visible" : "none");
  return Object.fromEntries([
    ...STATION_LAYER_IDS.map((id) => [id, show(view === "stations")]),
    ...ZONE_LAYER_IDS.map((id) => [id, show(view === "zones")]),
  ]);
}

const priceFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** Tres decimales, como publica MITECO; la unidad no está acreditada. */
export function formatZonePrice(value: number): string {
  return priceFormatter.format(value);
}

export function classIntervals(scale: PriceScale): Record<PriceClass, string> {
  if (scale.min === scale.max) {
    return {
      0: "sin zonas",
      1: `${formatZonePrice(scale.min)} en todas las zonas`,
      2: "sin zonas",
    };
  }
  const lower = formatZonePrice(scale.lowerBreak);
  const upper = formatZonePrice(scale.upperBreak);
  return {
    0: `hasta ${lower}`,
    1: `${lower} – ${upper}`,
    2: `más de ${upper}`,
  };
}

/** Versión abreviada para la escala resumida; los lectores de pantalla reciben la completa. */
export function compactIntervals(
  scale: PriceScale,
): Record<PriceClass, string> {
  if (scale.min === scale.max) return classIntervals(scale);
  const lower = formatZonePrice(scale.lowerBreak);
  const upper = formatZonePrice(scale.upperBreak);
  return { 0: `≤ ${lower}`, 1: `${lower}–${upper}`, 2: `> ${upper}` };
}

export function toZoneGeoJson(
  zoneMap: PriceZoneMap | null,
): GeoJSON.FeatureCollection<
  GeoJSON.Polygon,
  { id: string; priceClass: number }
> {
  return {
    type: "FeatureCollection",
    features: (zoneMap?.zones ?? []).map(({ id, bounds, priceClass }) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.south],
            [bounds.east, bounds.north],
            [bounds.west, bounds.north],
            [bounds.west, bounds.south],
          ],
        ],
      },
      properties: { id, priceClass: priceClass ?? INSUFFICIENT_CLASS },
    })),
  };
}

const coordinateFormatter = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Centro de la cuadrícula, calculado a partir de sus propios límites. */
export function formatZoneCenter(bounds: PriceZone["bounds"]): string {
  const latitude = (bounds.south + bounds.north) / 2;
  const longitude = (bounds.west + bounds.east) / 2;
  return `${coordinateFormatter.format(Math.abs(latitude))}° ${latitude >= 0 ? "N" : "S"}, ${coordinateFormatter.format(Math.abs(longitude))}° ${longitude >= 0 ? "E" : "O"}`;
}

/**
 * Nombre visible de cada zona: su municipio principal y, si ese municipio da
 * nombre a varias cuadrículas, el centro de cada una para distinguirlas.
 */
export function zoneLabels(zones: readonly PriceZone[]): Map<string, string> {
  const uses = new Map<string, number>();
  for (const { place } of zones) uses.set(place, (uses.get(place) ?? 0) + 1);
  return new Map(
    zones.map((zone) => [
      zone.id,
      uses.get(zone.place)! > 1
        ? `${zone.place} (${formatZoneCenter(zone.bounds)})`
        : zone.place,
    ]),
  );
}

/** Anchura del tramo intermedio, para mostrar lo pequeña que puede ser la diferencia. */
export function classSpread(scale: PriceScale): string | null {
  return scale.min === scale.max
    ? null
    : formatZonePrice(scale.upperBreak - scale.lowerBreak);
}

export function describeZone(
  zone: PriceZone,
  fuel: FuelCode,
): { title: string; lines: string[] } {
  const stations = `${zone.stationCount} ${zone.stationCount === 1 ? "estación" : "estaciones"} con precio de ${FUEL_LABELS[fuel]}`;
  const title = `Zona de ${zone.place}`;
  const center = `Cuadrícula centrada en ${formatZoneCenter(zone.bounds)}`;
  if (
    zone.medianPrice === null ||
    zone.priceClass === null ||
    zone.minPrice === null ||
    zone.maxPrice === null
  ) {
    return {
      title,
      lines: [
        `Datos insuficientes: ${stations} (mínimo ${MIN_ZONE_STATIONS}).`,
        "No se calcula un precio representativo.",
        center,
      ],
    };
  }
  return {
    title,
    lines: [
      `Precio mediano: ${formatZonePrice(zone.medianPrice)} · ${PRICE_CLASS_STYLES[zone.priceClass].label}`,
      stations,
      `Rango: ${formatZonePrice(zone.minPrice)} – ${formatZonePrice(zone.maxPrice)}`,
      center,
    ],
  };
}

/** Alternativa textual al mapa: zonas suficientes con mediana más baja y más alta. */
export function extremeZones(
  zoneMap: PriceZoneMap,
  limit: number,
): { cheapest: PriceZone[]; priciest: PriceZone[] } {
  const ranked = zoneMap.zones
    .filter((zone) => zone.medianPrice !== null)
    .sort(
      (left, right) =>
        left.medianPrice! - right.medianPrice! ||
        left.place.localeCompare(right.place, "es"),
    );
  return {
    cheapest: ranked.slice(0, limit),
    priciest: ranked.slice(-limit).reverse(),
  };
}
