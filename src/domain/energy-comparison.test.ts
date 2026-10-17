import { describe, expect, it } from "vitest";

import { calculateEnergyComparison, EXAMPLE_INPUTS } from "./energy-comparison";

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
    expect(result!.gasolineVsElectricEuros).toBeCloseTo(840);
    expect(result!.gasolineVsElectricPercent).toBeCloseTo((840 / 1248) * 100);
  });

  it("admite que el eléctrico cueste más energía y muestra diferencias negativas", () => {
    const result = calculateEnergyComparison({
      ...EXAMPLE_INPUTS,
      electricPrice: 1,
    });
    expect(result!.gasolineVsElectricEuros).toBeLessThan(0);
    expect(result!.gasolineVsElectricPercent).toBeLessThan(0);
  });

  it("permite electricidad gratuita explícita sin dividir entre cero", () => {
    const result = calculateEnergyComparison({
      ...EXAMPLE_INPUTS,
      electricPrice: 0,
    });
    expect(result!.electric.annualEuros).toBe(0);
    expect(result!.dieselVsElectricPercent).toBe(100);
  });

  it.each([
    { annualKm: 0 },
    { annualKm: Number.NaN },
    { gasolinePrice: -1 },
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
