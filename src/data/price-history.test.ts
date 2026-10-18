import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DataContractError } from "./miteco";
import { loadPriceHistory, parsePriceHistory } from "./price-history";

const fuel = {
  national: { mean: 1.8, min: 1.5, max: 2.1, count: 9_000 },
  provinces: { "28": { mean: 1.79, count: 700 } },
};
const entry = (date: string) => ({
  date,
  retrieved_at: `${date}T14:00:00Z`,
  reported_at: "12/10/2026 16:07:31",
  station_count: 11_000,
  province_count: 52,
  fuels: { gasoline_95_e5: fuel, gasoline_98_e5: fuel, diesel_a: fuel },
});
const valid = {
  schema_version: "1.0.0",
  source: {
    attribution: "MITECO",
    catalog: "https://example.invalid",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
  },
  entries: [entry("2026-10-12"), entry("2026-10-13")],
};

describe("parsePriceHistory", () => {
  it("acepta el formato generado por scripts/price-history.mjs", () => {
    const parsed = parsePriceHistory(valid);

    expect(parsed.entries.map((item) => item.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
    ]);
    expect(parsed.entries[0].fuels.diesel_a?.provinces["28"].count).toBe(700);
  });

  it.each([
    ["otra versión", { ...valid, schema_version: "2.0.0" }],
    [
      "fechas repetidas",
      { ...valid, entries: [entry("2026-10-12"), entry("2026-10-12")] },
    ],
    [
      "fechas desordenadas",
      { ...valid, entries: [entry("2026-10-13"), entry("2026-10-12")] },
    ],
    [
      "una media no válida",
      {
        ...valid,
        entries: [
          {
            ...entry("2026-10-12"),
            fuels: {
              ...entry("2026-10-12").fuels,
              diesel_a: { ...fuel, national: { ...fuel.national, mean: -1 } },
            },
          },
        ],
      },
    ],
    ["sin procedencia", { ...valid, source: null }],
    [
      "una provincia con identificador no válido",
      {
        ...valid,
        entries: [
          {
            ...entry("2026-10-12"),
            fuels: {
              ...entry("2026-10-12").fuels,
              diesel_a: {
                ...fuel,
                provinces: { "1": { mean: 1.8, count: 5 } },
              },
            },
          },
        ],
      },
    ],
    [
      "un combustible incompleto",
      {
        ...valid,
        entries: [
          {
            ...entry("2026-10-12"),
            fuels: { ...entry("2026-10-12").fuels, diesel_a: { national: {} } },
          },
        ],
      },
    ],
    [
      "un recuento no entero",
      {
        ...valid,
        entries: [{ ...entry("2026-10-12"), station_count: 10.5 }],
      },
    ],
  ])("rechaza %s", (_reason, value) => {
    expect(() => parsePriceHistory(value)).toThrow(DataContractError);
  });
});

describe("loadPriceHistory", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "fuelshift-historico-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("devuelve null mientras no exista histórico", async () => {
    expect(await loadPriceHistory(path.join(root, "precios.json"))).toBeNull();
  });

  it("lee el histórico publicado", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "precios.json"), JSON.stringify(valid));

    const history = await loadPriceHistory(path.join(root, "precios.json"));

    expect(history?.entries).toHaveLength(2);
  });
});
