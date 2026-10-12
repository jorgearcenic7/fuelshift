import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MANIFEST_PATH = "/data/miteco/manifest.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_DESTINATION = "data/processed/miteco/manifest.json";

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

  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    throw new Error("El manifiesto publicado debe ser un objeto JSON.");
  }
  if (manifest.schema_version !== "1.0.0") {
    throw new Error("El manifiesto publicado usa un contrato incompatible.");
  }
  if (
    !Number.isSafeInteger(manifest.station_count) ||
    manifest.station_count <= 0
  ) {
    throw new Error("El manifiesto publicado tiene station_count no válido.");
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
