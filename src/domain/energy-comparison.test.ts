import { describe, expect, it } from "vitest";

import {
  calculateEnergyComparison,
  EXAMPLE_INPUTS,
  findInvalidFields,
  INPUT_LIMITS,
  type EnergyField,
} from "./energy-comparison";

describe("calculateEnergyComparison", () => {
  it("calcula gasto por año y proyección con tres tipos de vehículo", () => {
    const result = calculateEnergyComparison(EXAMPLE_INPUTS);
    expect(result).not.toBeNull();
    expect(result!.gasoline.annualUnits).toBe(780);
    expect(result!.gasoline.annualEuros).toBeCloseTo(1248);
    expect(result!.diesel.annualEuros).toBeCloseTo(990);
    expect(result!.electric.annualUnits).toBe(2040);
    expect(result!.electric.annualEuros).toBeCloseTo(408);
    expect(result!.gasoline.periodEuros).toBeCloseTo(6240);
    expect(result!.electric.periodEuros).toBeCloseTo(2040);
  });

  it("calcula la diferencia del eléctrico en euros anuales, en el periodo y en porcentaje", () => {
    const result = calculateEnergyComparison(EXAMPLE_INPUTS);
    expect(result!.electricVs.gasoline.annualEuros).toBeCloseTo(840);
    expect(result!.electricVs.gasoline.periodEuros).toBeCloseTo(4200);
    expect(result!.electricVs.gasoline.percent).toBeCloseTo((840 / 1248) * 100);
    expect(result!.electricVs.diesel.annualEuros).toBeCloseTo(582);
    expect(result!.electricVs.diesel.periodEuros).toBeCloseTo(2910);
    expect(result!.electricVs.diesel.percent).toBeCloseTo((582 / 990) * 100);
  });

  it("admite que el eléctrico cueste más energía y muestra diferencias negativas", () => {
    const result = calculateEnergyComparison({
      ...EXAMPLE_INPUTS,
      electricPrice: 1,
    });
    expect(result!.electricVs.gasoline.annualEuros).toBeLessThan(0);
    expect(result!.electricVs.gasoline.periodEuros).toBeLessThan(0);
    expect(result!.electricVs.gasoline.percent).toBeLessThan(0);
  });

  it("permite electricidad gratuita explícita sin dividir entre cero", () => {
    const result = calculateEnergyComparison({
      ...EXAMPLE_INPUTS,
      electricPrice: 0,
    });
    expect(result!.electric.annualEuros).toBe(0);
    expect(result!.electricVs.diesel.percent).toBe(100);
  });

  it.each(["min", "max"] as const)(
    "acepta todos los valores en el límite %s",
    (bound) => {
      const inputs = { ...EXAMPLE_INPUTS };
      for (const field of Object.keys(inputs) as EnergyField[]) {
        inputs[field] = INPUT_LIMITS[field][bound];
      }
      expect(calculateEnergyComparison(inputs)).not.toBeNull();
    },
  );

  it.each([
    { annualKm: 0 },
    { annualKm: Number.NaN },
    { gasolinePrice: -1 },
    { gasolinePrice: 0 },
    { electricPrice: Infinity },
    { gasolineConsumption: 0 },
    { years: 1.5 },
    { years: 21 },
  ])("rechaza entradas inválidas: %j", (patch) => {
    expect(
      calculateEnergyComparison({ ...EXAMPLE_INPUTS, ...patch }),
    ).toBeNull();
  });
});

describe("findInvalidFields", () => {
  it("no devuelve campos para los valores de ejemplo", () => {
    expect(findInvalidFields(EXAMPLE_INPUTS)).toEqual([]);
  });

  it("identifica cada campo fuera de rango o no numérico", () => {
    expect(
      findInvalidFields({
        ...EXAMPLE_INPUTS,
        annualKm: 150_001,
        dieselPrice: Number.NaN,
        years: 2.5,
      }),
    ).toEqual(["annualKm", "years", "dieselPrice"]);
  });
});
