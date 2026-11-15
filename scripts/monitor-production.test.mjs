import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DEFAULTS,
  checkDataAge,
  checkHistoryLag,
  checkIngestionRuns,
  extractStaticAssets,
  renderReport,
  runChecks,
} from "./monitor-production.mjs";

const NOW = new Date("2026-11-15T12:00:00Z");
const SITE = "https://fuelshift.example";

// Sitio publicado de mentira: cada prueba estropea solo la pieza que le interesa.
function fakeSite(overrides = {}) {
  const province = Buffer.from(JSON.stringify({ stations: [] }));
  const manifest = {
    schema_version: "1.0.0",
    retrieved_at: "2026-11-15T08:00:00Z",
    station_count: 10,
    province_count: 1,
    provinces: [
      {
        id: "28",
        name: "MADRID",
        file: "provinces/28.json",
        bytes: province.byteLength,
        sha256: createHash("sha256").update(province).digest("hex"),
        station_count: 10,
      },
    ],
  };
  const html =
    '<title>FuelShift</title><script src="/_next/static/chunks/app.js"></script>' +
    '<link rel="stylesheet" href="/_next/static/css/app.css">';
  const routes = {
    "/": html,
    "/comparador/": "<title>FuelShift</title>",
    "/estadisticas/": "<title>FuelShift</title>",
    "/_next/static/chunks/app.js": "js",
    "/_next/static/css/app.css": "css",
    "/data/miteco/manifest.json": JSON.stringify(manifest),
    "/data/miteco/provinces/28.json": province,
    "/data/estadisticas.json": JSON.stringify({
      retrieved_at: manifest.retrieved_at,
    }),
    "/data/historico/nacional.json": JSON.stringify({
      entries: [{ date: "2026-11-14" }, { date: "2026-11-15" }],
    }),
    ...overrides,
  };

  return async (url) => {
    const body = routes[new URL(url).pathname];
    if (body === undefined) return new Response("no", { status: 404 });
    if (body instanceof Response) return body;
    return new Response(body, { status: 200 });
  };
}

const failures = (results) =>
  results.filter((result) => !result.ok).map((result) => result.name);

describe("runChecks", () => {
  it("da todo por bueno en un sitio sano", async () => {
    const results = await runChecks({
      siteUrl: SITE,
      now: NOW,
      fetchImpl: fakeSite(),
    });
    expect(failures(results)).toEqual([]);
  });

  it("detecta una página caída y un recurso JS perdido", async () => {
    const results = await runChecks({
      siteUrl: SITE,
      now: NOW,
      fetchImpl: fakeSite({
        "/comparador/": new Response("caída", { status: 503 }),
        "/_next/static/chunks/app.js": undefined,
      }),
    });
    expect(failures(results)).toEqual([
      "Página /comparador/",
      "Recursos estáticos",
    ]);
  });

  it("detecta un archivo provincial que no coincide con el manifiesto", async () => {
    const results = await runChecks({
      siteUrl: SITE,
      now: NOW,
      fetchImpl: fakeSite({ "/data/miteco/provinces/28.json": "{}" }),
    });
    expect(failures(results)).toEqual(["Archivos provinciales"]);
  });

  it("detecta un manifiesto inválido sin seguir con lo que depende de él", async () => {
    const results = await runChecks({
      siteUrl: SITE,
      now: NOW,
      fetchImpl: fakeSite({ "/data/miteco/manifest.json": "<html>" }),
    });
    expect(failures(results)).toEqual(["Manifiesto MITECO"]);
    expect(results.map((result) => result.name)).not.toContain("Estadísticas");
  });

  it("detecta estadísticas de otra descarga (publicación incompleta)", async () => {
    const results = await runChecks({
      siteUrl: SITE,
      now: NOW,
      fetchImpl: fakeSite({
        "/data/estadisticas.json": JSON.stringify({
          retrieved_at: "2026-11-14T08:00:00Z",
        }),
      }),
    });
    expect(failures(results)).toEqual(["Estadísticas"]);
  });

  it("añade un fallo cuando se pide un simulacro", async () => {
    const results = await runChecks({
      siteUrl: SITE,
      now: NOW,
      fetchImpl: fakeSite(),
      simulate: true,
    });
    expect(failures(results)).toEqual(["Simulacro"]);
  });

  it("convierte un error de red en un fallo, no en una excepción", async () => {
    const results = await runChecks({
      siteUrl: SITE,
      now: NOW,
      fetchImpl: async () => {
        throw new Error("sin conexión");
      },
    });
    expect(
      results.every(
        (result) => !result.ok || result.name.startsWith("Ejecuciones"),
      ),
    ).toBe(true);
  });
});

describe("checkDataAge", () => {
  it.each([
    ["2026-11-15T08:00:00Z", true],
    ["2026-11-14T22:00:01Z", true],
    ["2026-11-14T21:59:00Z", false],
    ["2026-11-15T13:00:00Z", false],
    ["no es una fecha", false],
  ])("con retrieved_at %s → ok=%s", (retrievedAt, expected) => {
    expect(checkDataAge(retrievedAt, NOW, DEFAULTS.maxDataAgeHours).ok).toBe(
      expected,
    );
  });
});

describe("checkHistoryLag", () => {
  it("acepta el registro de ayer y rechaza uno de anteayer", () => {
    expect(checkHistoryLag([{ date: "2026-11-14" }], NOW, 1).ok).toBe(true);
    expect(checkHistoryLag([{ date: "2026-11-13" }], NOW, 1).ok).toBe(false);
  });

  it("usa el día de Madrid, no el de UTC", () => {
    // 23:30 UTC del 14 ya es día 15 en Madrid.
    const night = new Date("2026-11-14T23:30:00Z");
    expect(checkHistoryLag([{ date: "2026-11-13" }], night, 1).ok).toBe(false);
  });

  it("rechaza un histórico vacío o con fechas rotas", () => {
    expect(checkHistoryLag([], NOW, 1).ok).toBe(false);
    expect(checkHistoryLag([{ date: "ayer" }], NOW, 1).ok).toBe(false);
  });
});

describe("checkIngestionRuns", () => {
  const run = (conclusion, status = "completed") => ({
    conclusion,
    status,
    createdAt: "2026-11-15T10:00:00Z",
  });

  it("tolera un fallo aislado", () => {
    expect(checkIngestionRuns([run("failure"), run("success")], 2).ok).toBe(
      true,
    );
  });

  it("alerta con dos fallos seguidos e ignora la ejecución en curso", () => {
    const runs = [run(null, "in_progress"), run("failure"), run("timed_out")];
    expect(checkIngestionRuns(runs, 2).ok).toBe(false);
  });

  it("no alerta sin datos de ejecuciones", () => {
    expect(checkIngestionRuns(null, 2).ok).toBe(true);
    expect(checkIngestionRuns([], 2).ok).toBe(true);
  });
});

describe("extractStaticAssets y renderReport", () => {
  it("extrae JS y CSS sin repetir ni incluir otros recursos", () => {
    const html =
      '<script src="/_next/static/a.js"></script><script src="/_next/static/a.js"></script>' +
      '<link href="/_next/static/b.css?v=1"><img src="/_next/static/logo.svg">';
    expect(extractStaticAssets(html)).toEqual([
      "/_next/static/a.js",
      "/_next/static/b.css",
    ]);
  });

  it("escapa las barras verticales del detalle en la tabla", () => {
    const report = renderReport([{ name: "X", ok: false, detail: "a|b" }], {
      siteUrl: SITE,
      now: NOW,
    });
    expect(report).toContain("a\\|b");
    expect(report).toContain("1 comprobación(es)");
  });
});
