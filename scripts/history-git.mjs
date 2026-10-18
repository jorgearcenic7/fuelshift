import { spawnSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { mergeRecord, readRecords } from "./price-history.mjs";

/**
 * Guarda en la rama de datos del histórico los registros diarios preparados
 * por el job de despliegue: la observación del día y, si las hay, las ya
 * publicadas en producción que falten en la rama.
 *
 * El repositorio indicado es un clon de esa rama. Cada intento parte del
 * estado remoto más reciente, incorpora los registros con la misma política
 * diaria que el build, confirma solo los archivos cambiados y hace un push
 * normal (nunca forzado). Si otra ejecución se adelanta, el push es rechazado
 * y se reintenta sobre su commit, de modo que ninguna observación se pierde.
 * Nunca se crea la rama ni se escribe en `main`.
 */
export const DEFAULT_BRANCH = "data/historico";
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

function fail(message) {
  throw new Error(message);
}

export function requireDataBranch(branch) {
  if (!/^data\/[a-z0-9][a-z0-9-]*$/.test(branch)) {
    fail(`La rama ${branch} no es una rama de datos (data/...).`);
  }
  return branch;
}

function gitRunner(repo) {
  return (args, { allowFailure = false } = {}) => {
    const result = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && !allowFailure) {
      fail(`git ${args[0]} falló: ${result.stderr.trim()}`);
    }
    return result;
  };
}

function commitMessage(saved) {
  if (saved.length === 1) {
    const [{ date, status }] = saved;
    return `chore(historico): ${status === "added" ? "registrar" : "actualizar"} observación del ${date}`;
  }
  return `chore(historico): guardar ${saved.length} observaciones (${saved[0].date} a ${saved.at(-1).date})`;
}

export async function persistRecords({
  repo,
  source,
  remote = "origin",
  branch = DEFAULT_BRANCH,
  attempts = 3,
  beforePush = async () => {},
  log = console,
}) {
  requireDataBranch(branch);
  const { records, invalid } = await readRecords(source);
  if (invalid.length > 0) {
    fail(
      `Registros no válidos para guardar: ${invalid.map(({ file }) => file).join(", ")}.`,
    );
  }
  const git = gitRunner(repo);
  const tracking = `refs/remotes/${remote}/${branch}`;
  const target = path.join(repo, "diario");

  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const fetched = git(
      ["fetch", "--no-tags", remote, `+refs/heads/${branch}:${tracking}`],
      { allowFailure: true },
    );
    if (fetched.status !== 0) {
      fail(
        `No se pudo leer ${branch}; debe crearse en la activación: ${fetched.stderr.trim()}`,
      );
    }
    git(["switch", "--quiet", "--discard-changes", "-C", branch, tracking]);

    const saved = [];
    for (const record of records) {
      const { status, date } = await mergeRecord(record, target);
      if (status === "added" || status === "replaced") {
        saved.push({ status, date });
      }
    }
    if (saved.length === 0) {
      log.info(
        `${branch} ya contiene estas observaciones; no hay nada que guardar.`,
      );
      return { saved, attempts: attempt };
    }

    git(["add", "--", ...saved.map(({ date }) => `diario/${date}.json`)]);
    git([
      "-c",
      `user.name=${BOT_NAME}`,
      "-c",
      `user.email=${BOT_EMAIL}`,
      "commit",
      "--quiet",
      "-m",
      commitMessage(saved),
    ]);

    await beforePush(attempt);
    const pushed = git(
      ["push", "--quiet", remote, `HEAD:refs/heads/${branch}`],
      {
        allowFailure: true,
      },
    );
    if (pushed.status === 0) {
      log.info(`${commitMessage(saved)}: guardado en ${branch}.`);
      return { saved, attempts: attempt };
    }
    lastError = pushed.stderr.trim();
    log.warn(
      `Intento ${attempt}/${attempts}: el push a ${branch} fue rechazado; se reintenta sobre el estado remoto.`,
    );
  }
  fail(
    `No se pudieron guardar las observaciones en ${branch} tras ${attempts} intentos: ${lastError}`,
  );
}

async function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const [command, repo, source] = process.argv.slice(2);
  if (command !== "persist" || !repo || !source) {
    fail(
      "Uso: node scripts/history-git.mjs persist <clon-rama-datos> <carpeta-diario>",
    );
  }
  const { saved } = await persistRecords({
    repo: path.resolve(repo),
    source: path.resolve(source),
  });
  await setOutput("saved", saved.length);
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
