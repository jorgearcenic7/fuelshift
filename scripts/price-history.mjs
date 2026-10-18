import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Histórico ligero de precios: un archivo `diario/AAAA-MM-DD.json` por fecha
 * comunicada por MITECO con las medias nacional y provinciales de cada
 * combustible. Se genera a partir de la instantánea `/data/estadisticas.json`
 * que produce el build, así que el cálculo estadístico vive en un único sitio
 * (src/domain/fuel-statistics.ts). Un archivo por día hace que cada ejecución
 * toque un solo registro y que el repositorio crezca de forma lineal.
 */
export const HISTORY_SCHEMA_VERSION = "1.0.0";
export const HISTORY_FUELS = ["gasoline_95_e5", "gasoline_98_e5", "diesel_a"];
/** Un conjunto con menos provincias se considera incompleto y no se registra. */
export const MIN_HISTORY_PROVINCES = 50;
/** Caída máxima de estaciones admitida frente a la observación anterior. */
export const MAX_STATION_DROP = 0.1;
/** Un registro diario real ocupa unos 6 KB; nada legítimo se acerca a esto. */
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_INDEX_BYTES = 8 * 1024 * 1024;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const MADRID_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

function requireCount(value, label, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    fail(
      `${label} debe ser un entero ${allowZero ? "no negativo" : "positivo"}.`,
    );
  }
  return value;
}

function requireDate(value, label) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    fail(`${label} debe ser una fecha con el formato AAAA-MM-DD.`);
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

function requireText(value, label) {
  if (typeof value !== "string" || value === "") fail(`${label} no es válido.`);
  return value;
}

/** Valida un registro diario completo; lanza un error descriptivo si no lo es. */
export function validateRecord(record) {
  if (!isRecord(record)) fail("El registro no es un objeto.");
  if (record.schema_version !== HISTORY_SCHEMA_VERSION) {
    fail("La versión del registro no es compatible.");
  }
  const date = requireDate(record.date, "date");
  const retrievedAt = requireInstant(
    record.retrieved_at,
    `${date}.retrieved_at`,
  );
  // MITECO comunica la hora peninsular: su día nunca puede ser posterior al
  // día en Madrid del momento en que se descargó.
  if (date > MADRID_DATE.format(new Date(retrievedAt))) {
    fail(`${date} es posterior a la descarga ${retrievedAt}.`);
  }
  requireText(record.reported_at, `${date}.reported_at`);
  if (!isRecord(record.source)) fail(`${date}.source no es válido.`);
  for (const key of ["attribution", "catalog", "license_url"]) {
    requireText(record.source[key], `${date}.source.${key}`);
  }
  requireCount(record.station_count, `${date}.station_count`);
  if (
    requireCount(record.province_count, `${date}.province_count`) <
    MIN_HISTORY_PROVINCES
  ) {
    fail(`${date} solo tiene ${record.province_count} provincias.`);
  }
  if (!isRecord(record.fuels)) fail(`${date}.fuels no es válido.`);
  for (const fuel of HISTORY_FUELS) {
    const data = record.fuels[fuel];
    const label = `${date}.${fuel}`;
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
    const count = requireCount(data.national.count, `${label}.national.count`);
    const excluded = requireCount(
      data.national.excluded,
      `${label}.national.excluded`,
      { allowZero: true },
    );
    if (count + excluded > record.station_count) {
      fail(`${label} cuenta más estaciones de las cargadas.`);
    }
    for (const [id, province] of Object.entries(data.provinces)) {
      if (!/^\d{2}$/.test(id) || !isRecord(province)) {
        fail(`${label}.provinces.${id} no es válido.`);
      }
      requirePositive(province.mean, `${label}.provinces.${id}.mean`);
      requireCount(province.count, `${label}.provinces.${id}.count`);
    }
  }
  return record;
}

/** Convierte la instantánea del build en un registro diario validado. */
export function createRecord(snapshot) {
  if (
    !isRecord(snapshot) ||
    !isRecord(snapshot.reported_at) ||
    !isRecord(snapshot.fuels)
  ) {
    fail("La instantánea de estadísticas no es válida.");
  }
  // El día es el que comunica MITECO (hora peninsular), no el de la descarga.
  const date = requireDate(
    String(snapshot.reported_at.local ?? "").slice(0, 10),
    "La fecha comunicada por MITECO (reported_at.local)",
  );
  if (!(snapshot.province_count >= MIN_HISTORY_PROVINCES)) {
    fail(
      `El conjunto solo tiene ${snapshot.province_count} provincias; se necesitan ${MIN_HISTORY_PROVINCES}.`,
    );
  }
  const fuels = {};
  for (const fuel of HISTORY_FUELS) {
    const statistics = snapshot.fuels[fuel];
    if (!statistics?.national || !Array.isArray(statistics.provinces)) {
      fail(`${fuel} no tiene estaciones válidas.`);
    }
    const { mean, min, max, count } = statistics.national;
    fuels[fuel] = {
      national: {
        mean: round(mean),
        min,
        max,
        count,
        excluded: statistics.excludedStations,
      },
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
  return validateRecord({
    schema_version: HISTORY_SCHEMA_VERSION,
    date,
    retrieved_at: snapshot.retrieved_at,
    reported_at: snapshot.reported_at.raw,
    source: snapshot.source,
    station_count: snapshot.station_count,
    province_count: snapshot.province_count,
    fuels,
  });
}

/** Contenido estadístico de un registro, sin los metadatos de la descarga. */
const statisticalContent = ({ station_count, province_count, fuels }) =>
  JSON.stringify({ station_count, province_count, fuels });

/**
 * Política diaria: una sola observación por día. Prevalece la descarga más
 * reciente del día, pero solo se reescribe si cambian los valores.
 * Devuelve `added`, `replaced`, `unchanged` o `ignored` (más antigua).
 */
export function decideRecord(existing, incoming) {
  if (!existing) return "added";
  if (Date.parse(incoming.retrieved_at) < Date.parse(existing.retrieved_at)) {
    return "ignored";
  }
  return statisticalContent(existing) === statisticalContent(incoming)
    ? "unchanged"
    : "replaced";
}

async function readRecordFile(file) {
  const bytes = await readFile(file);
  if (bytes.byteLength > MAX_RECORD_BYTES)
    fail("El registro es demasiado grande.");
  return validateRecord(JSON.parse(bytes.toString("utf8")));
}

/**
 * Lee todos los registros de una carpeta. Un archivo corrupto se aparta y se
 * informa, pero nunca impide leer los demás.
 */
export async function readRecords(directory) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], invalid: [] };
    throw error;
  }
  const records = [];
  const invalid = [];
  for (const name of names.sort()) {
    const match = RECORD_FILE.exec(name);
    if (!match) continue;
    try {
      const record = await readRecordFile(path.join(directory, name));
      if (record.date !== match[1]) {
        fail(`contiene la fecha ${record.date}.`);
      }
      records.push(record);
    } catch (error) {
      invalid.push({ file: name, reason: error.message });
    }
  }
  return { records, invalid };
}

async function writeAtomic(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Incorpora un registro diario sin tocar el resto del histórico. Solo escribe
 * si el día es nuevo o la observación es más reciente con valores distintos.
 */
export async function mergeRecord(record, directory) {
  validateRecord(record);
  const { records } = await readRecords(directory);
  const file = path.join(directory, `${record.date}.json`);
  const existing = records.find(({ date }) => date === record.date) ?? null;
  const status = decideRecord(existing, record);

  if (status === "added" || status === "replaced") {
    const previous = records.filter(({ date }) => date < record.date).at(-1);
    if (
      previous &&
      record.station_count < previous.station_count * (1 - MAX_STATION_DROP)
    ) {
      fail(
        `Caída de estaciones sospechosa: ${record.station_count} frente a ${previous.station_count} el ${previous.date}.`,
      );
    }
    await writeAtomic(file, serialize(record));
  }
  return {
    status,
    date: record.date,
    observations: records.length + (status === "added" ? 1 : 0),
  };
}

/** Registra la observación del día a partir de la instantánea del build. */
export async function recordSnapshot(snapshot, directory) {
  return mergeRecord(createRecord(snapshot), directory);
}

/**
 * Genera los JSON estáticos que consume «Estadísticas»: la serie nacional, una
 * serie por provincia (se descarga solo al elegirla) y una copia de cada
 * registro diario, que sirve también de respaldo recuperable desde producción.
 */
export async function publishHistory(directory, output) {
  const { records, invalid } = await readRecords(directory);
  for (const { file, reason } of invalid) {
    console.warn(`Registro descartado ${file}: ${reason}`);
  }
  const latest = records.at(-1);
  const header = {
    schema_version: HISTORY_SCHEMA_VERSION,
    source: latest?.source ?? null,
    discarded: invalid.length,
  };

  // Se genera aparte y se sustituye al final: un fallo no deja a medias la
  // carpeta publicada.
  const staging = `${output}.${process.pid}.tmp`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(path.join(staging, "diario"), { recursive: true });
  await mkdir(path.join(staging, "provincias"), { recursive: true });
  try {
    await writeStaging(staging, records, header);
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { published: records.length, discarded: invalid.length };
}

async function writeStaging(output, records, header) {
  await writeFile(
    path.join(output, "nacional.json"),
    JSON.stringify({
      ...header,
      entries: records.map((record) => ({
        date: record.date,
        retrieved_at: record.retrieved_at,
        station_count: record.station_count,
        fuels: Object.fromEntries(
          HISTORY_FUELS.map((fuel) => [fuel, record.fuels[fuel].national]),
        ),
      })),
    }),
  );

  const provinceIds = new Set(
    records.flatMap((record) =>
      HISTORY_FUELS.flatMap((fuel) =>
        Object.keys(record.fuels[fuel].provinces),
      ),
    ),
  );
  for (const id of [...provinceIds].sort()) {
    const entries = records
      .map((record) => ({
        date: record.date,
        fuels: Object.fromEntries(
          HISTORY_FUELS.flatMap((fuel) => {
            const value = record.fuels[fuel].provinces[id];
            return value ? [[fuel, value]] : [];
          }),
        ),
      }))
      .filter((entry) => Object.keys(entry.fuels).length > 0);
    await writeFile(
      path.join(output, "provincias", `${id}.json`),
      JSON.stringify({ ...header, province_id: id, entries }),
    );
  }

  // Copia de cada registro tal como se validó: respaldo recuperable.
  for (const record of records) {
    await writeFile(
      path.join(output, "diario", `${record.date}.json`),
      serialize(record),
    );
  }
}

async function fetchJson(url, fetchImpl, maxBytes) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    fail(`No se pudo descargar ${url.pathname}: ${error.message}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) fail(`${url.pathname} respondió HTTP ${response.status}.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes)
    fail(`${url.pathname} es demasiado grande.`);
  return JSON.parse(text);
}

/**
 * Recupera los registros diarios publicados en producción que falten en la
 * carpeta. Sirve de respaldo si la rama de datos no está accesible y completa
 * la rama con observaciones ya publicadas cuyo guardado falló. Solo se
 * escriben registros válidos y nunca se sobrescribe uno ya presente.
 */
export async function restoreFromSite(
  siteUrl,
  directory,
  { fetchImpl = fetch } = {},
) {
  const base = new URL(siteUrl);
  if (base.protocol !== "https:" || base.username || base.password) {
    fail("La URL publicada debe ser HTTPS y sin credenciales.");
  }
  const index = await fetchJson(
    new URL("/data/historico/nacional.json", base),
    fetchImpl,
    MAX_INDEX_BYTES,
  );
  if (index === null) return { restored: 0, skipped: 0, missing: true };
  if (!isRecord(index) || !Array.isArray(index.entries)) {
    fail("El índice publicado del histórico no es válido.");
  }
  const { records } = await readRecords(directory);
  const present = new Set(records.map(({ date }) => date));
  let restored = 0;
  let skipped = 0;
  for (const { date } of index.entries) {
    if (
      typeof date !== "string" ||
      !DATE_PATTERN.test(date) ||
      present.has(date)
    ) {
      continue;
    }
    try {
      const record = validateRecord(
        await fetchJson(
          new URL(`/data/historico/diario/${date}.json`, base),
          fetchImpl,
          MAX_RECORD_BYTES,
        ),
      );
      if (record.date !== date) fail(`contiene la fecha ${record.date}.`);
      await writeAtomic(
        path.join(directory, `${date}.json`),
        serialize(record),
      );
      restored += 1;
    } catch (error) {
      console.warn(`No se recupera ${date}: ${error.message}`);
      skipped += 1;
    }
  }
  return { restored, skipped, missing: false };
}

/**
 * Copia solo los registros válidos, tal como se validaron, a la carpeta que se
 * entrega al job de guardado. Un registro corrupto heredado de la rama no
 * debe impedir guardar la observación nueva.
 */
export async function exportRecords(directory, output) {
  const { records, invalid } = await readRecords(directory);
  for (const { file, reason } of invalid) {
    console.warn(`No se entrega ${file}: ${reason}`);
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const record of records) {
    await writeFile(
      path.join(output, `${record.date}.json`),
      serialize(record),
    );
  }
  return { exported: records.length, discarded: invalid.length };
}

/** Recuento procedente de un output de Actions: vacío o ausente vale 0. */
export function parseCount(value) {
  const text = String(value ?? "").trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) fail(`Recuento no válido: «${text}».`);
  return Number(text);
}

/**
 * Decide qué hacer tras registrar y publicar, con valores explícitos para que
 * el workflow compare solo `'true'`/`'false'` y nunca convierta textos.
 * - `persist`: hay registros que la rama no tiene (el día nuevo o días
 *   publicados recuperados). Solo si se leyó la rama, la única fuente fiable.
 * - `deploy`: el histórico ganó o actualizó un día y quedó publicado en la
 *   exportación, así que la web puede mostrarlo ya.
 */
export function planHistory({ source, restored, status, publishOutcome }) {
  const dayChanged = status === "added" || status === "replaced";
  const recovered = parseCount(restored);
  return {
    persist: source === "branch" && (dayChanged || recovered > 0),
    deploy:
      dayChanged &&
      publishOutcome === "success" &&
      (source === "branch" || source === "site"),
    restored: recovered,
  };
}

async function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await writeFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, {
    flag: "a",
  });
}

const USAGE = [
  "Uso:",
  "  node scripts/price-history.mjs record <estadisticas.json> <carpeta-diario>",
  "  node scripts/price-history.mjs publish <carpeta-diario> <carpeta-salida>",
  "  node scripts/price-history.mjs restore <url-publicada> <carpeta-diario>",
  "  node scripts/price-history.mjs export <carpeta-diario> <carpeta-entrega>",
  "  node scripts/price-history.mjs plan   (lee HISTORY_SOURCE, HISTORY_RESTORED,",
  "                                         HISTORY_STATUS y HISTORY_PUBLISH_OUTCOME)",
].join("\n");

async function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === "plan") {
    const plan = planHistory({
      source: process.env.HISTORY_SOURCE,
      restored: process.env.HISTORY_RESTORED,
      status: process.env.HISTORY_STATUS,
      publishOutcome: process.env.HISTORY_PUBLISH_OUTCOME,
    });
    await setOutput("persist", String(plan.persist));
    await setOutput("deploy", String(plan.deploy));
    console.log(
      `Guardar en la rama: ${plan.persist ? "sí" : "no"}; desplegar por el histórico: ${plan.deploy ? "sí" : "no"} (${plan.restored} recuperados).`,
    );
    return;
  }
  if (!first || !second) fail(USAGE);

  if (command === "export") {
    const { exported, discarded } = await exportRecords(first, second);
    console.log(`${exported} registros entregados; ${discarded} descartados.`);
  } else if (command === "record") {
    const snapshot = JSON.parse(await readFile(first, "utf8"));
    const { status, date, observations } = await recordSnapshot(
      snapshot,
      second,
    );
    await setOutput("history_status", status);
    await setOutput("history_date", date);
    console.log(`${status}: ${date} (${observations} observaciones)`);
  } else if (command === "publish") {
    const { published, discarded } = await publishHistory(first, second);
    console.log(
      `${published} observaciones publicadas; ${discarded} descartadas.`,
    );
  } else if (command === "restore") {
    const { restored, skipped, missing } = await restoreFromSite(first, second);
    await setOutput("restored", restored);
    console.log(
      missing
        ? "Producción todavía no publica histórico."
        : `${restored} registros recuperados; ${skipped} descartados.`,
    );
  } else {
    fail(USAGE);
  }
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
