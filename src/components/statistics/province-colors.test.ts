import { describe, expect, it } from "vitest";

import type { ProvinceStatistics } from "@/domain/fuel-statistics";

import {
  CHEAPER,
  MISSING,
  NEUTRAL,
  PRICIER,
  provinceFill,
} from "./province-colors";

const province = (absolute: number | null): ProvinceStatistics => ({
  id: "28",
  name: "MADRID",
  summary:
    absolute === null ? null : { mean: 1.6, min: 1.4, max: 1.8, count: 900 },
  sufficient: true,
  differenceFromNational:
    absolute === null ? null : { absolute, percent: absolute * 60 },
});

describe("provinceFill", () => {
  it("la mayor diferencia toma el color extremo", () => {
    expect(provinceFill(province(-0.1), 0.1)).toBe(CHEAPER);
    expect(provinceFill(province(0.1), 0.1)).toBe(PRICIER);
  });

  it("en la media queda el tono neutro", () => {
    expect(provinceFill(province(0), 0.1)).toBe(NEUTRAL);
  });

  it("a mitad de camino mezcla los dos colores", () => {
    expect(provinceFill(province(-0.05), 0.1)).toBe("#7eb89b");
  });

  it("sin precio usa el gris de «sin datos»", () => {
    expect(provinceFill(province(null), 0.1)).toBe(MISSING);
    expect(provinceFill(undefined, 0.1)).toBe(MISSING);
  });
});
