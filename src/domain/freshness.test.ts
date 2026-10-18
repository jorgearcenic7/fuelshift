import { describe, expect, it } from "vitest";

import { isStale, STALE_AFTER_HOURS } from "./freshness";

const now = Date.parse("2026-10-18T12:00:00Z");
const hoursAgo = (hours: number) =>
  new Date(now - hours * 60 * 60 * 1000).toISOString();

describe("isStale", () => {
  it("considera obsoletos los datos de más de 48 horas", () => {
    expect(STALE_AFTER_HOURS).toBe(48);
    expect(isStale(hoursAgo(47), now)).toBe(false);
    expect(isStale(hoursAgo(49), now)).toBe(true);
  });

  it("interpreta fechas con microsegundos como las del manifiesto", () => {
    expect(isStale("2026-10-12T14:08:32.972321Z", now)).toBe(true);
  });

  it("no marca como obsoleta una fecha que no puede interpretar", () => {
    expect(isStale("fecha desconocida", now)).toBe(false);
  });
});
