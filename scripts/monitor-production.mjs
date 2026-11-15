// Vigilancia de la web publicada.
//
// Comprueba lo que de verdad ve un visitante en producción (no solo si los
// workflows terminaron bien): páginas, recursos de Next.js, manifiesto, archivos
// provinciales, estadísticas, histórico y las últimas ejecuciones de la ingesta.
// No escribe nada en la web ni en el repositorio: genera un informe en Markdown
// y deja `status=ok|alert` en GITHUB_OUTPUT para que el workflow decida si abre,
// actualiza o cierra la incidencia de alerta.
//
// Uso:
//   node scripts/monitor-production.mjs <url-del-sitio> \
//     [--runs runs.json] [--report informe.md] [--simulate]

import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { validatePublishedManifest } from "./fetch-published-manifest.mjs";

// Umbrales elegidos a partir de las ejecuciones reales (docs/monitoring.md):
// el cron pide cada 4 h, pero GitHub ha llegado a separar ejecuciones 11,6 h.
export const DEFAULTS = {
  maxDataAgeHours: 14,
  maxHistoryLagDays: 1,
  consecutiveFailures: 2,
  timeoutMs: 20_000,
};

const PAGES = ["/", "/comparador/", "/estadisticas/"];
const MADRID_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

const ok = (name, detail) => ({ name, ok: true, detail });
const fail = (name, detail) => ({ name, ok: false, detail });

// --- Reglas puras: se prueban sin red en monitor-production.test.mjs ---------

export function checkDataAge(retrievedAt, now, maxHours) {
  const name = "Antigüedad de los datos";
  const time = Date.parse(retrievedAt);
  if (!Number.isFinite(time)) return fail(name, "`retrieved_at` no es válido.");

  const hours = (now.getTime() - time) / 3_600_000;
  // Un pequeño margen para relojes desajustados; más allá es un dato roto.
  if (hours < -0.25) return fail(name, `\`retrieved_at\` está en el futuro.`);
  const detail = `descargados hace ${hours.toFixed(1)} h (${retrievedAt}); límite ${maxHours} h`;
  return hours > maxHours ? fail(name, detail) : ok(name, detail);
}

export function checkHistoryLag(entries, now, maxLagDays) {
  const name = "Histórico diario";
  if (!Array.isArray(entries) || entries.length === 0) {
    return fail(name, "el histórico publicado no tiene registros.");
  }
  const last = entries.at(-1)?.date;
  if (typeof last !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(last)) {
    return fail(name, "el último registro no tiene una fecha válida.");
  }

  // Se compara en días naturales de Madrid, igual que se registra el histórico.
  const today = MADRID_DATE.format(now);
  const lag = (Date.parse(today) - Date.parse(last)) / 86_400_000;
  const detail = `${entries.length} días, último ${last} (hoy ${today} en Madrid)`;
  return lag > maxLagDays ? fail(name, detail) : ok(name, detail);
}

// Solo alerta con N fallos seguidos: uno aislado se recupera en la siguiente
// ejecución y no merece un aviso.
export function checkIngestionRuns(runs, threshold) {
  const name = "Ejecuciones de la ingesta";
  if (!Array.isArray(runs)) return ok(name, "sin datos de ejecuciones.");

  const completed = runs.filter((run) => run.status === "completed");
  if (completed.length === 0) return ok(name, "sin ejecuciones terminadas.");

  let streak = 0;
  for (const run of completed) {
    if (!FAILED_CONCLUSIONS.has(run.conclusion)) break;
    streak += 1;
  }
  const last = completed[0];
  const detail = `última: ${last.conclusion} (${last.createdAt}); fallos seguidos: ${streak}`;
  return streak >= threshold ? fail(name, detail) : ok(name, detail);
}

export function extractStaticAssets(html) {
  const assets = new Set();
  for (const match of html.matchAll(/["'](\/_next\/static\/[^"'?#]+)/g)) {
    if (/\.(?:js|css)$/.test(match[1])) assets.add(match[1]);
  }
  return [...assets].sort();
}

export function renderReport(
  results,
  { siteUrl, now, docsUrl = "docs/monitoring.md" },
) {
  const failed = results.filter((result) => !result.ok);
  const lines = [
    failed.length === 0
      ? "Todas las comprobaciones de producción son correctas."
      : `**${failed.length} comprobación(es) de producción han fallado.**`,
    "",
    `- Sitio: ${siteUrl}`,
    `- Comprobado: ${now.toISOString()}`,
    "",
    "| Comprobación | Estado | Detalle |",
    "| --- | --- | --- |",
    ...results.map(
      (result) =>
        `| ${result.name} | ${result.ok ? "✅" : "❌"} | ${result.detail.replaceAll("|", "\\|")} |`,
    ),
    "",
    `Diagnóstico y recuperación: [docs/monitoring.md](${docsUrl}).`,
  ];
  return lines.join("\n");
}

// --- Comprobaciones con red ---------------------------------------------------

async function get(url, fetchImpl, timeoutMs) {
  return fetchImpl(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "fuelshift-vigilancia" },
  });
}

async function getJson(url, fetchImpl, timeoutMs) {
  const response = await get(url, fetchImpl, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function guard(name, check) {
  try {
    return await check();
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : String(error));
  }
}

export async function runChecks({
  siteUrl,
  runs = null,
  now = new Date(),
  fetchImpl = fetch,
  options = DEFAULTS,
  simulate = false,
}) {
  const base = new URL(siteUrl);
  const at = (pathname) => new URL(pathname, base);
  const { timeoutMs } = options;
  const results = [];
  let homeHtml = "";

  // Páginas principales: deben responder HTML y ser de FuelShift.
  for (const page of PAGES) {
    results.push(
      await guard(`Página ${page}`, async () => {
        const response = await get(at(page), fetchImpl, timeoutMs);
        const body = await response.text();
        if (response.status !== 200)
          return fail(`Página ${page}`, `HTTP ${response.status}`);
        if (!body.includes("FuelShift")) {
          return fail(
            `Página ${page}`,
            "la respuesta no parece la web de FuelShift.",
          );
        }
        if (page === "/") homeHtml = body;
        return ok(`Página ${page}`, "HTTP 200");
      }),
    );
  }

  // Recursos críticos: un despliegue a medias suele dejar JS o CSS en 404.
  results.push(
    await guard("Recursos estáticos", async () => {
      const assets = extractStaticAssets(homeHtml);
      if (assets.length === 0)
        return fail("Recursos estáticos", "la portada no enlaza JS ni CSS.");
      const broken = [];
      for (const asset of assets) {
        const response = await get(at(asset), fetchImpl, timeoutMs);
        await response.arrayBuffer();
        if (!response.ok) broken.push(`${asset} (HTTP ${response.status})`);
      }
      return broken.length > 0
        ? fail("Recursos estáticos", `no disponibles: ${broken.join(", ")}`)
        : ok(
            "Recursos estáticos",
            `${assets.length} archivos JS/CSS disponibles`,
          );
    }),
  );

  // Manifiesto: mismo validador que usa el despliegue antes de publicar.
  let manifest = null;
  results.push(
    await guard("Manifiesto MITECO", async () => {
      manifest = validatePublishedManifest(
        await getJson(at("/data/miteco/manifest.json"), fetchImpl, timeoutMs),
      );
      return ok(
        "Manifiesto MITECO",
        `${manifest.station_count} estaciones en ${manifest.province_count} provincias`,
      );
    }),
  );

  if (manifest) {
    results.push(
      checkDataAge(manifest.retrieved_at, now, options.maxDataAgeHours),
    );

    // Cada archivo provincial debe coincidir con el hash y el tamaño anunciados.
    results.push(
      await guard("Archivos provinciales", async () => {
        const wrong = [];
        for (const province of manifest.provinces) {
          const bytes = await getJson(
            at(`/data/miteco/${province.file}`),
            fetchImpl,
            timeoutMs,
          );
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          if (
            sha256 !== province.sha256 ||
            bytes.byteLength !== province.bytes
          ) {
            wrong.push(province.id);
          }
        }
        return wrong.length > 0
          ? fail(
              "Archivos provinciales",
              `no coinciden con el manifiesto: ${wrong.join(", ")}`,
            )
          : ok(
              "Archivos provinciales",
              `${manifest.provinces.length} archivos íntegros`,
            );
      }),
    );

    // Estadísticas y manifiesto salen del mismo build: deben ser de la misma descarga.
    results.push(
      await guard("Estadísticas", async () => {
        const statistics = JSON.parse(
          (
            await getJson(at("/data/estadisticas.json"), fetchImpl, timeoutMs)
          ).toString("utf8"),
        );
        return statistics.retrieved_at === manifest.retrieved_at
          ? ok("Estadísticas", "coherentes con el manifiesto")
          : fail(
              "Estadísticas",
              `descarga ${statistics.retrieved_at} distinta del manifiesto ${manifest.retrieved_at}`,
            );
      }),
    );
  }

  results.push(
    await guard("Histórico diario", async () => {
      const history = JSON.parse(
        (
          await getJson(
            at("/data/historico/nacional.json"),
            fetchImpl,
            timeoutMs,
          )
        ).toString("utf8"),
      );
      return checkHistoryLag(history.entries, now, options.maxHistoryLagDays);
    }),
  );

  results.push(checkIngestionRuns(runs, options.consecutiveFailures));

  // Simulacro manual para probar de punta a punta que la alerta llega.
  if (simulate) {
    results.push(
      fail("Simulacro", "fallo simulado a petición (workflow_dispatch)."),
    );
  }

  return results;
}

// --- Entrada por línea de comandos ---------------------------------------------

function parseArgs(argv) {
  const args = { siteUrl: argv[0], runs: null, report: null, simulate: false };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--runs") args.runs = argv[++index];
    else if (flag === "--report") args.report = argv[++index];
    else if (flag === "--simulate") args.simulate = true;
    else throw new Error(`Argumento desconocido: ${flag}`);
  }
  if (!args.siteUrl) throw new Error("Falta la URL del sitio.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runs = args.runs ? JSON.parse(await readFile(args.runs, "utf8")) : null;
  const now = new Date();

  const results = await runChecks({
    siteUrl: args.siteUrl,
    runs,
    now,
    simulate: args.simulate,
  });
  // En GitHub el enlace a la guía debe ser absoluto para funcionar en la incidencia.
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository } =
    process.env;
  const docsUrl =
    server && repository
      ? `${server}/${repository}/blob/main/docs/monitoring.md`
      : undefined;
  const report = renderReport(results, { siteUrl: args.siteUrl, now, docsUrl });
  const status = results.every((result) => result.ok) ? "ok" : "alert";

  console.log(report);
  if (args.report) await writeFile(args.report, `${report}\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `status=${status}\n`);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
