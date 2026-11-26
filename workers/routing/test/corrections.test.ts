import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { BudgetLedger, RoutingBudget, type ReserveInput } from "../src/budget";
import { handleRequest } from "../src/index";
import { DEFAULT_LIMITS } from "../src/limits";
import { createHarness, get, nearbyBody, post, sqliteStorage } from "./harness";

const input = (
  key: string,
  endpoint: "matrix" | "routing" | "autocomplete" = "matrix",
): ReserveInput => ({
  visitor: key,
  provider: "geoapify",
  action: "autocomplete",
  requestKey: key,
  items: [{ endpoint, credits: 1 }],
});
const matrix = () =>
  Response.json({ sources_to_targets: [[{ distance: 501_000, time: 3600 }]] });

describe("regresiones de contabilidad y concurrencia", () => {
  it("espera la matriz pendiente y reintenta únicamente la fallida, sin perder recargos", async () => {
    const h = createHarness();
    let calls = 0;
    let complete!: (response: Response) => void;
    let started!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetch = (async () => {
      calls++;
      if (calls === 1) return new Response("{}", { status: 503 });
      if (calls === 2) {
        started();
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      }
      return matrix();
    }) as typeof globalThis.fetch;
    const pending = handleRequest(post("/v1/legs", nearbyBody(1)), h.env, {
      fetch,
    });
    await secondStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(2);
    expect((await h.send(get("/v1/autocomplete?text=calle"))).status).toBe(429);
    expect(
      h.db
        .prepare(
          "SELECT COUNT(*) n FROM reservations WHERE status = 'in_flight'",
        )
        .get()?.n,
    ).toBe(1);
    complete(matrix());
    expect((await pending).status).toBe(200);
    expect(calls).toBe(3);
    expect(h.spent()).toBe(5);
  });

  it("una liquidación que no llega deja deuda persistente sin caducidad ni llamadas nuevas", async () => {
    const h = createHarness();
    const original = h.env.ROUTING_BUDGET.get;
    const stub = original("global");
    h.env.ROUTING_BUDGET.get = () => ({
      fetch: async (url, init) => {
        if (url.endsWith("/settle")) throw new Error("transporte caído");
        return stub.fetch(url, init);
      },
    });
    expect((await h.send(post("/v1/legs", nearbyBody(1)))).status).toBe(503);
    const calls = h.provider.stats().calls;
    h.advance(3 * 24 * 60 * 60_000);
    h.restart();
    expect((await h.send(get("/v1/autocomplete?text=calle"))).status).toBe(429);
    expect(h.provider.stats().calls).toBe(calls);
    expect(
      h.db
        .prepare(
          "SELECT COUNT(*) n FROM reservations WHERE status = 'in_flight'",
        )
        .get()?.n,
    ).toBe(2);
    expect(
      h.db
        .prepare("SELECT COUNT(*) n FROM reservations WHERE request_key != ''")
        .get()?.n,
    ).toBe(0);
  });

  it.each(["UPDATE reservations SET status", "INSERT INTO cooldowns"])(
    "reconcilia coste y pausa desde el diario tras fallar %s y reiniciar",
    (statement) => {
      const db = new DatabaseSync(":memory:");
      const storage = sqliteStorage(db);
      const exec = storage.sql.exec.bind(storage.sql);
      let failing = false;
      storage.sql.exec = (query, ...bindings) => {
        if (failing && query.includes(statement))
          throw new Error("escritura caída");
        return exec(query, ...bindings);
      };
      const ledger = new BudgetLedger(storage, DEFAULT_LIMITS, () => 1000);
      const reservation = ledger.reserve(input("uno"));
      if (!reservation.ok) throw new Error(reservation.reason);
      failing = true;
      expect(() =>
        ledger.settle({ ids: reservation.ids, credits: [7], pauseMs: 60_000 }),
      ).toThrow();
      expect(
        db.prepare("SELECT COUNT(*) n FROM pending_settlements").get()?.n,
      ).toBe(1);
      expect(() => ledger.reserve(input("dos"))).toThrow();
      failing = false;
      const restarted = new BudgetLedger(storage, DEFAULT_LIMITS, () => 1001);
      expect(restarted.reserve(input("dos"))).toEqual({
        ok: false,
        reason: "cooldown",
      });
      expect(restarted.spent("geoapify")).toBe(7);
      expect(
        db.prepare("SELECT COUNT(*) n FROM pending_settlements").get()?.n,
      ).toBe(0);
    },
  );

  it("el límite por segundo suma todos los endpoints y reintentos de forma atómica", () => {
    const storage = sqliteStorage();
    let clock = 1000;
    const ledger = new BudgetLedger(storage, DEFAULT_LIMITS, () => clock);
    const actions = [
      input("a", "matrix"),
      input("b", "routing"),
      input("c", "autocomplete"),
      input("d", "matrix"),
    ];
    for (const operation of actions) {
      const r = ledger.reserve(operation);
      if (!r.ok) throw new Error(r.reason);
      ledger.settle({ ids: r.ids, credits: [1] });
    }
    const retry = ledger.reserve({ ...actions[0], action: "retry" });
    if (!retry.ok) throw new Error(retry.reason);
    ledger.settle({ ids: retry.ids, credits: [1] });
    expect(ledger.reserve(input("e"))).toEqual({
      ok: false,
      reason: "global-second",
    });
    clock += 1000;
    expect(ledger.reserve(input("e")).ok).toBe(true);
  });

  it("la alarma elimina seudónimos sin tráfico y conserva una deuda sin identificadores", async () => {
    const db = new DatabaseSync(":memory:");
    const storage = sqliteStorage(db);
    let alarmAt: number | null = null;
    storage.setAlarm = async (at) => {
      alarmAt = at;
    };
    storage.deleteAlarm = async () => {
      alarmAt = null;
    };
    let clock = 1000;
    const budget = new RoutingBudget(
      { storage },
      undefined,
      DEFAULT_LIMITS,
      () => clock,
    );
    const response = await budget.fetch(
      new Request("https://budget/reserve", {
        method: "POST",
        body: JSON.stringify(input("seudonimo")),
      }),
    );
    expect(response.status).toBe(200);
    expect(alarmAt).toBe(clock + DEFAULT_LIMITS.retentionMs);
    clock += DEFAULT_LIMITS.retentionMs;
    const restarted = new RoutingBudget(
      { storage },
      undefined,
      DEFAULT_LIMITS,
      () => clock,
    );
    await restarted.alarm();
    expect(db.prepare("SELECT COUNT(*) n FROM visitor_events").get()?.n).toBe(
      0,
    );
    expect(
      db
        .prepare("SELECT COUNT(*) n FROM reservations WHERE request_key != ''")
        .get()?.n,
    ).toBe(0);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) n FROM reservations WHERE status = 'in_flight'",
        )
        .get()?.n,
    ).toBe(1);
    expect(alarmAt).toBeNull();
  });
});
