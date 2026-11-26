import { describe, expect, it } from "vitest";

import {
  classifyProfitability,
  costCandidate,
  dedicatedTripLeg,
  detourLeg,
  findInvalidRefuelInputs,
  isRefuelFuel,
  NEGLIGIBLE_SAVING_EUROS,
  quantityUnit,
  rankRefuelOptions,
  type RefuelAssumptions,
} from "./economics";

const assumptions: RefuelAssumptions = {
  fuel: "diesel_a",
  quantity: 40,
  consumptionPer100Km: 6,
};

const leg = (km: number, minutes: number) => ({
  distanceMeters: km * 1000,
  durationSeconds: minutes * 60,
});

// Referencia a 2 km; A compensa, B no por el desplazamiento y C apenas cambia nada.
const entries = [
  { station: { id: "ref" }, price: 1.5, attributable: leg(2, 4) },
  { station: { id: "a" }, price: 1.4, attributable: leg(10, 15) },
  { station: { id: "b" }, price: 1.49, attributable: leg(20, 25) },
  { station: { id: "c" }, price: 1.495, attributable: leg(3, 5) },
];

describe("coste de una candidata", () => {
  it("suma el repostaje y el combustible del desplazamiento valorado a su precio", () => {
    const cost = costCandidate(1.4, leg(10, 15), assumptions);
    expect(cost.fillCost).toBeCloseTo(56);
    expect(cost.travelFuel).toBeCloseTo(0.6);
    expect(cost.travelCost).toBeCloseTo(0.84);
    expect(cost.totalCost).toBeCloseTo(56.84);
  });

  it("no añade coste de desplazamiento si no hay kilómetros atribuibles", () => {
    const cost = costCandidate(1.5, leg(0, 0), assumptions);
    expect(cost.travelCost).toBe(0);
    expect(cost.totalCost).toBeCloseTo(60);
  });
});

describe("desplazamiento atribuible", () => {
  it("cuenta ida y vuelta en un desplazamiento solo para repostar", () => {
    expect(dedicatedTripLeg(leg(3, 5), leg(4, 6))).toEqual(leg(7, 11));
  });

  it("cuenta solo los kilómetros añadidos al viaje en un desvío", () => {
    expect(detourLeg(leg(100, 60), leg(40, 25), leg(63, 38))).toEqual(
      leg(3, 3),
    );
  });

  it("acota a cero un desvío negativo causado por el redondeo del proveedor", () => {
    expect(
      detourLeg(
        leg(100, 60),
        { distanceMeters: 49_990, durationSeconds: 1790 },
        { distanceMeters: 50_000, durationSeconds: 1800 },
      ),
    ).toEqual({ distanceMeters: 0, durationSeconds: 0 });
  });
});

describe("ordenación por rentabilidad", () => {
  const ranking = rankRefuelOptions(entries, assumptions)!;
  const byId = Object.fromEntries(
    ranking.options.map((option) => [option.station.id, option]),
  );

  it("toma como referencia la más cercana por carretera", () => {
    expect(ranking.referenceBasis).toBe("nearest");
    expect(ranking.reference.station.id).toBe("ref");
    expect(ranking.reference.profitability).toBe("reference");
    expect(ranking.reference.versusReference.netSaving).toBe(0);
  });

  it("separa ahorro bruto, coste adicional del desplazamiento y ahorro neto", () => {
    const { versusReference } = byId.a;
    expect(versusReference.grossSaving).toBeCloseTo(4);
    expect(versusReference.extraTravelCost).toBeCloseTo(0.66);
    expect(versusReference.netSaving).toBeCloseTo(3.34);
    expect(versusReference.extraDistanceMeters).toBe(8000);
    expect(versusReference.extraDurationSeconds).toBe(660);
    expect(byId.a.profitability).toBe("worthwhile");
  });

  it("muestra el ahorro negativo cuando el desplazamiento se come la diferencia", () => {
    expect(byId.b.versusReference.grossSaving).toBeGreaterThan(0);
    expect(byId.b.versusReference.netSaving).toBeCloseTo(-1.208);
    expect(byId.b.profitability).toBe("not-worthwhile");
    expect(byId.c.profitability).toBe("negligible");
  });

  it("ordena por coste total, que equivale a ahorro neto descendente", () => {
    expect(ranking.options.map(({ station }) => station.id)).toEqual([
      "a",
      "c",
      "ref",
      "b",
    ]);
  });

  it("usa la estación elegida como referencia si está entre las calculadas", () => {
    const selected = rankRefuelOptions(entries, assumptions, "b")!;
    expect(selected.referenceBasis).toBe("selected");
    expect(selected.reference.station.id).toBe("b");
    const ref = selected.options.find(({ station }) => station.id === "ref")!;
    expect(ref.versusReference.netSaving).toBeCloseTo(1.208);
  });

  it("vuelve a la más cercana si la elegida no tiene ruta", () => {
    expect(
      rankRefuelOptions(entries, assumptions, "desconocida")!.referenceBasis,
    ).toBe("nearest");
  });

  it("desempata la referencia por precio y no devuelve nada sin estaciones", () => {
    const tied = rankRefuelOptions(
      [
        { station: { id: "cara" }, price: 1.6, attributable: leg(2, 4) },
        { station: { id: "barata" }, price: 1.5, attributable: leg(2, 4) },
      ],
      assumptions,
    )!;
    expect(tied.reference.station.id).toBe("barata");
    expect(rankRefuelOptions([], assumptions)).toBeNull();
  });
});

describe("clasificación", () => {
  it("trata como irrelevante la diferencia dentro del margen", () => {
    expect(classifyProfitability(NEGLIGIBLE_SAVING_EUROS, false)).toBe(
      "negligible",
    );
    expect(classifyProfitability(-NEGLIGIBLE_SAVING_EUROS, false)).toBe(
      "negligible",
    );
    expect(classifyProfitability(0.51, false)).toBe("worthwhile");
    expect(classifyProfitability(-0.51, false)).toBe("not-worthwhile");
    expect(classifyProfitability(10, true)).toBe("reference");
  });
});

describe("supuestos del usuario", () => {
  it("usa la unidad del precio para cantidad y consumo", () => {
    expect(quantityUnit("diesel_a")).toBe("L");
    expect(quantityUnit("compressed_natural_gas")).toBe("kg");
    expect(quantityUnit("hydrogen")).toBe("kg");
  });

  it("excluye el AdBlue, que no mueve el vehículo", () => {
    expect(isRefuelFuel("adblue")).toBe(false);
    expect(isRefuelFuel("gasoline_95_e5")).toBe(true);
  });

  it("marca cantidades y consumos fuera de rango o no numéricos", () => {
    expect(findInvalidRefuelInputs(assumptions)).toEqual([]);
    expect(
      findInvalidRefuelInputs({
        ...assumptions,
        quantity: 0,
        consumptionPer100Km: Number.NaN,
      }),
    ).toEqual(["quantity", "consumptionPer100Km"]);
    expect(
      findInvalidRefuelInputs({ ...assumptions, consumptionPer100Km: 61 }),
    ).toEqual(["consumptionPer100Km"]);
  });
});
