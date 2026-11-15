// Decide si una ejecución programada debe desplegar.
//
// Compara el manifiesto publicado con el recién generado. Solo cuentan los
// hashes de los archivos provinciales (estaciones y precios): un cambio solo de
// fecha de descarga o de métricas no justifica gastar un despliegue de Pages.

import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { validatePublishedManifest } from "./fetch-published-manifest.mjs";

// Huella estable del contenido: pares [provincia, sha256] ordenados por id.
function stationContentFingerprint(manifest) {
  return JSON.stringify(
    manifest.provinces
      .map((province) => [province.id, province.sha256])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function stationDataChanged(publishedBytes, candidateBytes) {
  const published = validatePublishedManifest(publishedBytes);
  const candidate = validatePublishedManifest(candidateBytes);
  return (
    stationContentFingerprint(published) !==
    stationContentFingerprint(candidate)
  );
}

// El forzado solo vale en ejecuciones manuales; el cron nunca puede forzar.
export function deploymentDecision({
  dataChanged,
  eventName,
  forceDeployRequested,
}) {
  const forced =
    eventName === "workflow_dispatch" && forceDeployRequested === true;
  return { forced, shouldDeploy: dataChanged || forced };
}

async function main() {
  const [publishedPath, candidatePath] = process.argv.slice(2);
  if (!publishedPath || !candidatePath) {
    throw new Error(
      "Uso: node scripts/compare-miteco-data.mjs <publicado> <candidato>",
    );
  }

  const changed = stationDataChanged(
    await readFile(publishedPath),
    await readFile(candidatePath),
  );
  const decision = deploymentDecision({
    dataChanged: changed,
    eventName: process.env.GITHUB_EVENT_NAME,
    forceDeployRequested:
      process.env.FORCE_DEPLOY_REQUESTED?.trim().toLowerCase() === "true",
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `changed=${changed}\nshould_deploy=${decision.shouldDeploy}\nforced=${decision.forced}\n`,
      "utf8",
    );
  }

  if (changed) {
    console.log(
      "Se detectaron cambios en los datos normalizados de estaciones.",
    );
  } else if (decision.forced) {
    console.log(
      "Despliegue manual forzado: se publicarán los cambios de código tras superar todos los controles.",
    );
  } else {
    console.log(
      "Comprobación completada: los precios y datos de estaciones no han cambiado; no se publicará.",
    );
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
      error instanceof Error
        ? error.message
        : "Error desconocido al comparar los datos.",
    );
    process.exitCode = 1;
  }
}
