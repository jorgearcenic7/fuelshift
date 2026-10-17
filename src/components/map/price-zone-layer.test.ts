import { describe, expect, it } from "vitest";

import type { PriceZone, PriceZoneMap } from "@/domain/price-zones";

import {
  classIntervals,
  classSpread,
  compactIntervals,
  describeZone,
  extremeZones,
  layerVisibility,
  toZoneGeoJson,
  zoneLabels,
} from "./price-zone-layer";

function priceZone(
  id: string,
  medianPrice: number | null,
  priceClass: PriceZone["priceClass"],
  stationCount = 4,
): PriceZone {
  return {
    id,
    place: `Municipio ${id}`,
    bounds: { west: -3.75, south: 40, east: -3.5, north: 40.2 },
    stationCount,
    medianPrice,
    minPrice: medianPrice === null ? null : medianPrice - 0.05,
    maxPrice: medianPrice === null ? null : medianPrice + 0.05,
    priceClass,
  };
}

const zoneMap: PriceZoneMap = {
  fuel: "diesel_a",
  zones: [
    priceZone("a", 1.4, 0),
    priceZone("b", 1.5, 1),
    priceZone("c", 1.6, 2),
    priceZone("d", null, null, 2),
  ],
  scale: {
    min: 1.4,
    lowerBreak: 1.45,
    upperBreak: 1.55,
    max: 1.6,
    zoneCount: 3,
  },
  stationCount: 14,
};

describe("layerVisibility", () => {
  it("muestra solo las capas de la vista elegida", () => {
    const stations = layerVisibility("stations");
    const zones = layerVisibility("zones");

    expect(stations["station-points"]).toBe("visible");
    expect(stations["price-zone-fill"]).toBe("none");
    expect(zones["station-points"]).toBe("none");
    expect(zones["station-clusters"]).toBe("none");
    expect(zones["price-zone-fill"]).toBe("visible");
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

describe("toZoneGeoJson", () => {
  it("convierte cada celda en un polígono cerrado con su clase", () => {
    const geoJson = toZoneGeoJson(zoneMap);

    expect(geoJson.features).toHaveLength(4);
    const [first] = geoJson.features;
    expect(first.properties).toEqual({ id: "a", priceClass: 0 });
    expect(first.geometry.coordinates[0]).toEqual([
      [-3.75, 40],
      [-3.5, 40],
      [-3.5, 40.2],
      [-3.75, 40.2],
      [-3.75, 40],
    ]);
    expect(geoJson.features[3].properties.priceClass).toBe(-1);
  });

  it("no dibuja nada sin datos", () => {
    expect(toZoneGeoJson(null).features).toEqual([]);
  });
});

describe("classIntervals", () => {
  it("describe intervalos semiabiertos con la precisión de la fuente", () => {
    expect(classIntervals(zoneMap.scale!)).toEqual({
      0: "hasta 1,450",
      1: "1,450 – 1,550",
      2: "más de 1,550",
    });
  });

  it("no inventa intervalos si todas las zonas tienen el mismo precio", () => {
    const flat = {
      min: 1.5,
      lowerBreak: 1.5,
      upperBreak: 1.5,
      max: 1.5,
      zoneCount: 4,
    };

    expect(classIntervals(flat)).toEqual({
      0: "sin zonas",
      1: "1,500 en todas las zonas",
      2: "sin zonas",
    });
  });
});

describe("describeZone", () => {
  it("resume precio mediano, clase, muestra y rango", () => {
    expect(describeZone(zoneMap.zones[0], "diesel_a")).toEqual({
      title: "Zona de Municipio a",
      lines: [
        "Precio mediano: 1,400 · Más barata",
        "4 estaciones con precio de Gasóleo A",
        "Rango: 1,350 – 1,450",
        "Cuadrícula centrada en 40,10° N, 3,63° O",
      ],
    });
  });

  it("explica una muestra insuficiente sin mostrar precios", () => {
    expect(describeZone(zoneMap.zones[3], "diesel_a")).toEqual({
      title: "Zona de Municipio d",
      lines: [
        "Datos insuficientes: 2 estaciones con precio de Gasóleo A (mínimo 3).",
        "No se calcula un precio representativo.",
        "Cuadrícula centrada en 40,10° N, 3,63° O",
      ],
    });
  });

  it("concuerda en singular con una sola estación", () => {
    expect(
      describeZone(priceZone("e", null, null, 1), "diesel_a").lines[0],
    ).toBe(
      "Datos insuficientes: 1 estación con precio de Gasóleo A (mínimo 3).",
    );
  });
});

describe("extremeZones", () => {
  it("lista las zonas más baratas y más caras sin incluir muestras insuficientes", () => {
    const { cheapest, priciest } = extremeZones(zoneMap, 2);

    expect(cheapest.map((zone) => zone.id)).toEqual(["a", "b"]);
    expect(priciest.map((zone) => zone.id)).toEqual(["c", "b"]);
  });
});

describe("zoneLabels", () => {
  const at = (
    id: string,
    place: string,
    bounds: PriceZone["bounds"],
  ): PriceZone => ({ ...priceZone(id, 1.5, 1), place, bounds });

  it("conserva el municipio cuando identifica una sola zona", () => {
    const labels = zoneLabels([
      at("a", "Getafe", { west: -3.75, south: 40.2, east: -3.5, north: 40.4 }),
    ]);

    expect(labels.get("a")).toBe("Getafe");
  });

  it("distingue con el centro de cada cuadrícula las zonas que comparten municipio", () => {
    const labels = zoneLabels([
      at("a", "San Bartolomé de Tirajana", {
        west: -15.75,
        south: 27.8,
        east: -15.5,
        north: 28,
      }),
      at("b", "San Bartolomé de Tirajana", {
        west: -15.75,
        south: 27.6,
        east: -15.5,
        north: 27.8,
      }),
      at("c", "Mahón", { west: 4.25, south: 39.8, east: 4.5, north: 40 }),
    ]);

    expect(labels.get("a")).toBe(
      "San Bartolomé de Tirajana (27,90° N, 15,63° O)",
    );
    expect(labels.get("b")).toBe(
      "San Bartolomé de Tirajana (27,70° N, 15,63° O)",
    );
    expect(labels.get("c")).toBe("Mahón");
  });

  it("usa la orientación este para longitudes positivas", () => {
    const labels = zoneLabels([
      at("a", "Mahón", { west: 4.25, south: 39.8, east: 4.5, north: 40 }),
      at("b", "Mahón", { west: 4, south: 39.8, east: 4.25, north: 40 }),
    ]);

    expect(labels.get("a")).toBe("Mahón (39,90° N, 4,38° E)");
  });
});

describe("compactIntervals", () => {
  it("abrevia los intervalos para la escala resumida", () => {
    expect(compactIntervals(zoneMap.scale!)).toEqual({
      0: "≤ 1,450",
      1: "1,450–1,550",
      2: "> 1,550",
    });
  });

  it("recurre al texto completo si todas las zonas tienen el mismo precio", () => {
    const flat = {
      min: 1.5,
      lowerBreak: 1.5,
      upperBreak: 1.5,
      max: 1.5,
      zoneCount: 2,
    };

    expect(compactIntervals(flat)).toEqual(classIntervals(flat));
  });
});

describe("classSpread", () => {
  it("cuantifica la anchura del tramo intermedio sin atribuir unidad", () => {
    expect(classSpread(zoneMap.scale!)).toBe("0,100");
  });

  it("no ofrece diferencia si todas las zonas tienen el mismo precio", () => {
    expect(
      classSpread({
        min: 1.5,
        lowerBreak: 1.5,
        upperBreak: 1.5,
        max: 1.5,
        zoneCount: 2,
      }),
    ).toBeNull();
  });
});
