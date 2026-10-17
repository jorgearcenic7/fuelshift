import { describe, expect, it } from "vitest";

import provinceFixture from "@/data/__fixtures__/province.test.json";
import { parseProvince } from "@/data/miteco";

import {
  filterAndSortStations,
  getBrands,
  getStationPrice,
  rankByPrice,
  type Station,
} from "./stations";

const stations = parseProvince(provinceFixture).stations;

function withPrice(base: Station, id: string, price: string): Station {
  return { ...base, id, fuels: { ...base.fuels, diesel_a: price } };
}

describe("ranking por precio", () => {
  const candidates = [
    withPrice(stations[0], "a", "1.500"),
    withPrice(stations[1], "b", "1.400"),
    withPrice(stations[0], "c", "1.400"),
    withPrice(stations[1], "d", "1.600"),
    // Sin precio para el combustible: no participa.
    { ...stations[1], id: "e", fuels: { gasoline_95_e5: "1.300" } },
  ];

  it("ordena de menor a mayor precio y comparte puesto en los empates", () => {
    const ranking = rankByPrice(candidates, "diesel_a", 3);

    expect(ranking.total).toBe(4);
    expect(
      ranking.entries.map(({ station, position }) => [station.id, position]),
    ).toEqual([
      ["b", 1],
      ["c", 1],
      ["a", 3],
    ]);
  });

  it("limita el ranking a la zona visible del mapa", () => {
    // Solo incluye la estación de Alcalá de Henares (stations[1]).
    const bounds = { west: -3.4, south: 40.45, east: -3.3, north: 40.5 };
    const ranking = rankByPrice(candidates, "diesel_a", 5, bounds);

    expect(ranking.total).toBe(2);
    expect(ranking.entries.map(({ station }) => station.id)).toEqual([
      "b",
      "d",
    ]);
  });

  it("devuelve un ranking vacío si no hay precios en el ámbito", () => {
    expect(rankByPrice(candidates, "hydrogen", 5)).toEqual({
      entries: [],
      total: 0,
    });
  });
});

describe("consulta de estaciones", () => {
  it("selecciona el precio del combustible exacto del contrato", () => {
    expect(getStationPrice(stations[0], "gasoline_98_e5")).toBe(1.699);
    expect(getStationPrice(stations[1], "gasoline_98_e5")).toBeNull();
  });

  it("busca sin distinguir mayúsculas ni tildes en municipio, marca y dirección", () => {
    const base = {
      fuel: "gasoline_95_e5" as const,
      brand: "",
      minPrice: null,
      maxPrice: null,
    };

    expect(
      filterAndSortStations(
        stations,
        { ...base, search: "alcala" },
        "price",
        null,
      ),
    ).toHaveLength(1);
    expect(
      filterAndSortStations(
        stations,
        { ...base, search: "marca test" },
        "price",
        null,
      )[0].id,
    ).toBe("test-101");
    expect(
      filterAndSortStations(
        stations,
        { ...base, search: "ficticia" },
        "price",
        null,
      )[0].id,
    ).toBe("test-102");
  });

  it("filtra por marca y rango y ordena por precio", () => {
    const results = filterAndSortStations(
      stations,
      {
        fuel: "gasoline_95_e5",
        search: "",
        brand: "MARCA TEST",
        minPrice: 1.4,
        maxPrice: 1.5,
      },
      "price",
      null,
    );

    expect(results.map((station) => station.id)).toEqual(["test-101"]);
    expect(getBrands(stations, "gasoline_95_e5")).toEqual(["MARCA TEST"]);
  });

  it("aplica el rango de precio con límites inclusivos", () => {
    const priced = [
      withPrice(stations[0], "a", "1.300"),
      withPrice(stations[0], "b", "1.400"),
      withPrice(stations[0], "c", "1.500"),
    ];
    const ids = (minPrice: number | null, maxPrice: number | null) =>
      filterAndSortStations(
        priced,
        { fuel: "diesel_a", search: "", brand: "", minPrice, maxPrice },
        "price",
        null,
      ).map((station) => station.id);

    expect(ids(1.4, null)).toEqual(["b", "c"]);
    expect(ids(null, 1.4)).toEqual(["a", "b"]);
    expect(ids(1.4, 1.4)).toEqual(["b"]);
  });

  it("desempata por municipio cuando coincide el precio", () => {
    const tied = [
      withPrice(stations[0], "madrid", "1.400"),
      withPrice(stations[1], "alcala", "1.400"),
    ];
    const results = filterAndSortStations(
      tied,
      {
        fuel: "diesel_a",
        search: "",
        brand: "",
        minPrice: null,
        maxPrice: null,
      },
      "price",
      null,
    );

    expect(results.map((station) => station.id)).toEqual(["alcala", "madrid"]);
  });

  it("excluye estaciones sin precio para el combustible elegido", () => {
    const results = filterAndSortStations(
      stations,
      {
        fuel: "gasoline_98_e5",
        search: "",
        brand: "",
        minPrice: null,
        maxPrice: null,
      },
      "price",
      null,
    );

    expect(results.map((station) => station.id)).toEqual(["test-101"]);
  });

  it("mantiene el orden por precio si se pide distancia sin ubicación", () => {
    const results = filterAndSortStations(
      stations,
      {
        fuel: "diesel_a",
        search: "",
        brand: "",
        minPrice: null,
        maxPrice: null,
      },
      "distance",
      null,
    );

    expect(results.map((station) => station.id)).toEqual([
      "test-101",
      "test-102",
    ]);
    expect(results[0].distanceKm).toBeNull();
  });

  it("ordena por distancia solo cuando existe ubicación consentida", () => {
    const filters = {
      fuel: "diesel_a" as const,
      search: "",
      brand: "",
      minPrice: null,
      maxPrice: null,
    };
    const results = filterAndSortStations(stations, filters, "distance", {
      latitude: 40.48,
      longitude: -3.36,
    });

    expect(results.map((station) => station.id)).toEqual([
      "test-102",
      "test-101",
    ]);
    expect(results[0].distanceKm).toBeLessThan(results[1].distanceKm!);
  });
});
