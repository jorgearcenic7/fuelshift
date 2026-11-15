import { describe, expect, it, vi } from "vitest";

import {
  fetchMonthlyHistory,
  fetchMonthlyManifest,
  MITECO_HISTORY_SOURCE,
  parseMonthlyHistory,
  parseMonthlyManifest,
} from "./monthly-history";

const manifest = () => ({
  schema_version: "1.0.0",
  generation: "a".repeat(20),
  frequency: "monthly-snapshot",
  unit: "EUR/L",
  sample_day: 1,
  source_url: MITECO_HISTORY_SOURCE,
  first_date: "2007-01-01",
  last_date: "2007-03-01",
  retrieved_at: "2026-11-15T12:00:00Z",
  scopes: [
    { id: "ES", name: "España" },
    ...Array.from({ length: 52 }, (_, i) => ({
      id: String(i + 1).padStart(2, "0"),
      name: `Provincia ${i + 1}`,
    })),
  ],
  fuels: ["gasoline_95_e5", "gasoline_98_e5", "diesel_a"],
  sample_count: 2,
  expected_count: 3,
});
const series = () => ({
  schema_version: "1.0.0",
  scope: "ES",
  fuel: "diesel_a",
  frequency: "monthly-snapshot",
  unit: "EUR/L",
  observations: [
    ["2007-01-01", 1.2, 10],
    ["2007-02-01", null, 0],
    ["2007-03-01", 1.5, 20],
  ],
});

describe("contrato mensual", () => {
  it("conserva huecos y recuentos reales", () => {
    const parsed = parseMonthlyHistory(
      series(),
      parseMonthlyManifest(manifest()),
      "ES",
      "diesel_a",
    );
    expect(parsed.points).toHaveLength(2);
    expect(parsed.points[0]).toEqual({
      date: "2007-01-01",
      price: 1.2,
      count: 10,
    });
    expect(parsed.missingDates).toEqual(["2007-02-01"]);
    const empty = series();
    empty.observations = empty.observations.map((item) => [item[0], null, 0]);
    expect(
      parseMonthlyHistory(
        empty,
        parseMonthlyManifest(manifest()),
        "ES",
        "diesel_a",
      ).points,
    ).toEqual([]);
  });
  it.each([
    null,
    [],
    {},
    { ...manifest(), schema_version: "2" },
    { ...manifest(), frequency: "daily" },
    { ...manifest(), unit: "EUR/1000L" },
    { ...manifest(), generation: "../other" },
    { ...manifest(), fuels: [] },
    { ...manifest(), first_date: "2006-01-01" },
    { ...manifest(), last_date: "2007-13-01" },
    { ...manifest(), last_date: "2007-02-29" },
    { ...manifest(), scopes: [] },
    { ...manifest(), retrieved_at: "yesterday" },
    { ...manifest(), retrieved_at: "2006-01-01T00:00:00Z" },
    { ...manifest(), sample_count: -1 },
    { ...manifest(), expected_count: 4 },
    { ...manifest(), sample_count: 4 },
    {
      ...manifest(),
      scopes: manifest().scopes.map(() => ({ id: "ES", name: "España" })),
    },
  ])("rechaza manifiesto inválido %#", (raw) => {
    expect(() => parseMonthlyManifest(raw)).toThrow();
  });
  it.each([
    null,
    { ...series(), scope: "28" },
    { ...series(), fuel: "gasoline_95_e5" },
    { ...series(), observations: [] },
    {
      ...series(),
      observations: [
        ["2007-01-01", 1, 1],
        ["2007-03-01", 1, 1],
        ["2007-02-01", 1, 1],
      ],
    },
    ...[
      ["2007-01-01", null, 1],
      ["2007-01-01", 0, 1],
      ["2007-01-01", Infinity, 1],
      ["2007-01-01", 1, 0],
      ["2007-01-01", 1, 1.5],
      ["2007-01-01", 1],
      ["2007-00-01", 1, 1],
    ].map((item) => ({
      ...series(),
      observations: [item, ...series().observations.slice(1)],
    })),
  ])("rechaza serie inválida %#", (raw) => {
    expect(() =>
      parseMonthlyHistory(
        raw,
        parseMonthlyManifest(manifest()),
        "ES",
        "diesel_a",
      ),
    ).toThrow();
  });
  it("maneja 404, HTTP, selección y descarga por ámbito y combustible", async () => {
    expect(
      await fetchMonthlyManifest(
        vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
      ),
    ).toBeNull();
    await expect(
      fetchMonthlyManifest(
        vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
      ),
    ).rejects.toThrow();
    const getManifest = vi.fn().mockResolvedValue(Response.json(manifest()));
    const m = (await fetchMonthlyManifest(getManifest))!;
    expect(getManifest.mock.calls[0][0]).toBe(
      "/data/historico-miteco/manifest.json",
    );
    const getSeries = vi.fn().mockResolvedValue(Response.json(series()));
    expect(
      (await fetchMonthlyHistory(m, "ES", "diesel_a", getSeries)).points,
    ).toHaveLength(2);
    expect(getSeries.mock.calls[0][0]).toContain(
      `/sets/${"a".repeat(20)}/ES/diesel_a.json`,
    );
    await expect(
      fetchMonthlyHistory(m, "../../x", "diesel_a", getSeries),
    ).rejects.toThrow();
    await expect(
      fetchMonthlyHistory(
        m,
        "ES",
        "diesel_a",
        vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
      ),
    ).rejects.toThrow();
  });
});
