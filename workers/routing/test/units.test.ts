import { describe, expect, it } from "vitest";

import { BudgetLedger, RoutingBudget, type ReserveInput } from "../src/budget";
import {
  autocompleteCost,
  CHARGE_GUARANTEE_CONFIRMED,
  chargePolicy,
  matrixActualCredits,
  matrixBaseCredits,
  matrixCost,
  NO_MODIFIERS,
  routeActualCredits,
  routeCost,
} from "../src/costs";
import { DEFAULT_LIMITS } from "../src/limits";
import { visitorId, visitorNetwork } from "../src/visitor";
import { sqliteStorage } from "./harness";

const leg = (km: number) => ({ distanceMeters: km * 1000, durationSeconds: 1 });

describe("coste de Geoapify", () => {
  it("aplica la fórmula publicada de la matriz", () => {
    // Ejemplo de la documentación: 5 orígenes y 7 destinos = 35 créditos.
    expect(matrixBaseCredits(5, 7)).toBe(35);
    expect(matrixBaseCredits(1, 15)).toBe(15);
    expect(matrixBaseCredits(20, 30)).toBe(300);
  });

  it("matriz y ruta no tienen cota previa: solo un mínimo", () => {
    expect(matrixCost(1, 15)).toEqual({
      kind: "unbounded",
      minimumCredits: 15,
    });
    expect(routeCost(2)).toEqual({ kind: "unbounded", minimumCredits: 1 });
    expect(autocompleteCost()).toEqual({ kind: "fixed", credits: 1 });
  });

  it("calcula el coste real con un recargo por cada 500 km de cada distancia", () => {
    expect(matrixActualCredits([[leg(10), null, leg(1200)]])).toBe(3 + 2);
    expect(matrixActualCredits([])).toBe(0);
    expect(routeActualCredits(leg(499), 2)).toBe(1);
    expect(routeActualCredits(leg(500), 2)).toBe(2);
    // Ejemplo de la documentación: 2 268 071 m cuestan 5 créditos.
    expect(routeActualCredits(leg(2268.071), 2)).toBe(5);
  });

  it("suma los recargos de evitación, detalles y elevación", () => {
    const matrixModifiers = {
      ...NO_MODIFIERS,
      avoidToggles: 2,
      excludedCountries: 1,
      avoidLocations: 21,
      avoidPolygons: 1,
    };
    // 15 base + 2 toggles + 1 país + ceil(21/20) = 2 lugares + 1 polígono.
    expect(matrixCost(1, 15, matrixModifiers)).toEqual({
      kind: "unbounded",
      minimumCredits: 21,
    });
    expect(matrixActualCredits([[leg(600)]], matrixModifiers)).toBe(1 + 6 + 1);

    const routeModifiers = {
      ...NO_MODIFIERS,
      avoidToggles: 1,
      avoidLocations: 50,
      routeDetails: true,
      elevation: true,
    };
    // Ejemplo de la documentación: 630 340 m con elevación y detalles = 4.
    expect(
      routeActualCredits(leg(630.34), 2, {
        ...NO_MODIFIERS,
        routeDetails: true,
        elevation: true,
      }),
    ).toBe(4);
    // 1 par + 1 toggle + 1 lote de lugares + 1 detalles + 1 elevación.
    expect(routeCost(2, routeModifiers)).toEqual({
      kind: "unbounded",
      minimumCredits: 5,
    });
  });
});

describe("política económica previa", () => {
  it("bloquea lo que no tiene cota salvo la garantía exacta del proveedor", () => {
    for (const guarantee of [
      undefined,
      "",
      "ninguna",
      "true",
      "sin-tarjeta",
      "CONFIRMADA-POR-ESCRITO",
      ` ${CHARGE_GUARANTEE_CONFIRMED}`,
    ]) {
      expect(chargePolicy(matrixCost(1, 15), guarantee)).toEqual({
        allowed: false,
        reason: "cost-unbounded",
      });
      expect(chargePolicy(routeCost(2), guarantee).allowed).toBe(false);
      expect(chargePolicy(autocompleteCost(), guarantee)).toEqual({
        allowed: true,
        reserveCredits: 1,
      });
    }
    expect(chargePolicy(routeCost(2), CHARGE_GUARANTEE_CONFIRMED)).toEqual({
      allowed: true,
      reserveCredits: 1,
    });
  });
});

describe("identificador del visitante", () => {
  it("normaliza IPv4 e IPv6 y descarta valores no válidos", () => {
    expect(visitorNetwork("203.0.113.9")).toBe("203.0.113.9");
    expect(visitorNetwork("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(visitorNetwork("2001:db8:1:2:3:4:5:6")).toBe(
      "2001:0db8:0001:0002::/64",
    );
    for (const invalid of [
      null,
      "",
      "256.1.1.1",
      "1.2.3",
      "2001:db8:::1",
      "1:2:3:4:5:6:7",
      "1::2::3",
      "2001:db8:12345::1",
      "texto",
    ]) {
      expect(visitorNetwork(invalid)).toBeNull();
    }
  });

  it("seudonimiza con el secreto y no conserva la IP", async () => {
    const id = await visitorId("203.0.113.9", "sal");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain("203");
    expect(await visitorId("203.0.113.9", "otra-sal")).not.toBe(id);
  });
});

describe("libro de presupuesto", () => {
  const input: ReserveInput = {
    visitor: "v",
    provider: "geoapify",
    action: "nearby",
    requestKey: "k",
    items: [{ endpoint: "matrix", credits: 10 }],
  };

  it("rechaza reservas mal formadas o fuera de los máximos", () => {
    const ledger = new BudgetLedger(sqliteStorage());
    for (const bad of [
      { ...input, visitor: "" },
      { ...input, provider: "openrouteservice" },
      { ...input, action: "borrar" },
      { ...input, items: [] },
      { ...input, items: [{ endpoint: "otro", credits: 1 }] },
      { ...input, items: [{ endpoint: "matrix", credits: 0 }] },
      { ...input, items: [{ endpoint: "matrix", credits: 1.5 }] },
      { ...input, items: [{ endpoint: "matrix", credits: 121 }] },
    ]) {
      expect(ledger.reserve(bad as ReserveInput)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("permite un solo reintento por operación", () => {
    const ledger = new BudgetLedger(sqliteStorage());
    expect(ledger.reserve({ ...input, action: "retry" })).toEqual({
      ok: false,
      reason: "retry-unavailable",
    });
    const first = ledger.reserve(input);
    expect(first.ok).toBe(true);
    if (first.ok) ledger.settle({ ids: first.ids, credits: [10] });
    expect(ledger.reserve({ ...input, action: "retry" }).ok).toBe(true);
    expect(ledger.reserve({ ...input, action: "retry" }).ok).toBe(false);
    expect(ledger.spent("geoapify")).toBe(20);
  });

  it("no acorta una pausa vigente ni acepta liquidaciones incoherentes", () => {
    let clock = 0;
    const ledger = new BudgetLedger(
      sqliteStorage(),
      DEFAULT_LIMITS,
      () => clock,
    );
    ledger.pause("geoapify", 10_000);
    ledger.pause("geoapify", 10);
    clock = 5000;
    expect(ledger.reserve(input)).toEqual({ ok: false, reason: "cooldown" });
    expect(() => ledger.pause("otro" as "geoapify", 1)).toThrow();
    expect(() => ledger.settle({ ids: [1], credits: [] })).toThrow();
    expect(() => ledger.settle({ ids: [1], credits: [-1] })).toThrow();
  });

  it("borra registros antiguos sin tocar los de la ventana vigente", () => {
    let clock = 0;
    const storage = sqliteStorage();
    const ledger = new BudgetLedger(storage, DEFAULT_LIMITS, () => clock);
    ledger.reserve(input);
    clock = DEFAULT_LIMITS.retentionMs + 1;
    ledger.reserve({ ...input, requestKey: "otra" });
    const rows = storage.sql
      .exec("SELECT COUNT(*) AS total FROM reservations")
      .toArray();
    expect(rows[0].total).toBe(1);
  });

  it("el Durable Object rechaza rutas internas desconocidas y cuerpos no válidos", async () => {
    const budget = new RoutingBudget({ storage: sqliteStorage() });
    const call = (path: string, body: string) =>
      budget.fetch(
        new Request(`https://budget.internal${path}`, { method: "POST", body }),
      );
    expect((await call("/otra", "{}")).status).toBe(404);
    expect((await call("/reserve", "no es json")).status).toBe(500);
    expect(
      (
        await call(
          "/pause",
          JSON.stringify({ provider: "geoapify", durationMs: 1 }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await call("/settle", JSON.stringify({ ids: [], credits: [] }))).status,
    ).toBe(200);
  });
});
