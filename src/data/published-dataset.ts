import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DataContractError,
  parseManifest,
  parseProvince,
  type MitecoManifest,
  type ProvinceDataset,
} from "./miteco";

/**
 * Solo para el servidor durante `next build`: lee la copia validada que
 * `npm run data:prepare` deja en `public/data/miteco/`. El navegador nunca
 * descarga el conjunto completo para las estadísticas.
 */
export const PUBLISHED_DATA_ROOT = path.join(
  process.cwd(),
  "public",
  "data",
  "miteco",
);

export interface PublishedDataset {
  manifest: MitecoManifest;
  provinces: ProvinceDataset[];
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/** Devuelve `null` si no hay datos preparados; lanza si están corruptos. */
export async function loadPublishedDataset(
  root = PUBLISHED_DATA_ROOT,
): Promise<PublishedDataset | null> {
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(path.join(root, "manifest.json"));
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));

  const provinces: ProvinceDataset[] = [];
  for (const entry of manifest.provinces) {
    const bytes = await readFile(path.join(root, ...entry.file.split("/")));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== entry.bytes || hash !== entry.sha256) {
      throw new DataContractError(
        `El archivo ${entry.file} no coincide con el manifiesto.`,
      );
    }
    const dataset = parseProvince(JSON.parse(bytes.toString("utf8")));
    if (
      dataset.province.id !== entry.id ||
      dataset.stations.length !== entry.station_count
    ) {
      throw new DataContractError(
        `La provincia ${entry.id} no coincide con el manifiesto.`,
      );
    }
    provinces.push(dataset);
  }
  return { manifest, provinces };
}
