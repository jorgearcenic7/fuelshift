import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MANIFEST_PATH = "/data/miteco/manifest.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_DESTINATION = "data/processed/miteco/manifest.json";

function requireRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} debe ser un objeto JSON.`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} debe ser un entero positivo.`);
  }
  return value;
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} no tiene un formato válido.`);
  }
  return value;
}

function requirePublishedSiteUrl(value) {
  if (!value) return null;

  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "CLOUDFLARE_PAGES_URL debe ser una URL HTTPS sin credenciales.",
    );
  }
  return new URL(MANIFEST_PATH, url);
}

export function validatePublishedManifest(bytes) {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error("El manifiesto publicado supera el límite de 1 MiB.");
  }

  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error("El manifiesto publicado no contiene JSON válido.", {
      cause: error,
    });
  }

  requireRecord(manifest, "El manifiesto publicado");
  if (manifest.schema_version !== "1.0.0") {
    throw new Error("El manifiesto publicado usa un contrato incompatible.");
  }
  const stationCount = requirePositiveInteger(
    manifest.station_count,
    "station_count",
  );
  const provinceCount = requirePositiveInteger(
    manifest.province_count,
    "province_count",
  );
  if (!Array.isArray(manifest.provinces)) {
    throw new Error("provinces debe ser una lista.");
  }
  if (manifest.provinces.length !== provinceCount) {
    throw new Error("province_count no coincide con la lista de provincias.");
  }

  const provinceIds = new Set();
  let countedStations = 0;
  for (const [index, rawProvince] of manifest.provinces.entries()) {
    const province = requireRecord(rawProvince, `provinces[${index}]`);
    const id = requireString(province.id, `provinces[${index}].id`, /^\d{2}$/);
    if (provinceIds.has(id)) {
      throw new Error(`El manifiesto publicado repite la provincia ${id}.`);
    }
    provinceIds.add(id);
    requireString(
      province.file,
      `provinces[${index}].file`,
      new RegExp(`^provinces/${id}\\.json$`),
    );
    requireString(
      province.sha256,
      `provinces[${index}].sha256`,
      /^[0-9a-f]{64}$/,
    );
    requirePositiveInteger(province.bytes, `provinces[${index}].bytes`);
    countedStations += requirePositiveInteger(
      province.station_count,
      `provinces[${index}].station_count`,
    );
  }
  if (countedStations !== stationCount) {
    throw new Error(
      "station_count no coincide con los recuentos de las provincias.",
    );
  }

  return manifest;
}

async function readResponseWithLimit(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
    throw new Error("El manifiesto publicado supera el límite de 1 MiB.");
  }
  if (!response.body) {
    throw new Error("La respuesta del manifiesto publicado está vacía.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_MANIFEST_BYTES) {
      await reader.cancel();
      throw new Error("El manifiesto publicado supera el límite de 1 MiB.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function seedPublishedManifest({
  publishedSiteUrl,
  allowMissing = false,
  destination = DEFAULT_DESTINATION,
  fetchImpl = fetch,
  log = console,
}) {
  const manifestUrl = requirePublishedSiteUrl(publishedSiteUrl);
  if (!manifestUrl) {
    if (!allowMissing) {
      throw new Error(
        "Falta CLOUDFLARE_PAGES_URL. Solo el primer despliegue puede omitir el manifiesto publicado.",
      );
    }
    log.warn(
      "Primer despliegue autorizado sin manifiesto publicado para comparar.",
    );
    return { status: "missing" };
  }

  const response = await fetchImpl(manifestUrl, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 && allowMissing) {
    log.warn(
      "Primer despliegue autorizado: todavía no existe un manifiesto publicado.",
    );
    return { status: "missing" };
  }
  if (!response.ok) {
    throw new Error(
      `No se pudo recuperar el manifiesto publicado (HTTP ${response.status}).`,
    );
  }

  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new Error(
      `El manifiesto publicado tiene Content-Type inesperado: ${mediaType ?? "ausente"}.`,
    );
  }

  const bytes = await readResponseWithLimit(response);
  const manifest = validatePublishedManifest(bytes);
  const resolvedDestination = path.resolve(destination);
  const temporary = `${resolvedDestination}.tmp-${process.pid}`;
  await mkdir(path.dirname(resolvedDestination), { recursive: true });
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, resolvedDestination);
  } finally {
    await rm(temporary, { force: true });
  }

  log.info(
    `Manifiesto publicado recuperado: ${manifest.station_count} estaciones de referencia.`,
  );
  return { status: "seeded", stationCount: manifest.station_count };
}

async function main() {
  await seedPublishedManifest({
    publishedSiteUrl: process.env.CLOUDFLARE_PAGES_URL?.trim(),
    allowMissing:
      process.env.ALLOW_MISSING_PUBLISHED_MANIFEST?.trim().toLowerCase() ===
      "true",
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Error desconocido al leer el manifiesto.",
    );
    process.exitCode = 1;
  }
}
