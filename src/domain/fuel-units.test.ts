import { describe, expect, it } from "vitest";

import { FUEL_PRICE_UNITS, PRICE_UNIT_NAMES, priceUnit } from "./fuel-units";
import { FUEL_LABELS, PRIMARY_FUELS, type FuelCode } from "./stations";

// Anexo I.1.1 vigente (Resolución de 5 de diciembre de 2025): estos son los
// únicos productos de FuelShift que se dan en euros por kilogramo.
const PER_KILOGRAM: FuelCode[] = [
  "compressed_natural_gas",
  "liquefied_natural_gas",
  "compressed_natural_biogas",
  "liquefied_natural_biogas",
  "hydrogen",
  "methanol",
  "ammonia",
];

describe("priceUnit", () => {
  it("expresa en €/L los tres carburantes principales", () => {
    for (const fuel of PRIMARY_FUELS) expect(priceUnit(fuel)).toBe("€/L");
  });

  it("da en €/kg exactamente los gases, el hidrógeno, el metanol y el amoniaco", () => {
    const perKilogram = (Object.keys(FUEL_PRICE_UNITS) as FuelCode[]).filter(
      (fuel) => priceUnit(fuel) === "€/kg",
    );
    expect(perKilogram.sort()).toEqual([...PER_KILOGRAM].sort());
  });

  it("da en €/L el resto, incluidos AdBlue, renovables y variantes premium", () => {
    for (const fuel of [
      "adblue",
      "renewable_diesel",
      "renewable_gasoline",
      "gasoline_95_e25",
      "gasoline_95_e85",
      "biodiesel",
      "bioethanol",
      "premium_diesel",
      "premium_gasoline_95_e5",
      "liquefied_petroleum_gas",
    ] satisfies FuelCode[]) {
      expect(priceUnit(fuel)).toBe("€/L");
    }
  });

  it("asigna unidad a todos los productos y a ninguno más", () => {
    expect(Object.keys(FUEL_PRICE_UNITS).sort()).toEqual(
      Object.keys(FUEL_LABELS).sort(),
    );
  });

  it("ofrece una lectura completa de cada unidad", () => {
    expect(PRICE_UNIT_NAMES["€/L"]).toBe("euros por litro");
    expect(PRICE_UNIT_NAMES["€/kg"]).toBe("euros por kilogramo");
  });
});
