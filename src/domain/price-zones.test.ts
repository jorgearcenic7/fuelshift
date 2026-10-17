import { describe, expect, it } from "vitest";

import {
  buildPriceZones,
  classifyPrice,
  median,
  MIN_ZONE_STATIONS,
  type PriceScale,
} from "./price-zones";
import type { FuelCode, Station } from "./stations";

let nextId = 0;

function station(
  latitude: number,
  longitude: number,
  fuels: Partial<Record<FuelCode, string>>,
): Station {
  nextId += 1;
  return {
    id: String(nextId),
    municipality_id: "001",
    municipality: "Municipio",
    locality: "Localidad",
    postal_code: "28001",
    address: "Calle",
    brand: null,
    opening_hours: null,
    location: { latitude, longitude },
    fuels,
    provinceId: "28",
    provinceName: "MADRID",
  };
}

/** Tres estaciones con el mismo precio dentro de la celda de (lat, lon). */
function zone(latitude: number, longitude: number, prices: string[]) {
  return prices.map((price, index) =>
    station(latitude + index * 0.01, longitude + index * 0.01, {
      gasoline_95_e5: price,
    }),
  );
}

// Seis celdas suficientes con medianas 1.40 … 1.65 (paso 0.05).
const sixZones = [1.4, 1.45, 1.5, 1.55, 1.6, 1.65].flatMap((price, index) =>
  zone(36.05 + index, -5.95, Array(MIN_ZONE_STATIONS).fill(price.toFixed(3))),
);

describe("median", () => {
  it("devuelve el valor central con un número impar de precios", () => {
    expect(median([1.5, 1.3, 1.4])).toBe(1.4);
  });

  it("promedia los dos centrales con un número par sin modificar la entrada", () => {
    const values = [1.6, 1.2, 1.4, 1.3];
    expect(median(values)).toBeCloseTo(1.35);
    expect(values).toEqual([1.6, 1.2, 1.4, 1.3]);
  });

  it("no inventa un valor sin precios", () => {
    expect(median([])).toBeNull();
  });
});

describe("buildPriceZones", () => {
  it("agrupa por celda y calcula mediana, recuento y rango", () => {
    const result = buildPriceZones(
      zone(40.05, -3.75, ["1.500", "1.400", "1.450"]),
      "gasoline_95_e5",
    );

    expect(result.zones).toHaveLength(1);
    expect(result.zones[0]).toMatchObject({
      stationCount: 3,
      medianPrice: 1.45,
      minPrice: 1.4,
      maxPrice: 1.5,
    });
    expect(result.stationCount).toBe(3);
  });

  it("devuelve los límites geográficos de la celda que contiene las estaciones", () => {
    const [cell] = buildPriceZones(
      zone(40.05, -3.75, ["1.5", "1.5", "1.5"]),
      "gasoline_95_e5",
    ).zones;

    expect(cell.bounds.south).toBeLessThanOrEqual(40.05);
    expect(cell.bounds.north).toBeGreaterThan(40.07);
    expect(cell.bounds.west).toBeLessThanOrEqual(-3.75);
    expect(cell.bounds.east).toBeGreaterThan(-3.73);
  });

  it("marca como insuficiente una zona con menos estaciones que el mínimo", () => {
    const result = buildPriceZones(
      zone(40.05, -3.75, ["1.300", "1.900"]),
      "gasoline_95_e5",
    );

    expect(result.zones[0]).toMatchObject({
      stationCount: 2,
      medianPrice: null,
      minPrice: null,
      maxPrice: null,
      priceClass: null,
    });
    expect(result.scale).toBeNull();
  });

  it("calcula cada combustible por separado y nunca los mezcla", () => {
    const stations = [
      ...[1.4, 1.5, 1.6].map((price) =>
        station(40.05, -3.75, {
          gasoline_95_e5: price.toFixed(3),
          diesel_a: "1.100",
        }),
      ),
      station(40.06, -3.74, { diesel_a: "1.200" }),
    ];

    const gasoline = buildPriceZones(stations, "gasoline_95_e5");
    const diesel = buildPriceZones(stations, "diesel_a");

    expect(gasoline.fuel).toBe("gasoline_95_e5");
    expect(gasoline.zones[0]).toMatchObject({
      stationCount: 3,
      medianPrice: 1.5,
    });
    expect(diesel.zones[0]).toMatchObject({
      stationCount: 4,
      medianPrice: 1.1,
    });
    expect(buildPriceZones(stations, "gasoline_98_e5").zones).toEqual([]);
  });

  it("ignora precios ausentes, no numéricos o no positivos", () => {
    const stations = [
      ...zone(40.05, -3.75, ["1.400", "1.500", "1.600"]),
      station(40.05, -3.75, { gasoline_95_e5: "abc" }),
      station(40.05, -3.75, { gasoline_95_e5: "0" }),
      station(40.05, -3.75, { gasoline_95_e5: "-1.2" }),
      station(40.05, -3.75, {}),
    ];

    const result = buildPriceZones(stations, "gasoline_95_e5");

    expect(result.stationCount).toBe(3);
    expect(result.zones[0]).toMatchObject({
      stationCount: 3,
      medianPrice: 1.5,
    });
  });

  it("usa la mediana para que un valor extremo no arrastre la zona", () => {
    const result = buildPriceZones(
      zone(40.05, -3.75, ["1.400", "1.410", "1.420", "1.430", "9.990"]),
      "gasoline_95_e5",
    );

    expect(result.zones[0].medianPrice).toBe(1.42);
    expect(result.zones[0].maxPrice).toBe(9.99);
  });

  it("clasifica las zonas por tercios de sus medianas nacionales", () => {
    const result = buildPriceZones(sixZones, "gasoline_95_e5");

    expect(result.scale).toMatchObject({ min: 1.4, max: 1.65, zoneCount: 6 });
    expect(result.scale!.lowerBreak).toBeCloseTo(1.4833, 3);
    expect(result.scale!.upperBreak).toBeCloseTo(1.5667, 3);
    expect(
      result.zones.map((item) => [item.medianPrice, item.priceClass]),
    ).toEqual([
      [1.4, 0],
      [1.45, 0],
      [1.5, 1],
      [1.55, 1],
      [1.6, 2],
      [1.65, 2],
    ]);
  });

  it("excluye de la escala las zonas con muestra insuficiente", () => {
    const withSparseOutliers = [
      ...sixZones,
      ...zone(43.05, -8.05, ["0.500", "0.600"]),
      ...zone(28.45, -16.25, ["3.000"]),
    ];

    const result = buildPriceZones(withSparseOutliers, "gasoline_95_e5");

    expect(result.scale).toEqual(
      buildPriceZones(sixZones, "gasoline_95_e5").scale,
    );
    expect(
      result.zones.filter((item) => item.priceClass === null),
    ).toHaveLength(2);
  });

  it("no depende del orden de las estaciones, solo del conjunto nacional", () => {
    const shuffled = [...sixZones].reverse();
    shuffled.push(shuffled.shift()!);

    expect(buildPriceZones(shuffled, "gasoline_95_e5")).toEqual(
      buildPriceZones(sixZones, "gasoline_95_e5"),
    );
  });

  it("nombra la zona por el municipio con más estaciones y desempata alfabéticamente", () => {
    const [first, second, third] = zone(40.05, -3.75, ["1.4", "1.5", "1.6"]);
    const named = (municipalities: string[]) =>
      buildPriceZones(
        [first, second, third].map((item, index) => ({
          ...item,
          municipality: municipalities[index],
        })),
        "gasoline_95_e5",
      ).zones[0].place;

    expect(named(["Getafe", "Leganés", "Leganés"])).toBe("Leganés");
    expect(named(["Pinto", "Getafe", "Valdemoro"])).toBe("Getafe");
  });

  it("no devuelve zonas sin estaciones con precio", () => {
    expect(buildPriceZones([], "diesel_a")).toEqual({
      fuel: "diesel_a",
      zones: [],
      scale: null,
      stationCount: 0,
    });
  });
});

describe("classifyPrice", () => {
  const scale: PriceScale = {
    min: 1.3,
    lowerBreak: 1.4,
    upperBreak: 1.5,
    max: 1.6,
    zoneCount: 9,
  };

  it("usa intervalos semiabiertos: ≤ inferior, intermedio, > superior", () => {
    expect(classifyPrice(1.3, scale)).toBe(0);
    expect(classifyPrice(1.4, scale)).toBe(0);
    expect(classifyPrice(1.4001, scale)).toBe(1);
    expect(classifyPrice(1.5, scale)).toBe(1);
    expect(classifyPrice(1.5001, scale)).toBe(2);
  });

  it("asigna la clase intermedia si todas las zonas tienen el mismo precio", () => {
    const flat = {
      ...scale,
      min: 1.5,
      lowerBreak: 1.5,
      upperBreak: 1.5,
      max: 1.5,
    };

    expect(classifyPrice(1.5, flat)).toBe(1);
  });
});
