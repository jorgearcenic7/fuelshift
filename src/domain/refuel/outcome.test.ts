import { describe, expect, it } from "vitest";

import { rankRefuelOptions } from "./economics";
import {
  describeRefuelOutcome,
  rerankWithReference,
  SERVICE_DISABLED_NOTICE,
} from "./outcome";
import {
  ROUTING_LIMIT_MESSAGE,
  ROUTING_RATE_LIMIT_MESSAGE,
  RoutingError,
  type RoutingErrorKind,
} from "./road-routing";
import { testStation } from "./test-stations";

const freshness = { retrievedAt: "2026-11-26T08:00:00Z", stale: false };
const errorResult = (kind: RoutingErrorKind) => ({
  status: "error" as const,
  error: new RoutingError(kind, "x", "geoapify"),
});
const describe95 = (result: Parameters<typeof describeRefuelOutcome>[0]) =>
  describeRefuelOutcome(result, "gasoline_95_e5", "dedicated-trip");

describe("estados del resultado", () => {
  it("distingue servicio desactivado, cuota agotada y exceso de búsquedas", () => {
    expect(describe95(errorResult("disabled"))).toBe(SERVICE_DISABLED_NOTICE);
    expect(describe95(errorResult("quota-exceeded"))).toMatchObject({
      kind: "quota",
      message: ROUTING_LIMIT_MESSAGE,
    });
    expect(describe95(errorResult("rate-limited"))).toMatchObject({
      kind: "rate-limited",
      message: ROUTING_RATE_LIMIT_MESSAGE,
    });
  });

  it("agrupa los fallos técnicos y avisa con alerta", () => {
    for (const kind of [
      "unavailable",
      "timeout",
      "invalid-response",
      "unauthorized",
    ] as const) {
      expect(describe95(errorResult(kind))).toMatchObject({
        kind: "unavailable",
        role: "alert",
      });
    }
  });

  it("calla las cancelaciones y no avisa de un resultado correcto", () => {
    expect(describe95(errorResult("aborted"))).toBeNull();
  });

  it("explica entradas no válidas, territorios distintos y falta de rutas", () => {
    expect(
      describe95({ status: "invalid-input", fields: ["quantity", "origin"] })
        ?.message,
    ).toBe("Corrige: cantidad a repostar, origen.");
    expect(describe95(errorResult("invalid-request"))?.kind).toBe(
      "invalid-request",
    );
    expect(describe95(errorResult("no-route"))?.kind).toBe("no-route");
    expect(
      describe95({ status: "no-route", freshness, unreachable: [] })?.kind,
    ).toBe("no-route");
  });

  it("adapta la falta de candidatas a la modalidad", () => {
    const result = { status: "no-candidates" as const, freshness };
    expect(
      describeRefuelOutcome(result, "diesel_a", "detour")?.message,
    ).toContain("cerca de la ruta");
    expect(describe95(result)?.message).toContain("radio de búsqueda");
  });
});

describe("cambio de referencia", () => {
  const assumptions = {
    fuel: "diesel_a" as const,
    quantity: 40,
    consumptionPer100Km: 6,
  };
  const leg = (km: number) => ({
    distanceMeters: km * 1000,
    durationSeconds: km * 60,
  });
  const ranking = rankRefuelOptions(
    [
      {
        station: testStation("cerca", 40, -3),
        price: 1.6,
        attributable: leg(2),
      },
      {
        station: testStation("lejos", 40, -3),
        price: 1.4,
        attributable: leg(20),
      },
    ],
    assumptions,
  )!;

  it("recalcula sin nuevas rutas y conserva distancias y precios", () => {
    expect(ranking.reference.station.id).toBe("cerca");
    const changed = rerankWithReference(ranking, assumptions, "lejos");
    expect(changed.referenceBasis).toBe("selected");
    expect(changed.reference.station.id).toBe("lejos");
    const cerca = changed.options.find(
      ({ station }) => station.id === "cerca",
    )!;
    expect(cerca.cost.attributable.distanceMeters).toBe(2000);
    // Frente a «lejos», «cerca» cuesta 8 € más en precio y ahorra 18 km de viaje.
    expect(cerca.versusReference.grossSaving).toBeCloseTo(-8);
    expect(
      rerankWithReference(ranking, assumptions, null).reference.station.id,
    ).toBe("cerca");
  });
});
