import { describe, expect, it } from "vitest";

import {
  computeFuelStatistics,
  MIN_PROVINCE_SAMPLE,
  percentDifference,
  sortProvinces,
  summarizePrices,
  type StatisticsProvince,
} from "./fuel-statistics";
import type { FuelCode, Station } from "./stations";

let nextId = 0;

function station(fuels: Partial<Record<FuelCode, string>>): Station {
  nextId += 1;
  return {
    id: String(nextId),
    municipality_id: "001",
    municipality: "Municipio",
    locality: "Localidad",
    postal_code: "00000",
    address: "Calle",
    brand: null,
    opening_hours: null,
    location: { latitude: 40, longitude: -3.7 },
    fuels,
    provinceId: "00",
    provinceName: "PROVINCIA",
  };
}

function province(
  id: string,
  name: string,
  prices: (string | undefined)[],
  fuel: FuelCode = "gasoline_95_e5",
): StatisticsProvince {
  return {
    id,
    name,
    stations: prices.map((price) =>
      station(price === undefined ? {} : { [fuel]: price }),
    ),
  };
}

const full = (price: string) => Array(MIN_PROVINCE_SAMPLE).fill(price);

describe("summarizePrices", () => {
  it("calcula media, mínimo, máximo y tamaño de la muestra", () => {
    const summary = summarizePrices([1.5, 1.7, 1.6])!;
    expect(summary).toMatchObject({ min: 1.5, max: 1.7, count: 3 });
    expect(summary.mean).toBeCloseTo(1.6, 12);
  });

  it("no inventa una media sin precios", () => {
    expect(summarizePrices([])).toBeNull();
  });
});

describe("percentDifference", () => {
  it("expresa la diferencia respecto a la referencia en porcentaje", () => {
    expect(percentDifference(1.65, 1.5)).toBeCloseTo(10, 9);
    expect(percentDifference(1.35, 1.5)).toBeCloseTo(-10, 9);
  });

  it("no divide entre cero", () => {
    expect(percentDifference(1.5, 0)).toBeNull();
  });
});

describe("computeFuelStatistics", () => {
  it("calcula la media nacional con las estaciones, no promediando las medias provinciales", () => {
    // Provincia A: 10 estaciones a 1.500; provincia B: 30 estaciones a 1.900.
    // Media de estaciones: (15 + 57) / 40 = 1.8. Media de medias sería 1.7.
    const stats = computeFuelStatistics(
      [
        province("01", "A", full("1.500")),
        province("02", "B", Array(30).fill("1.900")),
      ],
      "gasoline_95_e5",
    );

    expect(stats.national!.mean).toBeCloseTo(1.8, 9);
    expect(stats.national!.count).toBe(40);
  });

  it("excluye precios ausentes o no positivos y cuenta las estaciones excluidas", () => {
    const stats = computeFuelStatistics(
      [province("01", "A", [...full("1.600"), undefined, "0", "-1", "abc"])],
      "gasoline_95_e5",
    );

    expect(stats.national!.count).toBe(10);
    expect(stats.national!.mean).toBeCloseTo(1.6, 12);
    expect(stats.provinces[0].summary!.count).toBe(10);
    expect(stats.excludedStations).toBe(4);
  });

  it("nunca mezcla combustibles", () => {
    const provinces = [
      {
        id: "01",
        name: "A",
        stations: Array.from({ length: MIN_PROVINCE_SAMPLE }, () =>
          station({ gasoline_95_e5: "1.700", diesel_a: "1.500" }),
        ),
      },
    ];

    expect(
      computeFuelStatistics(provinces, "gasoline_95_e5").national!.mean,
    ).toBeCloseTo(1.7, 9);
    expect(
      computeFuelStatistics(provinces, "diesel_a").national!.mean,
    ).toBeCloseTo(1.5, 9);
    expect(computeFuelStatistics(provinces, "gasoline_98_e5").national).toBe(
      null,
    );
  });

  it("deja sin valor las provincias sin datos y marca las muestras reducidas", () => {
    const stats = computeFuelStatistics(
      [
        province("01", "A", full("1.600")),
        province("51", "CEUTA", Array(MIN_PROVINCE_SAMPLE - 2).fill("1.400")),
        province("52", "MELILLA", [undefined, undefined]),
      ],
      "gasoline_95_e5",
    );
    const byName = Object.fromEntries(
      stats.provinces.map((item) => [item.name, item]),
    );

    expect(byName.A.sufficient).toBe(true);
    expect(byName.CEUTA).toMatchObject({ sufficient: false });
    expect(byName.CEUTA.summary!.count).toBe(MIN_PROVINCE_SAMPLE - 2);
    expect(byName.MELILLA).toMatchObject({
      summary: null,
      sufficient: false,
      differenceFromNational: null,
    });
  });

  it("elige la provincia más barata y la más cara solo entre muestras suficientes", () => {
    const stats = computeFuelStatistics(
      [
        province("01", "A", full("1.600")),
        province("02", "B", full("1.800")),
        province("03", "C", full("1.700")),
        // Más barata y más cara en apariencia, pero con muestra reducida.
        province("51", "CEUTA", ["1.200"]),
        province("52", "MELILLA", ["2.400"]),
      ],
      "gasoline_95_e5",
    );

    expect(stats.cheapest?.name).toBe("A");
    expect(stats.priciest?.name).toBe("B");
    expect(stats.spread!.absolute).toBeCloseTo(0.2, 9);
    expect(stats.spread!.percent).toBeCloseTo(12.5, 9);
  });

  it("calcula la diferencia de cada provincia frente a la media nacional", () => {
    const stats = computeFuelStatistics(
      [province("01", "A", full("1.500")), province("02", "B", full("1.700"))],
      "gasoline_95_e5",
    );

    expect(stats.national!.mean).toBeCloseTo(1.6, 9);
    expect(stats.provinces[0].differenceFromNational!.absolute).toBeCloseTo(
      -0.1,
      9,
    );
    expect(stats.provinces[0].differenceFromNational!.percent).toBeCloseTo(
      -6.25,
      9,
    );
    expect(stats.provinces[1].differenceFromNational!.percent).toBeCloseTo(
      6.25,
      9,
    );
  });

  it("conserva la precisión de los precios de la fuente", () => {
    const stats = computeFuelStatistics(
      [province("01", "A", ["1.459", "1.461", ...full("1.460").slice(2)])],
      "gasoline_95_e5",
    );

    expect(stats.national).toMatchObject({ min: 1.459, max: 1.461 });
    expect(stats.national!.mean).toBeCloseTo(1.46, 12);
  });

  it("no ofrece extremos ni diferencias si ninguna provincia tiene muestra suficiente", () => {
    const stats = computeFuelStatistics(
      [province("51", "CEUTA", ["1.400"]), province("52", "MELILLA", [])],
      "gasoline_95_e5",
    );

    expect(stats.national!.count).toBe(1);
    expect(stats).toMatchObject({
      cheapest: null,
      priciest: null,
      spread: null,
    });
  });
});

describe("sortProvinces", () => {
  const stats = computeFuelStatistics(
    [
      province("02", "Burgos", full("1.800")),
      province("01", "Álava", full("1.600")),
      province("03", "Cádiz", Array(20).fill("1.700")),
      province("52", "Melilla", []),
    ],
    "gasoline_95_e5",
  );
  const names = (sort: Parameters<typeof sortProvinces>[1]) =>
    sortProvinces(stats.provinces, sort).map((item) => item.name);

  it("ordena por precio en ambos sentidos con las provincias sin datos al final", () => {
    expect(names("price-asc")).toEqual(["Álava", "Cádiz", "Burgos", "Melilla"]);
    expect(names("price-desc")).toEqual([
      "Burgos",
      "Cádiz",
      "Álava",
      "Melilla",
    ]);
  });

  it("ordena alfabéticamente en español y por número de estaciones", () => {
    expect(names("name")).toEqual(["Álava", "Burgos", "Cádiz", "Melilla"]);
    // Burgos y Álava empatan a 10 estaciones: desempata el nombre.
    expect(names("stations")).toEqual(["Cádiz", "Álava", "Burgos", "Melilla"]);
  });

  it("no modifica la lista original", () => {
    const before = stats.provinces.map((item) => item.name);
    sortProvinces(stats.provinces, "price-desc");
    expect(stats.provinces.map((item) => item.name)).toEqual(before);
  });
});
