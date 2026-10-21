import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRecord,
  decideRecord,
  exportRecords,
  HISTORY_FUELS,
  HISTORY_SCHEMA_VERSION,
  MIN_HISTORY_PROVINCES,
  parseCount,
  planHistory,
  publishHistory,
  readRecords,
  recordSnapshot,
  restoreFromSite,
  validateRecord,
} from "./price-history.mjs";

const script = fileURLToPath(new URL("./price-history.mjs", import.meta.url));

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
      HISTORY_FUELS.map((fuel) => [
        fuel,
        {
          fuel,
          national: { mean, min: 1.289, max: 2.299, count: 10_000 },
          provinces: provinces(),
          cheapest: null,
          priciest: null,
          spread: null,
          excludedStations: 1_000,
        },
      ]),
    ),
  };
}

let workspace;
let records;

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "fuelshift-historico-"));
  records = path.join(workspace, "diario");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

describe("createRecord", () => {
  it("resume la instantánea con fechas, procedencia, versión y muestras", () => {
    const record = createRecord(snapshot());

    expect(record).toMatchObject({
      schema_version: HISTORY_SCHEMA_VERSION,
      date: "2026-10-12",
      retrieved_at: "2026-10-12T14:08:32Z",
      reported_at: "12/10/2026 16:07:31",
      source: { attribution: "MITECO" },
      station_count: 11_000,
      province_count: MIN_HISTORY_PROVINCES + 2,
    });
    expect(Object.keys(record.fuels)).toEqual(HISTORY_FUELS);
    expect(record.fuels.diesel_a.national).toEqual({
      mean: 1.8123,
      min: 1.289,
      max: 2.299,
      count: 10_000,
      excluded: 1_000,
    });
    expect(record.fuels.diesel_a.provinces["01"]).toEqual({
      mean: 1.8123,
      count: 20,
    });
  });

  it("agrupa por la fecha comunicada por MITECO, no por la de descarga", () => {
    const record = createRecord(
      snapshot({ date: "2026-10-12", retrievedAt: "2026-10-13T00:05:00Z" }),
    );

    expect(record.date).toBe("2026-10-12");
    expect(record.retrieved_at).toBe("2026-10-13T00:05:00Z");
  });

  it("omite las provincias sin datos en lugar de inventar un valor", () => {
    const value = snapshot();
    value.fuels.gasoline_98_e5.provinces[0].summary = null;

    const record = createRecord(value);

    expect(record.fuels.gasoline_98_e5.provinces["01"]).toBeUndefined();
    expect(record.fuels.gasoline_95_e5.provinces["01"]).toBeDefined();
  });

  it.each([
    ["un conjunto incompleto", snapshot({ provinceCount: 3 }), /provincias/],
    [
      "un combustible sin estaciones",
      (() => {
        const value = snapshot();
        value.fuels.diesel_a.national = null;
        return value;
      })(),
      /diesel_a/,
    ],
    [
      "una fecha de MITECO ilegible",
      { ...snapshot(), reported_at: { raw: "x", local: "ayer" } },
      /fecha/,
    ],
    [
      "un día posterior a la descarga",
      snapshot({ date: "2026-10-14", retrievedAt: "2026-10-12T10:00:00Z" }),
      /posterior/,
    ],
    [
      "más estaciones de las cargadas",
      snapshot({ stationCount: 10_500 }),
      /más estaciones/,
    ],
    ["una procedencia ausente", { ...snapshot(), source: null }, /source/],
    ["una instantánea vacía", null, /no es válida/],
  ])("rechaza %s", (_reason, value, message) => {
    expect(() => createRecord(value)).toThrow(message);
  });
});

describe("validateRecord", () => {
  const valid = createRecord(snapshot());

  it.each([
    ["otra versión", { ...valid, schema_version: "2.0.0" }],
    [
      "un mínimo mayor que el máximo",
      {
        ...valid,
        fuels: {
          ...valid.fuels,
          diesel_a: {
            ...valid.fuels.diesel_a,
            national: { ...valid.fuels.diesel_a.national, min: 3 },
          },
        },
      },
    ],
    [
      "una provincia con identificador no válido",
      {
        ...valid,
        fuels: {
          ...valid.fuels,
          diesel_a: {
            ...valid.fuels.diesel_a,
            provinces: { 1: { mean: 1.8, count: 5 } },
          },
        },
      },
    ],
    ["un recuento no entero", { ...valid, station_count: 10.5 }],
    ["un combustible ausente", { ...valid, fuels: {} }],
  ])("rechaza %s", (_reason, value) => {
    expect(() => validateRecord(value)).toThrow();
  });
});

describe("decideRecord", () => {
  const base = createRecord(snapshot());

  it("añade un día sin registro", () => {
    expect(decideRecord(null, base)).toBe("added");
  });

  it("sustituye el registro del día por una observación más reciente con otros valores", () => {
    const later = createRecord(
      snapshot({ retrievedAt: "2026-10-12T18:00:00Z", mean: 1.9 }),
    );

    expect(decideRecord(base, later)).toBe("replaced");
  });

  it("no reescribe el día si la observación más reciente no aporta valores nuevos", () => {
    const later = createRecord(
      snapshot({ retrievedAt: "2026-10-12T18:00:00Z", time: "20:00:00" }),
    );

    expect(decideRecord(base, later)).toBe("unchanged");
  });

  it("ignora una observación más antigua que la registrada", () => {
    const earlier = createRecord(
      snapshot({ retrievedAt: "2026-10-12T06:00:00Z", mean: 1.7 }),
    );

    expect(decideRecord(base, earlier)).toBe("ignored");
  });
});

describe("readRecords", () => {
  it("lee los registros válidos en orden y aparta los corruptos", async () => {
    await writeJson(
      path.join(records, "2026-10-13.json"),
      createRecord(snapshot({ date: "2026-10-13" })),
    );
    await writeJson(
      path.join(records, "2026-10-12.json"),
      createRecord(snapshot({ date: "2026-10-12" })),
    );
    await writeFile(path.join(records, "2026-10-14.json"), "{ no es json");
    await writeJson(
      path.join(records, "2026-10-15.json"),
      createRecord(snapshot({ date: "2026-10-16" })),
    );
    await writeFile(path.join(records, "LEEME.txt"), "no es un registro");

    const { records: valid, invalid } = await readRecords(records);

    expect(valid.map((record) => record.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
    ]);
    expect(invalid.map((item) => item.file)).toEqual([
      "2026-10-14.json",
      "2026-10-15.json",
    ]);
  });

  it("devuelve un histórico vacío si la carpeta aún no existe", async () => {
    expect(await readRecords(path.join(workspace, "no-existe"))).toEqual({
      records: [],
      invalid: [],
    });
  });
});

describe("recordSnapshot", () => {
  it("guarda una observación por día y no duplica al repetir la ejecución", async () => {
    const first = await recordSnapshot(snapshot(), records);
    const second = await recordSnapshot(snapshot(), records);

    expect(first).toMatchObject({ status: "added", date: "2026-10-12" });
    expect(second.status).toBe("unchanged");
    expect(await readdir(records)).toEqual(["2026-10-12.json"]);
  });

  it("conserva los registros anteriores al añadir o sustituir un día", async () => {
    await recordSnapshot(snapshot({ date: "2026-10-12" }), records);
    const before = await readFile(path.join(records, "2026-10-12.json"));
    await recordSnapshot(snapshot({ date: "2026-10-13" }), records);
    const replaced = await recordSnapshot(
      snapshot({
        date: "2026-10-13",
        retrievedAt: "2026-10-13T18:00:00Z",
        mean: 1.85,
      }),
      records,
    );

    expect(replaced).toMatchObject({ status: "replaced", observations: 2 });
    expect(await readFile(path.join(records, "2026-10-12.json"))).toEqual(
      before,
    );
    const latest = await readJson(path.join(records, "2026-10-13.json"));
    expect(latest.fuels.diesel_a.national.mean).toBe(1.85);
  });

  it("rechaza una caída brusca de estaciones sin tocar el histórico", async () => {
    await recordSnapshot(snapshot({ date: "2026-10-12" }), records);
    const before = await readFile(path.join(records, "2026-10-12.json"));
    const anomalous = snapshot({ date: "2026-10-13", stationCount: 8_000 });
    for (const fuel of HISTORY_FUELS) {
      anomalous.fuels[fuel].national.count = 7_000;
    }

    await expect(recordSnapshot(anomalous, records)).rejects.toThrow(
      /estaciones/,
    );
    expect(await readdir(records)).toEqual(["2026-10-12.json"]);
    expect(await readFile(path.join(records, "2026-10-12.json"))).toEqual(
      before,
    );
  });

  it("repara el registro del día si el guardado estaba corrupto", async () => {
    await mkdir(records, { recursive: true });
    await writeFile(path.join(records, "2026-10-12.json"), "{ corrupto");

    const result = await recordSnapshot(snapshot(), records);

    expect(result.status).toBe("added");
    expect(
      validateRecord(await readJson(path.join(records, "2026-10-12.json")))
        .date,
    ).toBe("2026-10-12");
  });

  it("no deja archivos temporales tras escribir", async () => {
    await recordSnapshot(snapshot(), records);

    expect((await readdir(records)).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });
});

describe("publishHistory", () => {
  const output = () => path.join(workspace, "out", "historico");

  it("publica la serie nacional, una serie por provincia y copias diarias", async () => {
    await recordSnapshot(snapshot({ date: "2026-10-12" }), records);
    await recordSnapshot(snapshot({ date: "2026-10-13", mean: 1.83 }), records);

    const summary = await publishHistory(records, output());

    expect(summary).toEqual({ published: 2, discarded: 0 });
    const national = await readJson(path.join(output(), "nacional.json"));
    expect(national).toMatchObject({
      schema_version: HISTORY_SCHEMA_VERSION,
      discarded: 0,
      source: { attribution: "MITECO" },
    });
    expect(national.entries.map((entry) => entry.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
    ]);
    expect(national.entries[1].fuels.diesel_a.mean).toBe(1.83);
    expect(national.entries[0].fuels.diesel_a.provinces).toBeUndefined();

    const madrid = await readJson(path.join(output(), "provincias", "28.json"));
    expect(madrid.province_id).toBe("28");
    expect(madrid.entries[0].fuels.gasoline_95_e5).toEqual({
      mean: 1.8393,
      count: 20,
    });
    expect((await readdir(path.join(output(), "diario"))).sort()).toEqual([
      "2026-10-12.json",
      "2026-10-13.json",
    ]);
  });

  it("publica las observaciones válidas aunque haya un registro corrupto", async () => {
    await recordSnapshot(snapshot({ date: "2026-10-12" }), records);
    await writeFile(path.join(records, "2026-10-13.json"), "{ corrupto");

    const summary = await publishHistory(records, output());

    expect(summary).toEqual({ published: 1, discarded: 1 });
    const national = await readJson(path.join(output(), "nacional.json"));
    expect(national.discarded).toBe(1);
    expect(national.entries.map((entry) => entry.date)).toEqual(["2026-10-12"]);
    expect(await readdir(path.join(output(), "diario"))).toEqual([
      "2026-10-12.json",
    ]);
  });

  it("publica un histórico vacío explícito si todavía no hay registros", async () => {
    expect(await publishHistory(records, output())).toEqual({
      published: 0,
      discarded: 0,
    });
    const national = await readJson(path.join(output(), "nacional.json"));
    expect(national.entries).toEqual([]);
    expect(national.source).toBeNull();
  });
});

describe("contrato compartido (contracts/)", () => {
  const contracts = fileURLToPath(new URL("../contracts/", import.meta.url));
  const ajv = new Ajv2020({ allErrors: true });
  const validators = new Map();

  async function contractErrors(name, document) {
    if (!validators.has(name)) {
      const schema = await readJson(
        path.join(contracts, "schemas", `${name}.schema.json`),
      );
      validators.set(name, ajv.compile(schema));
    }
    const validate = validators.get(name);
    return validate(document)
      ? []
      : validate.errors.map(
          ({ instancePath, message }) => `${instancePath} ${message}`,
        );
  }

  it("el registro diario creado desde la instantánea cumple el esquema", async () => {
    expect(
      await contractErrors("history-record", createRecord(snapshot())),
    ).toEqual([]);
  });

  it("los JSON publicados cumplen sus esquemas", async () => {
    await recordSnapshot(snapshot({ date: "2026-10-12" }), records);
    await recordSnapshot(snapshot({ date: "2026-10-13", mean: 1.83 }), records);
    const output = path.join(workspace, "out", "historico");
    await publishHistory(records, output);

    expect(
      await contractErrors(
        "history-national",
        await readJson(path.join(output, "nacional.json")),
      ),
    ).toEqual([]);
    for (const file of await readdir(path.join(output, "provincias"))) {
      expect(
        await contractErrors(
          "history-province",
          await readJson(path.join(output, "provincias", file)),
        ),
      ).toEqual([]);
    }
    for (const file of await readdir(path.join(output, "diario"))) {
      expect(
        await contractErrors(
          "history-record",
          await readJson(path.join(output, "diario", file)),
        ),
      ).toEqual([]);
    }
  });

  it("el histórico vacío también cumple el esquema nacional", async () => {
    const output = path.join(workspace, "out", "historico");
    await publishHistory(records, output);

    expect(
      await contractErrors(
        "history-national",
        await readJson(path.join(output, "nacional.json")),
      ),
    ).toEqual([]);
  });

  it("acepta el registro de ejemplo del contrato", async () => {
    const example = await readJson(
      path.join(
        contracts,
        "examples",
        "historico",
        "diario",
        "2026-10-11.json",
      ),
    );

    expect(validateRecord(example)).toEqual(example);
  });
});

describe("restoreFromSite", () => {
  const site = "https://fuelshift.example";

  async function publishedSite() {
    await recordSnapshot(snapshot({ date: "2026-10-12" }), records);
    await recordSnapshot(snapshot({ date: "2026-10-13" }), records);
    const output = path.join(workspace, "publicado");
    await publishHistory(records, output);
    await rm(records, { recursive: true });
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(url.pathname);
      const file = path.join(
        output,
        url.pathname.replace("/data/historico/", ""),
      );
      try {
        return new Response(await readFile(file), { status: 200 });
      } catch {
        return new Response("", { status: 404 });
      }
    };
    return { output, fetchImpl, requested };
  }

  it("reconstruye los registros diarios publicados en producción", async () => {
    const { fetchImpl, requested } = await publishedSite();

    const result = await restoreFromSite(site, records, { fetchImpl });

    expect(result).toEqual({ restored: 2, skipped: 0, missing: false });
    expect(requested[0]).toBe("/data/historico/nacional.json");
    expect((await readRecords(records)).records).toHaveLength(2);
  });

  it("repara un registro local corrupto con la copia publicada", async () => {
    const { fetchImpl } = await publishedSite();
    await mkdir(records, { recursive: true });
    await writeFile(path.join(records, "2026-10-12.json"), "{ corrupto");

    const result = await restoreFromSite(site, records, { fetchImpl });

    expect(result.restored).toBe(2);
    expect((await readRecords(records)).invalid).toEqual([]);
  });

  it("informa si producción no responde", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(restoreFromSite(site, records, { fetchImpl })).rejects.toThrow(
      /No se pudo descargar \/data\/historico\/nacional\.json/,
    );
  });

  it("no sobrescribe registros presentes y descarta los corruptos", async () => {
    const { output, fetchImpl } = await publishedSite();
    await recordSnapshot(
      snapshot({ date: "2026-10-12", retrievedAt: "2026-10-12T20:00:00Z" }),
      records,
    );
    const local = await readFile(path.join(records, "2026-10-12.json"));
    await writeFile(path.join(output, "diario", "2026-10-13.json"), "{ x");

    const result = await restoreFromSite(site, records, { fetchImpl });

    expect(result).toEqual({ restored: 0, skipped: 1, missing: false });
    expect(await readFile(path.join(records, "2026-10-12.json"))).toEqual(
      local,
    );
  });

  it("informa si producción todavía no publica histórico", async () => {
    const fetchImpl = async () => new Response("", { status: 404 });

    expect(await restoreFromSite(site, records, { fetchImpl })).toEqual({
      restored: 0,
      skipped: 0,
      missing: true,
    });
  });

  it.each([
    ["una URL sin HTTPS", "http://fuelshift.example", /HTTPS/],
    ["credenciales en la URL", "https://a:b@fuelshift.example", /HTTPS/],
  ])("rechaza %s", async (_reason, url, message) => {
    await expect(restoreFromSite(url, records)).rejects.toThrow(message);
  });

  it("falla si producción responde con un error", async () => {
    const fetchImpl = async () => new Response("", { status: 503 });

    await expect(restoreFromSite(site, records, { fetchImpl })).rejects.toThrow(
      /503/,
    );
  });
});

describe("exportRecords", () => {
  it("entrega solo registros válidos aunque la rama traiga uno corrupto", async () => {
    await recordSnapshot(snapshot({ date: "2026-10-12" }), records);
    await recordSnapshot(snapshot({ date: "2026-10-13" }), records);
    await writeFile(path.join(records, "2026-10-11.json"), "{ corrupto");
    const delivery = path.join(workspace, "entrega");

    const summary = await exportRecords(records, delivery);

    expect(summary).toEqual({ exported: 2, discarded: 1 });
    expect((await readdir(delivery)).sort()).toEqual([
      "2026-10-12.json",
      "2026-10-13.json",
    ]);
    expect((await readRecords(delivery)).invalid).toEqual([]);
  });

  it("vacía una entrega anterior en lugar de mezclarla", async () => {
    const delivery = path.join(workspace, "entrega");
    await mkdir(delivery, { recursive: true });
    await writeFile(path.join(delivery, "2026-01-01.json"), "{ viejo");
    await recordSnapshot(snapshot(), records);

    await exportRecords(records, delivery);

    expect(await readdir(delivery)).toEqual(["2026-10-12.json"]);
  });
});

describe("parseCount", () => {
  it.each([
    [undefined, 0],
    [null, 0],
    ["", 0],
    ["  ", 0],
    ["0", 0],
    ["2", 2],
    [" 12 ", 12],
  ])("convierte %j en %d", (value, expected) => {
    expect(parseCount(value)).toBe(expected);
  });

  it.each(["-1", "1.5", "abc", "2 días", "0x10"])(
    "rechaza %j en lugar de convertirlo implícitamente",
    (value) => {
      expect(() => parseCount(value)).toThrow(/Recuento no válido/);
    },
  );
});

describe("planHistory", () => {
  const plan = (input) =>
    planHistory({
      source: "branch",
      restored: "",
      status: "",
      publishOutcome: "success",
      ...input,
    });

  it.each([
    ["día nuevo leído de la rama", { status: "added" }, true, true],
    ["día actualizado", { status: "replaced" }, true, true],
    ["día sin cambios", { status: "unchanged" }, false, false],
    ["observación antigua", { status: "ignored" }, false, false],
    ["registro fallido (sin estado)", { status: "" }, false, false],
    [
      "días publicados que faltaban en la rama",
      { status: "unchanged", restored: "2" },
      true,
      false,
    ],
    ["recuperados vacío", { status: "unchanged", restored: "" }, false, false],
    [
      "recuperados ausente",
      { status: "unchanged", restored: undefined },
      false,
      false,
    ],
    [
      "publicación fallida",
      { status: "added", publishOutcome: "failure" },
      true,
      false,
    ],
    [
      "rama inaccesible y copia publicada",
      { source: "site", status: "added" },
      false,
      true,
    ],
    [
      "rama inexistente",
      { source: "missing", status: "added", restored: "3" },
      false,
      false,
    ],
    ["histórico no disponible", { source: "unavailable" }, false, false],
    ["histórico desactivado", { source: "", status: "" }, false, false],
  ])("%s", (_reason, input, persist, deploy) => {
    expect(plan(input)).toMatchObject({ persist, deploy });
  });

  it("no decide nada con un recuento ilegible", () => {
    expect(() => plan({ restored: "muchos" })).toThrow(/Recuento no válido/);
  });
});

describe("CLI", () => {
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: path.join(workspace, "output.txt"),
      },
    });

  it("registra, informa del estado para Actions y no duplica", async () => {
    await writeJson(path.join(workspace, "estadisticas.json"), snapshot());

    const first = run("record", "estadisticas.json", "diario");
    const second = run("record", "estadisticas.json", "diario");

    expect(first.status).toBe(0);
    expect(first.stdout).toContain("added: 2026-10-12");
    expect(second.stdout).toContain("unchanged: 2026-10-12");
    const outputs = await readFile(path.join(workspace, "output.txt"), "utf8");
    expect(outputs).toContain("history_status=added");
    expect(outputs.trim().split("\n").at(-2)).toBe("history_status=unchanged");
    expect(outputs).toContain("history_date=2026-10-12");
  });

  it("falla sin escribir si la instantánea no es válida", async () => {
    await writeJson(
      path.join(workspace, "estadisticas.json"),
      snapshot({ provinceCount: 3 }),
    );

    const result = run("record", "estadisticas.json", "diario");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/provincias/);
    expect(await readRecords(path.join(workspace, "diario"))).toEqual({
      records: [],
      invalid: [],
    });
  });

  it("publica desde la línea de órdenes", async () => {
    await writeJson(path.join(workspace, "estadisticas.json"), snapshot());
    run("record", "estadisticas.json", "diario");

    const result = run("publish", "diario", "salida");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 observaciones publicadas");
  });

  it.each([
    [{}, "persist=false\ndeploy=false\n"],
    [
      { HISTORY_SOURCE: "branch", HISTORY_STATUS: "added" },
      "persist=true\ndeploy=false\n",
    ],
    [
      {
        HISTORY_SOURCE: "branch",
        HISTORY_STATUS: "added",
        HISTORY_PUBLISH_OUTCOME: "success",
      },
      "persist=true\ndeploy=true\n",
    ],
    [
      { HISTORY_SOURCE: "branch", HISTORY_RESTORED: "1" },
      "persist=true\ndeploy=false\n",
    ],
  ])(
    "decide con valores explícitos para Actions (%j)",
    async (env, expected) => {
      const output = path.join(workspace, "plan.txt");
      const clean = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !key.startsWith("HISTORY_"),
        ),
      );

      const result = spawnSync(process.execPath, [script, "plan"], {
        encoding: "utf8",
        env: { ...clean, ...env, GITHUB_OUTPUT: output },
      });

      expect(result.status).toBe(0);
      expect(await readFile(output, "utf8")).toBe(expected);
    },
  );

  it("no escribe decisiones si un recuento es ilegible", async () => {
    const output = path.join(workspace, "plan.txt");
    await writeFile(output, "");

    const result = spawnSync(process.execPath, [script, "plan"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HISTORY_SOURCE: "branch",
        HISTORY_RESTORED: "x",
        GITHUB_OUTPUT: output,
      },
    });

    expect(result.status).not.toBe(0);
    expect(await readFile(output, "utf8")).toBe("");
  });

  it("entrega desde la línea de órdenes", async () => {
    await writeJson(path.join(workspace, "estadisticas.json"), snapshot());
    run("record", "estadisticas.json", "diario");

    const result = run("export", "diario", "entrega");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 registros entregados; 0 descartados.");
  });

  it.each([[["record"]], [["otra", "a", "b"]]])(
    "explica el uso ante órdenes incompletas o desconocidas (%j)",
    (args) => {
      const result = run(...args);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Uso:/);
    },
  );
});
