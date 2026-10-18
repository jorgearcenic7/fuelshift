import { describe, expect, it } from "vitest";

import {
  buildFilteredHeatmap,
  buildPriceHeatmap,
  HEATMAP_REGIONS,
  type HeatmapRaster,
} from "@/domain/price-heatmap";
import type { Station } from "@/domain/stations";

import {
  HEAT_COLOR_STOPS,
  heatColor,
  heatmapPixels,
  imageCoordinates,
  layerVisibility,
} from "./price-heatmap-layer";

const hex = (color: readonly number[]) =>
  `#${color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

describe("heatColor", () => {
  it("va del verde (barato) al rojo (caro) pasando por el amarillo", () => {
    expect(hex(heatColor(0))).toBe(HEAT_COLOR_STOPS[0]);
    expect(hex(heatColor(0.5))).toBe(HEAT_COLOR_STOPS[1]);
    expect(hex(heatColor(1))).toBe(HEAT_COLOR_STOPS[2]);
  });

  it("interpola de forma continua entre los extremos", () => {
    const quarter = heatColor(0.25);
    const [start, middle] = [heatColor(0), heatColor(0.5)];
    quarter.forEach((channel, index) => {
      expect(channel).toBeGreaterThanOrEqual(
        Math.min(start[index], middle[index]),
      );
      expect(channel).toBeLessThanOrEqual(
        Math.max(start[index], middle[index]),
      );
    });
  });

  it("satura fuera del intervalo", () => {
    expect(heatColor(-1)).toEqual(heatColor(0));
    expect(heatColor(2)).toEqual(heatColor(1));
  });
});

describe("heatmapPixels", () => {
  const raster: HeatmapRaster = {
    region: HEATMAP_REGIONS[0],
    width: 3,
    height: 1,
    rowLatitudes: [40],
    values: Float64Array.from([1.5, 1.9, Number.NaN]),
    coverage: Float64Array.from([2, 0.25, 0]),
  };

  it("colorea cada píxel según la escala y deja transparente lo que no tiene datos", () => {
    const pixels = heatmapPixels(raster, { low: 1.5, high: 1.9 });

    expect(pixels).toHaveLength(12);
    expect(hex([...pixels.slice(0, 3)])).toBe(HEAT_COLOR_STOPS[0]);
    expect(hex([...pixels.slice(4, 7)])).toBe(HEAT_COLOR_STOPS[2]);
    expect(pixels[11]).toBe(0);
  });

  it("atenúa los píxeles con poca cobertura en lugar de inventar certeza", () => {
    const pixels = heatmapPixels(raster, { low: 1.5, high: 1.9 });

    expect(pixels[3]).toBe(255);
    expect(pixels[7]).toBeGreaterThan(0);
    expect(pixels[7]).toBeLessThan(255);
  });
});

describe("imageCoordinates", () => {
  it("ordena las esquinas como espera MapLibre: NO, NE, SE, SO", () => {
    expect(
      imageCoordinates({ id: "x", west: -10, east: 5, south: 35, north: 44 }),
    ).toEqual([
      [-10, 44],
      [5, 44],
      [5, 35],
      [-10, 35],
    ]);
  });
});

describe("layerVisibility", () => {
  it("muestra solo las capas de la vista elegida", () => {
    const stations = layerVisibility("stations");
    const heat = layerVisibility("heat");

    expect(stations["station-points"]).toBe("visible");
    expect(stations["price-heat-peninsula"]).toBe("none");
    expect(heat["station-points"]).toBe("none");
    expect(heat["station-clusters"]).toBe("none");
    expect(heat["price-heat-peninsula"]).toBe("visible");
    expect(heat["price-heat-canarias"]).toBe("visible");
  });

  it("restaura exactamente las capas originales al volver a Estaciones", () => {
    expect(
      Object.entries(layerVisibility("stations"))
        .filter(([, visibility]) => visibility === "visible")
        .map(([id]) => id),
    ).toEqual([
      "station-cluster-halo",
      "station-clusters",
      "station-cluster-count",
      "station-points",
    ]);
  });
});

describe("color con filtros", () => {
  const station = (
    id: string,
    latitude: number,
    longitude: number,
    price: string,
    brand: string,
  ): Station => ({
    id,
    municipality_id: "001",
    municipality: "Municipio",
    locality: "Localidad",
    postal_code: "28001",
    address: "Calle",
    brand,
    opening_hours: null,
    location: { latitude, longitude },
    fuels: { gasoline_95_e5: price },
    provinceId: "28",
    provinceName: "MADRID",
  });
  const madridBrandA = Array.from({ length: 16 }, (_, index) =>
    station(
      `a${index}`,
      40.42 + (index % 4) * 0.1,
      -3.7 + Math.floor(index / 4) * 0.1,
      (1.6 + index * 0.02).toFixed(3),
      "A",
    ),
  );
  // Única estación de la marca B, aislada en Sevilla.
  const sevilleBrandB = station("b", 37.39, -5.98, "1.800", "B");

  it("pinta el mismo píxel con el mismo RGBA tras filtrar por marca", () => {
    const national = buildPriceHeatmap(
      [...madridBrandA, sevilleBrandB],
      "gasoline_95_e5",
    );
    const filtered = buildFilteredHeatmap(national, [sevilleBrandB], true);
    const [nationalRaster] = national.rasters;
    const [filteredRaster] = filtered.rasters;
    const nationalPixels = heatmapPixels(nationalRaster, national.scale!);
    const filteredPixels = heatmapPixels(filteredRaster, filtered.scale!);
    const covered = [...filteredRaster.values.keys()].filter(
      (index) => !Number.isNaN(filteredRaster.values[index]),
    );

    expect(covered.length).toBeGreaterThan(0);
    for (const index of covered) {
      expect([...filteredPixels.slice(index * 4, index * 4 + 4)]).toEqual([
        ...nationalPixels.slice(index * 4, index * 4 + 4),
      ]);
    }
  });
});
