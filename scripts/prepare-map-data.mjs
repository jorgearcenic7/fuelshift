import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workspace = process.cwd();
const source = path.resolve(
  workspace,
  process.argv[2] ?? "data/processed/miteco",
);
const destination = path.resolve(
  workspace,
  process.argv[3] ?? "public/data/miteco",
);

function isInsideWorkspace(candidate) {
  const relative = path.relative(workspace, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

if (
  !isInsideWorkspace(source) ||
  !isInsideWorkspace(destination) ||
  source === destination
) {
  throw new Error(
    "Las rutas de origen y destino deben ser directorios distintos dentro del repositorio.",
  );
}

function requireRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} no es un objeto JSON válido.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} no es una cadena válida.`);
  }
  return value;
}

function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} no es un entero válido.`);
  }
  return value;
}

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function validate() {
  const manifestBytes = await readFile(path.join(source, "manifest.json"));
  const manifest = requireRecord(
    JSON.parse(manifestBytes.toString("utf8")),
    "manifest.json",
  );
  if (manifest.schema_version !== "1.0.0") {
    throw new Error("La versión del contrato no es compatible con el mapa.");
  }
  if (!Array.isArray(manifest.provinces)) {
    throw new Error("El manifiesto no contiene una lista de provincias.");
  }

  const expectedProvinceCount = requireInteger(
    manifest.province_count,
    "province_count",
  );
  const expectedStationCount = requireInteger(
    manifest.station_count,
    "station_count",
  );
  if (manifest.provinces.length !== expectedProvinceCount) {
    throw new Error("El recuento de provincias del manifiesto no coincide.");
  }

  const files = [];
  const stationIds = new Set();
  let stationCount = 0;
  for (const [index, rawEntry] of manifest.provinces.entries()) {
    const entry = requireRecord(rawEntry, `provinces[${index}]`);
    const id = requireString(entry.id, `provinces[${index}].id`);
    const relativeFile = requireString(entry.file, `provinces[${index}].file`);
    if (!/^provinces\/\d{2}\.json$/.test(relativeFile)) {
      throw new Error(`Ruta provincial no permitida: ${relativeFile}`);
    }

    const sourceFile = path.join(source, ...relativeFile.split("/"));
    const bytes = await readFile(sourceFile);
    const expectedBytes = requireInteger(entry.bytes, `${relativeFile}.bytes`);
    const expectedHash = requireString(entry.sha256, `${relativeFile}.sha256`);
    if (bytes.byteLength !== expectedBytes) {
      throw new Error(
        `El tamaño de ${relativeFile} no coincide con el manifiesto.`,
      );
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== expectedHash) {
      throw new Error(
        `El hash SHA-256 de ${relativeFile} no coincide con el manifiesto.`,
      );
    }

    const dataset = requireRecord(
      JSON.parse(bytes.toString("utf8")),
      relativeFile,
    );
    const province = requireRecord(
      dataset.province,
      `${relativeFile}.province`,
    );
    if (
      dataset.schema_version !== "1.0.0" ||
      province.id !== id ||
      !Array.isArray(dataset.stations)
    ) {
      throw new Error(`${relativeFile} no respeta el contrato provincial.`);
    }
    const expectedCount = requireInteger(
      entry.station_count,
      `${relativeFile}.station_count`,
    );
    if (dataset.stations.length !== expectedCount) {
      throw new Error(
        `El recuento de estaciones de ${relativeFile} no coincide.`,
      );
    }
    for (const [stationIndex, rawStation] of dataset.stations.entries()) {
      const station = requireRecord(
        rawStation,
        `${relativeFile}.stations[${stationIndex}]`,
      );
      const stationId = requireString(
        station.id,
        `${relativeFile}.stations[${stationIndex}].id`,
      );
      if (stationIds.has(stationId)) {
        throw new Error(
          `La estación ${stationId} está duplicada en el conjunto nacional.`,
        );
      }
      stationIds.add(stationId);
    }
    stationCount += dataset.stations.length;
    files.push({ relativeFile, bytes });
  }

  if (stationCount !== expectedStationCount) {
    throw new Error(
      "El recuento nacional de estaciones no coincide con el manifiesto.",
    );
  }
  return {
    manifestBytes,
    files,
    provinceCount: expectedProvinceCount,
    stationCount,
  };
}

async function publish(validated) {
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, ".miteco-staging-"));
  const backup = path.join(parent, `.miteco-backup-${process.pid}`);

  try {
    await mkdir(path.join(temporary, "provinces"));
    await writeFile(
      path.join(temporary, "manifest.json"),
      validated.manifestBytes,
    );
    for (const file of validated.files) {
      await writeFile(
        path.join(temporary, ...file.relativeFile.split("/")),
        file.bytes,
      );
    }

    const hadPrevious = await exists(destination);
    if (hadPrevious) await rename(destination, backup);
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (hadPrevious && (await exists(backup)))
        await rename(backup, destination);
      throw error;
    }
    if (hadPrevious) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

const validated = await validate();
await publish(validated);
console.log(
  `Datos preparados: ${validated.stationCount} estaciones en ${validated.provinceCount} provincias → ${path.relative(workspace, destination)}`,
);
