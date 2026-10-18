import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Histórico ligero de precios: un registro por fecha comunicada por MITECO con
 * las medias nacional y provinciales de cada combustible. Se genera a partir
 * de la instantánea `/data/estadisticas.json` que produce el build, así que el
 * cálculo estadístico vive en un único sitio (src/domain/fuel-statistics.ts).
 */
export const HISTORY_SCHEMA_VERSION = "1.0.0";
export const HISTORY_FUELS = ["gasoline_95_e5", "gasoline_98_e5", "diesel_a"];
/** Un conjunto con menos provincias se considera incompleto y no se registra. */
export const MIN_HISTORY_PROVINCES = 50;
/** Caída máxima de estaciones admitida frente a la observación anterior. */
export const MAX_STATION_DROP = 0.1;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Cuatro decimales: una décima de la precisión de la fuente. */
const round = (value) => Math.round(value * 10_000) / 10_000;

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePositive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${label} debe ser un número positivo.`);
  }
  return value;
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} debe ser un entero positivo.`);
  }
  return value;
}

function requireDate(value, label) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    fail(`${label} debe tener el formato AAAA-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    fail(`${label} no es una fecha válida.`);
  }
  return value;
}

function requireInstant(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    fail(`${label} debe ser una fecha RFC 3339.`);
  }
  return value;
}

function validateEntry(entry) {
  if (!isRecord(entry)) fail("La observación no es un objeto.");
  requireDate(entry.date, "date");
  requireInstant(entry.retrieved_at, `${entry.date}.retrieved_at`);
  if (typeof entry.reported_at !== "string" || entry.reported_at === "") {
    fail(`${entry.date}.reported_at no es válido.`);
  }
  requireCount(entry.station_count, `${entry.date}.station_count`);
  if (
    requireCount(entry.province_count, `${entry.date}.province_count`) <
    MIN_HISTORY_PROVINCES
  ) {
    fail(`${entry.date} solo tiene ${entry.province_count} provincias.`);
  }
  if (!isRecord(entry.fuels)) fail(`${entry.date}.fuels no es válido.`);
  for (const fuel of HISTORY_FUELS) {
    const data = entry.fuels[fuel];
    const label = `${entry.date}.${fuel}`;
    if (
      !isRecord(data) ||
      !isRecord(data.national) ||
      !isRecord(data.provinces)
    ) {
      fail(`${label} está incompleto.`);
    }
    requirePositive(data.national.mean, `${label}.national.mean`);
    const min = requirePositive(data.national.min, `${label}.national.min`);
    if (requirePositive(data.national.max, `${label}.national.max`) < min) {
      fail(`${label}.national tiene un máximo inferior al mínimo.`);
    }
    requireCount(data.national.count, `${label}.national.count`);
    for (const [id, province] of Object.entries(data.provinces)) {
      if (!/^\d{2}$/.test(id) || !isRecord(province)) {
        fail(`${label}.provinces.${id} no es válido.`);
      }
      requirePositive(province.mean, `${label}.provinces.${id}.mean`);
      requireCount(province.count, `${label}.provinces.${id}.count`);
    }
  }
  return entry;
}

/** Convierte la instantánea del build en una observación diaria validada. */
export function createHistoryEntry(snapshot) {
  if (
    !isRecord(snapshot) ||
    !isRecord(snapshot.reported_at) ||
    !isRecord(snapshot.fuels)
  ) {
    fail("La instantánea de estadísticas no es válida.");
  }
  const date = requireDate(
    String(snapshot.reported_at.local ?? "").slice(0, 10),
    "reported_at.local",
  );
  if (snapshot.province_count < MIN_HISTORY_PROVINCES) {
    fail(
      `El conjunto solo tiene ${snapshot.province_count} provincias; se necesitan ${MIN_HISTORY_PROVINCES}.`,
    );
  }
  const fuels = {};
  for (const fuel of HISTORY_FUELS) {
    const statistics = snapshot.fuels[fuel];
    if (!statistics?.national) fail(`${fuel} no tiene estaciones válidas.`);
    const { mean, min, max, count } = statistics.national;
    fuels[fuel] = {
      national: { mean: round(mean), min, max, count },
      // Las provincias sin datos se omiten: no se inventa ningún valor.
      provinces: Object.fromEntries(
        statistics.provinces
          .filter((province) => province.summary)
          .map(({ id, summary }) => [
            id,
            { mean: round(summary.mean), count: summary.count },
          ]),
      ),
    };
  }
  return validateEntry({
    date,
    retrieved_at: snapshot.retrieved_at,
    reported_at: snapshot.reported_at.raw,
    station_count: snapshot.station_count,
    province_count: snapshot.province_count,
    fuels,
  });
}

export function emptyHistory(snapshot) {
  return {
    schema_version: HISTORY_SCHEMA_VERSION,
    source: snapshot.source,
    entries: [],
  };
}

export function validateHistory(history) {
  if (!isRecord(history) || history.schema_version !== HISTORY_SCHEMA_VERSION) {
    fail("La versión del histórico no es compatible.");
  }
  if (!isRecord(history.source) || !Array.isArray(history.entries)) {
    fail("El histórico está incompleto.");
  }
  let previousDate = "";
  for (const entry of history.entries) {
    validateEntry(entry);
    if (entry.date <= previousDate) {
      fail(
        `Las fechas del histórico no son únicas y crecientes (${entry.date}).`,
      );
    }
    previousDate = entry.date;
  }
  return history;
}

/**
 * Integra una observación sin mutar el histórico. Devuelve el estado:
 * `added`, `replaced` (más reciente del mismo día), `unchanged` o `ignored`
 * (más antigua que la ya registrada para ese día).
 */
export function mergeHistoryEntry(history, entry) {
  validateEntry(entry);
  const existing = history.entries.find(({ date }) => date === entry.date);
  if (existing) {
    if (Date.parse(entry.retrieved_at) < Date.parse(existing.retrieved_at)) {
      return { history, status: "ignored" };
    }
    if (JSON.stringify(existing) === JSON.stringify(entry)) {
      return { history, status: "unchanged" };
    }
  }
  const previous = history.entries
    .filter(({ date }) => date < entry.date)
    .at(-1);
  if (
    previous &&
    entry.station_count < previous.station_count * (1 - MAX_STATION_DROP)
  ) {
    fail(
      `Caída de estaciones sospechosa: ${entry.station_count} frente a ${previous.station_count} el ${previous.date}.`,
    );
  }
  const entries = [
    ...history.entries.filter(({ date }) => date !== entry.date),
    entry,
  ].sort((left, right) => left.date.localeCompare(right.date));
  return {
    history: { ...history, entries },
    status: existing ? "replaced" : "added",
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const init = args.includes("--init");
  const [snapshotPath, historyPath] = args.filter((arg) => arg !== "--init");
  if (!snapshotPath || !historyPath) {
    fail(
      "Uso: node scripts/price-history.mjs <estadisticas.json> <historico.json> [--init]",
    );
  }

  const snapshot = await readJson(snapshotPath);
  const entry = createHistoryEntry(snapshot);
  let history;
  try {
    history = validateHistory(await readJson(historyPath));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (!init) fail(`No existe ${historyPath}; usa --init para crearlo.`);
    history = emptyHistory(snapshot);
  }

  const { history: merged, status } = mergeHistoryEntry(history, entry);
  if (status === "added" || status === "replaced") {
    // Escritura atómica: si algo falla, el histórico anterior queda intacto.
    const temporary = path.join(
      path.dirname(historyPath),
      `.${path.basename(historyPath)}.${process.pid}.tmp`,
    );
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    await rename(temporary, historyPath);
  }
  console.log(
    `${status}: ${entry.date} (${merged.entries.length} observaciones)`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Error desconocido.",
    );
    process.exitCode = 1;
  }
}
