import { describe, expect, it } from "vitest";

import provinceFixture from "@/data/__fixtures__/province.test.json";
import { parseProvince } from "@/data/miteco";

import { filterAndSortStations, getBrands, getStationPrice } from "./stations";

const stations = parseProvince(provinceFixture).stations;

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
