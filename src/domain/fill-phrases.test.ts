import { describe, expect, it } from "vitest";

import {
  describeFillHeadline,
  describeStationPrice,
  formatEuros,
  madridDate,
  mitecoDate,
  NBSP,
} from "./fill-phrases";

// Las frases llevan espacios duros; en las expectativas se escriben como «~».
const visible = (text: string | null) => text?.replaceAll(NBSP, "~") ?? null;

describe("formatEuros", () => {
  it("usa coma decimal, dos decimales y espacio duro antes de €", () => {
    expect(visible(formatEuros(64.95))).toBe("64,95~€");
    expect(visible(formatEuros(1234.5))).toBe("1234,50~€");
  });
});

describe("describeStationPrice", () => {
  it("compara con la media y calcula el coste de llenar 50 L", () => {
    expect(
      visible(
        describeStationPrice({
          price: 1.299,
          unit: "€/L",
          nationalMean: 1.61382,
        }),
      ),
    ).toBe(
      "0,315~€/L por debajo de la media nacional (1,614~€/L). Llenar 50~L cuesta 64,95~€, 15,75~€ menos que a precio medio.",
    );
  });

  it("dice «por encima» y «más» cuando la estación es más cara", () => {
    expect(
      visible(
        describeStationPrice({ price: 1.7, unit: "€/L", nationalMean: 1.6 }),
      ),
    ).toBe(
      "0,100~€/L por encima de la media nacional (1,600~€/L). Llenar 50~L cuesta 85,00~€, 5,00~€ más que a precio medio.",
    );
  });

  it("indica cuando el precio coincide con la media", () => {
    expect(
      visible(
        describeStationPrice({ price: 1.6, unit: "€/L", nationalMean: 1.6002 }),
      ),
    ).toBe(
      "Está en la media nacional (1,600~€/L). Llenar 50~L cuesta 80,00~€.",
    );
  });

  it("omite la comparación si no hay media fiable", () => {
    expect(
      visible(
        describeStationPrice({ price: 1.299, unit: "€/L", nationalMean: null }),
      ),
    ).toBe("Llenar 50~L cuesta 64,95~€.");
  });

  it("no habla de litros con precios por kilo", () => {
    expect(
      visible(
        describeStationPrice({ price: 1.2, unit: "€/kg", nationalMean: 1.3 }),
      ),
    ).toBe("0,100~€/kg por debajo de la media nacional (1,300~€/kg).");
    expect(
      describeStationPrice({ price: 1.2, unit: "€/kg", nationalMean: null }),
    ).toBeNull();
  });

  it("devuelve null con un precio no válido", () => {
    expect(
      describeStationPrice({ price: Number.NaN, unit: "€/L", nationalMean: 1 }),
    ).toBeNull();
  });
});

describe("describeFillHeadline", () => {
  const base = {
    fuelLabel: "Gasolina 95 E5",
    mean: 1.614,
    min: 1.277,
    max: 2.15,
    dataDate: "2026-11-15",
  };

  it("dice «hoy» si los datos son de hoy", () => {
    expect(
      visible(describeFillHeadline({ ...base, today: "2026-11-15" })),
    ).toBe(
      "Llenar 50~litros de Gasolina 95 E5 cuesta hoy 80,70~€ de media: entre 63,85~€ y 107,50~€.",
    );
  });

  it("dice la fecha si los datos son de otro día", () => {
    expect(
      visible(describeFillHeadline({ ...base, today: "2026-11-16" })),
    ).toBe(
      "Llenar 50~litros de Gasolina 95 E5 costaba el 15 de noviembre de 2026 80,70~€ de media: entre 63,85~€ y 107,50~€.",
    );
  });

  it("no dice «hoy» mientras no se conoce la fecha de la visita", () => {
    expect(visible(describeFillHeadline({ ...base, today: null }))).toBe(
      "Llenar 50~litros de Gasolina 95 E5 costaba el 15 de noviembre de 2026 80,70~€ de media: entre 63,85~€ y 107,50~€.",
    );
  });

  it("omite el rango si faltan mínimo y máximo", () => {
    expect(
      visible(
        describeFillHeadline({
          ...base,
          min: null,
          max: null,
          today: "2026-11-15",
        }),
      ),
    ).toBe("Llenar 50~litros de Gasolina 95 E5 cuesta hoy 80,70~€ de media.");
  });

  it("usa solo el extremo disponible", () => {
    expect(
      visible(
        describeFillHeadline({ ...base, max: null, today: "2026-11-15" }),
      ),
    ).toBe(
      "Llenar 50~litros de Gasolina 95 E5 cuesta hoy 80,70~€ de media: desde 63,85~€.",
    );
    expect(
      visible(
        describeFillHeadline({ ...base, min: null, today: "2026-11-15" }),
      ),
    ).toBe(
      "Llenar 50~litros de Gasolina 95 E5 cuesta hoy 80,70~€ de media: hasta 107,50~€.",
    );
  });

  it("sin media, deja solo el rango", () => {
    expect(
      visible(
        describeFillHeadline({ ...base, mean: null, today: "2026-11-15" }),
      ),
    ).toBe(
      "Llenar 50~litros de Gasolina 95 E5 cuesta hoy entre 63,85~€ y 107,50~€.",
    );
  });

  it("sin fecha de los datos, no afirma «hoy» ni una fecha", () => {
    expect(
      visible(describeFillHeadline({ ...base, dataDate: null, today: "x" })),
    ).toBe(
      "Llenar 50~litros de Gasolina 95 E5 cuesta 80,70~€ de media: entre 63,85~€ y 107,50~€.",
    );
  });

  it("devuelve null si no hay ningún dato", () => {
    expect(
      describeFillHeadline({
        ...base,
        mean: null,
        min: null,
        max: null,
        today: "2026-11-15",
      }),
    ).toBeNull();
  });
});

describe("fechas", () => {
  it("lee la fecha de MITECO", () => {
    expect(mitecoDate("15/11/2026 17:07:37")).toBe("2026-11-15");
    expect(mitecoDate("sin fecha")).toBeNull();
  });

  it("calcula el día en Madrid, no en UTC", () => {
    // 23:30 UTC del 15 es ya día 16 en Madrid (UTC+1 en noviembre).
    expect(madridDate(new Date("2026-11-15T23:30:00Z"))).toBe("2026-11-16");
  });
});
