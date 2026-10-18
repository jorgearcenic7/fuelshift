import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createHistoryEntry,
  emptyHistory,
  HISTORY_SCHEMA_VERSION,
  mergeHistoryEntry,
  MIN_HISTORY_PROVINCES,
  validateHistory,
} from "./price-history.mjs";

const script = fileURLToPath(new URL("./price-history.mjs", import.meta.url));

const FUELS = ["gasoline_95_e5", "gasoline_98_e5", "diesel_a"];

function snapshot({
  date = "2026-10-12",
  time = "16:07:31",
  retrievedAt = `${date}T14:08:32Z`,
  provinceCount = MIN_HISTORY_PROVINCES + 2,
  stationCount = 11_000,
  mean = 1.8123456,
} = {}) {
  const provinces = () =>
    Array.from({ length: provinceCount }, (_, index) => ({
      id: String(index + 1).padStart(2, "0"),
      name: `P${index + 1}`,
      summary: { mean: mean + index / 1000, min: 1.5, max: 2.1, count: 20 },
      sufficient: true,
      differenceFromNational: null,
    }));
  const [year, month, day] = date.split("-");
  return {
    schema_version: "1.0.0",
    retrieved_at: retrievedAt,
    reported_at: {
      raw: `${day}/${month}/${year} ${time}`,
      local: `${date}T${time}`,
    },
    source: {
      attribution: "MITECO",
      catalog: "https://example.invalid/catalogo",
      license_url: "https://creativecommons.org/licenses/by/4.0/",
    },
    station_count: stationCount,
    province_count: provinceCount,
    fuels: Object.fromEntries(
      FUELS.map((fuel) => [
        fuel,
        {
          fuel,
          national: { mean, min: 1.289, max: 2.299, count: 10_000 },
          provinces: provinces(),
          cheapest: null,
          priciest: null,
          spread: null,
          excludedStations: 0,
        },
      ]),
    ),
  };
}

describe("createHistoryEntry", () => {
  it("resume la instantánea con fecha, procedencia y tamaño de la muestra", () => {
    const entry = createHistoryEntry(snapshot());

    expect(entry).toMatchObject({
      date: "2026-10-12",
      retrieved_at: "2026-10-12T14:08:32Z",
      reported_at: "12/10/2026 16:07:31",
      station_count: 11_000,
      province_count: MIN_HISTORY_PROVINCES + 2,
    });
    expect(Object.keys(entry.fuels)).toEqual(FUELS);
    expect(entry.fuels.diesel_a.national).toEqual({
      mean: 1.8123,
      min: 1.289,
      max: 2.299,
      count: 10_000,
    });
    expect(entry.fuels.diesel_a.provinces["01"]).toEqual({
      mean: 1.8123,
      count: 20,
    });
  });

  it("toma la fecha comunicada por MITECO, no la de descarga", () => {
    const entry = createHistoryEntry(
      snapshot({ date: "2026-10-12", retrievedAt: "2026-10-13T00:05:00Z" }),
    );

    expect(entry.date).toBe("2026-10-12");
  });

  it("omite las provincias sin datos en lugar de inventar un valor", () => {
    const value = snapshot();
    value.fuels.gasoline_98_e5.provinces[0].summary = null;

    const entry = createHistoryEntry(value);

    expect(entry.fuels.gasoline_98_e5.provinces["01"]).toBeUndefined();
    expect(entry.fuels.gasoline_95_e5.provinces["01"]).toBeDefined();
  });

  it("rechaza un conjunto incompleto", () => {
    expect(() =>
      createHistoryEntry(
        snapshot({ provinceCount: MIN_HISTORY_PROVINCES - 1 }),
      ),
    ).toThrow(/provincias/);
  });

  it("rechaza un combustible sin estaciones válidas", () => {
    const value = snapshot();
    value.fuels.diesel_a.national = null;

    expect(() => createHistoryEntry(value)).toThrow(/diesel_a/);
  });
});

describe("mergeHistoryEntry", () => {
  const first = createHistoryEntry(snapshot({ date: "2026-10-12" }));
  const second = createHistoryEntry(snapshot({ date: "2026-10-14" }));

  it("añade observaciones en orden cronológico", () => {
    const { history, status } = mergeHistoryEntry(
      mergeHistoryEntry(emptyHistory(snapshot()), second).history,
      first,
    );

    expect(status).toBe("added");
    expect(history.entries.map((entry) => entry.date)).toEqual([
      "2026-10-12",
      "2026-10-14",
    ]);
    expect(history.schema_version).toBe(HISTORY_SCHEMA_VERSION);
  });

  it("no duplica un mismo día: sustituye solo por una observación más reciente", () => {
    const base = mergeHistoryEntry(emptyHistory(snapshot()), first).history;
    const later = createHistoryEntry(
      snapshot({
        date: "2026-10-12",
        retrievedAt: "2026-10-12T18:00:00Z",
        mean: 1.9,
      }),
    );
    const earlier = createHistoryEntry(
      snapshot({ date: "2026-10-12", retrievedAt: "2026-10-12T06:00:00Z" }),
    );

    const replaced = mergeHistoryEntry(base, later);
    const ignored = mergeHistoryEntry(replaced.history, earlier);
    const repeated = mergeHistoryEntry(replaced.history, later);

    expect(replaced.status).toBe("replaced");
    expect(replaced.history.entries).toHaveLength(1);
    expect(replaced.history.entries[0].fuels.diesel_a.national.mean).toBe(1.9);
    expect(ignored.status).toBe("ignored");
    expect(ignored.history).toBe(replaced.history);
    expect(repeated.status).toBe("unchanged");
  });

  it("rechaza una caída brusca de estaciones frente a la observación anterior", () => {
    const base = mergeHistoryEntry(emptyHistory(snapshot()), first).history;
    const degraded = createHistoryEntry(
      snapshot({ date: "2026-10-13", stationCount: 8_000 }),
    );

    expect(() => mergeHistoryEntry(base, degraded)).toThrow(/estaciones/);
  });

  it("no modifica el histórico recibido", () => {
    const base = mergeHistoryEntry(emptyHistory(snapshot()), first).history;
    const before = JSON.stringify(base);

    mergeHistoryEntry(base, second);

    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("validateHistory", () => {
  const valid = mergeHistoryEntry(
    emptyHistory(snapshot()),
    createHistoryEntry(snapshot()),
  ).history;

  it("acepta un histórico generado por el propio script", () => {
    expect(validateHistory(valid)).toEqual(valid);
  });

  it.each([
    ["una versión distinta", { ...valid, schema_version: "2.0.0" }],
    [
      "fechas duplicadas",
      { ...valid, entries: [...valid.entries, ...valid.entries] },
    ],
    [
      "una fecha mal formada",
      { ...valid, entries: [{ ...valid.entries[0], date: "12/10/2026" }] },
    ],
    [
      "una media no positiva",
      {
        ...valid,
        entries: [
          {
            ...valid.entries[0],
            fuels: {
              ...valid.entries[0].fuels,
              diesel_a: {
                ...valid.entries[0].fuels.diesel_a,
                national: { mean: 0, min: 1, max: 2, count: 10 },
              },
            },
          },
        ],
      },
    ],
  ])("rechaza %s", (_reason, value) => {
    expect(() => validateHistory(value)).toThrow();
  });
});

describe("CLI", () => {
  let workspace;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), "fuelshift-history-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: workspace,
      encoding: "utf8",
    });
  const write = (name, value) =>
    writeFile(path.join(workspace, name), JSON.stringify(value));
  const read = async (name) =>
    JSON.parse(await readFile(path.join(workspace, name), "utf8"));

  it("crea el histórico solo con --init y añade la observación", async () => {
    await write("snapshot.json", snapshot());

    expect(run("snapshot.json", "history.json").status).not.toBe(0);
    const result = run("snapshot.json", "history.json", "--init");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("added");
    expect((await read("history.json")).entries).toHaveLength(1);
  });

  it("conserva el histórico anterior si la nueva observación no es válida", async () => {
    await write("snapshot.json", snapshot());
    run("snapshot.json", "history.json", "--init");
    const before = await readFile(path.join(workspace, "history.json"), "utf8");
    await write(
      "broken.json",
      snapshot({ date: "2026-10-13", provinceCount: 3 }),
    );

    const result = run("broken.json", "history.json");

    expect(result.status).not.toBe(0);
    expect(await readFile(path.join(workspace, "history.json"), "utf8")).toBe(
      before,
    );
  });
});
