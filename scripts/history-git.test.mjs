import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { persistRecords, requireDataBranch } from "./history-git.mjs";
import {
  exportRecords,
  HISTORY_FUELS,
  MIN_HISTORY_PROVINCES,
  recordSnapshot,
} from "./price-history.mjs";

const script = fileURLToPath(new URL("./history-git.mjs", import.meta.url));
const BRANCH = "data/historico";
const quiet = { info() {}, warn() {} };

function snapshot({
  date = "2026-10-12",
  retrievedAt = `${date}T14:00:00Z`,
  mean = 1.8,
} = {}) {
  const [year, month, day] = date.split("-");
  return {
    schema_version: "1.0.0",
    retrieved_at: retrievedAt,
    reported_at: {
      raw: `${day}/${month}/${year} 16:00:00`,
      local: `${date}T16:00:00`,
    },
    source: {
      attribution: "MITECO",
      catalog: "https://example.invalid/catalogo",
      license_url: "https://creativecommons.org/licenses/by/4.0/",
    },
    station_count: 11_000,
    province_count: MIN_HISTORY_PROVINCES + 2,
    fuels: Object.fromEntries(
      HISTORY_FUELS.map((fuel) => [
        fuel,
        {
          national: { mean, min: 1.3, max: 2.3, count: 10_000 },
          provinces: [
            {
              id: "28",
              summary: { mean, min: 1.5, max: 2.1, count: 700 },
            },
          ],
          excludedStations: 1_000,
        },
      ]),
    ),
  };
}

let workspace;
let sources = 0;

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

const identity = [
  "-c",
  "user.name=Prueba",
  "-c",
  "user.email=prueba@example.invalid",
];

/** Simula GitHub: un repositorio desnudo con `main` y la rama de datos. */
async function createRemote({ withDataBranch = true } = {}) {
  const remote = path.join(workspace, "remoto.git");
  git(workspace, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  const seed = path.join(workspace, "semilla");
  git(workspace, "clone", "--quiet", remote, seed);
  await writeFile(path.join(seed, "README.md"), "app\n");
  git(seed, "add", ".");
  git(seed, ...identity, "commit", "--quiet", "-m", "app");
  git(seed, "push", "--quiet", "origin", "HEAD:main");
  if (withDataBranch) {
    git(seed, "switch", "--quiet", "--orphan", BRANCH);
    await writeFile(path.join(seed, "README.md"), "histórico\n");
    git(seed, "add", ".");
    git(seed, ...identity, "commit", "--quiet", "-m", "inicio");
    git(seed, "push", "--quiet", "origin", `HEAD:${BRANCH}`);
  }
  return remote;
}

function cloneDataBranch(remote, name) {
  const clone = path.join(workspace, name);
  git(workspace, "clone", "--quiet", "--branch", BRANCH, remote, clone);
  return clone;
}

/** Carpeta como la que entrega el job de despliegue en el artefacto. */
async function prepared(...snapshots) {
  sources += 1;
  const directory = path.join(workspace, `artefacto-${sources}`);
  await mkdir(directory, { recursive: true });
  for (const value of snapshots) await recordSnapshot(value, directory);
  return directory;
}

async function persist(repo, snapshots, options = {}) {
  return persistRecords({
    repo,
    source: await prepared(...snapshots),
    log: quiet,
    ...options,
  });
}

const remoteFiles = (remote) =>
  git(remote, "ls-tree", "-r", "--name-only", BRANCH).split("\n").sort();
const remoteLog = (remote) =>
  git(remote, "log", "--format=%s", BRANCH).split("\n");

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "fuelshift-git-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("requireDataBranch", () => {
  it.each(["main", "refs/heads/main", "data/", "data/../main", "Data/x"])(
    "rechaza %s",
    (branch) => {
      expect(() => requireDataBranch(branch)).toThrow(/rama de datos/);
    },
  );

  it("acepta la rama de datos del histórico", () => {
    expect(requireDataBranch(BRANCH)).toBe(BRANCH);
  });
});

// Cada caso crea repositorios reales: en Windows puede superar los 5 s.
describe("persistRecords", { timeout: 20_000 }, () => {
  it("guarda el día en la rama de datos sin tocar main", async () => {
    const remote = await createRemote();
    const clone = cloneDataBranch(remote, "trabajo");
    const mainBefore = git(remote, "rev-parse", "main");

    const result = await persist(clone, [snapshot()]);

    expect(result).toEqual({
      saved: [{ status: "added", date: "2026-10-12" }],
      attempts: 1,
    });
    expect(remoteFiles(remote)).toEqual([
      "README.md",
      "diario/2026-10-12.json",
    ]);
    expect(remoteLog(remote)[0]).toBe(
      "chore(historico): registrar observación del 2026-10-12",
    );
    expect(git(remote, "log", "-1", "--format=%an", BRANCH)).toBe(
      "github-actions[bot]",
    );
    expect(git(remote, "rev-parse", "main")).toBe(mainBefore);
  });

  it("no crea commits al repetir la misma observación", async () => {
    const remote = await createRemote();
    await persist(cloneDataBranch(remote, "trabajo"), [snapshot()]);
    const head = git(remote, "rev-parse", BRANCH);

    const second = await persist(cloneDataBranch(remote, "repeticion"), [
      snapshot(),
    ]);

    expect(second.saved).toEqual([]);
    expect(git(remote, "rev-parse", BRANCH)).toBe(head);
  });

  it("actualiza el día con una observación posterior y conserva las anteriores", async () => {
    const remote = await createRemote();
    const clone = cloneDataBranch(remote, "trabajo");
    await persist(clone, [snapshot({ date: "2026-10-11" })]);
    await persist(clone, [snapshot()]);

    const result = await persist(clone, [
      snapshot({ retrievedAt: "2026-10-12T18:00:00Z", mean: 1.9 }),
    ]);

    expect(result.saved).toEqual([{ status: "replaced", date: "2026-10-12" }]);
    expect(remoteFiles(remote)).toEqual([
      "README.md",
      "diario/2026-10-11.json",
      "diario/2026-10-12.json",
    ]);
    expect(remoteLog(remote)[0]).toBe(
      "chore(historico): actualizar observación del 2026-10-12",
    );
  });

  it("completa la rama con observaciones publicadas que no llegaron a guardarse", async () => {
    const remote = await createRemote();
    const clone = cloneDataBranch(remote, "trabajo");
    await persist(clone, [snapshot({ date: "2026-10-10" })]);

    // El artefacto trae la rama completa más dos días recuperados de producción.
    const result = await persist(clone, [
      snapshot({ date: "2026-10-10" }),
      snapshot({ date: "2026-10-11" }),
      snapshot({ date: "2026-10-12" }),
    ]);

    expect(result.saved.map(({ date }) => date)).toEqual([
      "2026-10-11",
      "2026-10-12",
    ]);
    expect(remoteLog(remote)[0]).toBe(
      "chore(historico): guardar 2 observaciones (2026-10-11 a 2026-10-12)",
    );
    expect(remoteFiles(remote)).toHaveLength(4);
  });

  it("no sustituye un día guardado por una observación más antigua", async () => {
    const remote = await createRemote();
    const clone = cloneDataBranch(remote, "trabajo");
    await persist(clone, [
      snapshot({ retrievedAt: "2026-10-12T18:00:00Z", mean: 1.9 }),
    ]);
    const head = git(remote, "rev-parse", BRANCH);

    const result = await persist(clone, [snapshot({ mean: 1.7 })]);

    expect(result.saved).toEqual([]);
    expect(git(remote, "rev-parse", BRANCH)).toBe(head);
  });

  it("reintenta sobre el commit de una ejecución simultánea sin perderlo", async () => {
    const remote = await createRemote();
    const runA = cloneDataBranch(remote, "ejecucion-a");
    const runB = cloneDataBranch(remote, "ejecucion-b");
    const warnings = [];

    const result = await persist(runB, [snapshot({ date: "2026-10-13" })], {
      log: { info() {}, warn: (message) => warnings.push(message) },
      // La ejecución A empuja justo antes que B: el primer push de B se rechaza.
      beforePush: async (attempt) => {
        if (attempt === 1) {
          await persist(runA, [snapshot({ date: "2026-10-12" })]);
        }
      },
    });

    expect(result).toMatchObject({ attempts: 2 });
    expect(warnings).toHaveLength(1);
    expect(remoteFiles(remote)).toEqual([
      "README.md",
      "diario/2026-10-12.json",
      "diario/2026-10-13.json",
    ]);
    // Historial lineal: B se apila sobre A sin merges ni pushes forzados.
    expect(git(remote, "rev-list", "--merges", "--count", BRANCH)).toBe("0");
    expect(remoteLog(remote)).toHaveLength(3);
  });

  it("falla tras agotar los intentos sin reescribir el remoto", async () => {
    const remote = await createRemote();
    const runA = cloneDataBranch(remote, "ejecucion-a");
    const runB = cloneDataBranch(remote, "ejecucion-b");
    let day = 20;

    await expect(
      persist(runB, [snapshot({ date: "2026-10-13" })], {
        attempts: 2,
        beforePush: async () => {
          day += 1;
          await persist(runA, [snapshot({ date: `2026-09-${day}` })]);
        },
      }),
    ).rejects.toThrow(/tras 2 intentos/);
    expect(remoteFiles(remote)).toEqual([
      "README.md",
      "diario/2026-09-21.json",
      "diario/2026-09-22.json",
    ]);
  });

  it("no crea la rama de datos si todavía no existe", async () => {
    const remote = await createRemote({ withDataBranch: false });
    const clone = path.join(workspace, "trabajo");
    git(workspace, "clone", "--quiet", remote, clone);

    await expect(persist(clone, [snapshot()])).rejects.toThrow(
      /debe crearse en la activación/,
    );
    expect(git(remote, "branch", "--list", BRANCH)).toBe("");
  });

  it("no escribe nada si el artefacto contiene un registro no válido", async () => {
    const remote = await createRemote();
    const clone = cloneDataBranch(remote, "trabajo");
    const head = git(remote, "rev-parse", BRANCH);
    const source = await prepared(snapshot());
    await writeFile(path.join(source, "2026-10-13.json"), "{ corrupto");

    await expect(
      persistRecords({ repo: clone, source, log: quiet }),
    ).rejects.toThrow(/2026-10-13\.json/);
    expect(git(remote, "rev-parse", BRANCH)).toBe(head);
  });

  it("sustituye en la rama un registro corrupto por su copia válida", async () => {
    const remote = await createRemote();
    const clone = cloneDataBranch(remote, "trabajo");
    await persist(clone, [snapshot()]);
    const broken = cloneDataBranch(remote, "corrupcion");
    await writeFile(path.join(broken, "diario", "2026-10-12.json"), "{ x");
    git(broken, "add", ".");
    git(broken, ...identity, "commit", "--quiet", "-m", "corrupción");
    git(broken, "push", "--quiet", "origin", `HEAD:${BRANCH}`);

    const result = await persist(clone, [snapshot()]);

    expect(result.saved).toEqual([{ status: "added", date: "2026-10-12" }]);
    const content = git(remote, "show", `${BRANCH}:diario/2026-10-12.json`);
    expect(JSON.parse(content).date).toBe("2026-10-12");
  });

  it("guarda el día nuevo aunque la rama tenga un registro corrupto irreparable", async () => {
    const remote = await createRemote();
    const broken = cloneDataBranch(remote, "corrupcion");
    await mkdir(path.join(broken, "diario"), { recursive: true });
    await writeFile(path.join(broken, "diario", "2026-10-11.json"), "{ x");
    git(broken, "add", ".");
    git(broken, ...identity, "commit", "--quiet", "-m", "corrupción");
    git(broken, "push", "--quiet", "origin", `HEAD:${BRANCH}`);
    // Como en el job de despliegue: el histórico leído de la rama más el día.
    const local = path.join(workspace, "diario-local");
    await mkdir(local, { recursive: true });
    await writeFile(
      path.join(local, "2026-10-11.json"),
      await readFile(path.join(broken, "diario", "2026-10-11.json")),
    );
    await recordSnapshot(snapshot(), local);
    const clone = cloneDataBranch(remote, "trabajo");

    // Entregar la carpeta tal cual bloquearía el guardado para siempre.
    await expect(
      persistRecords({ repo: clone, source: local, log: quiet }),
    ).rejects.toThrow(/2026-10-11\.json/);

    // La entrega solo contiene registros válidos: el día nuevo se guarda.
    const delivery = path.join(workspace, "entrega");
    await exportRecords(local, delivery);
    const result = await persistRecords({
      repo: clone,
      source: delivery,
      log: quiet,
    });

    expect(result.saved).toEqual([{ status: "added", date: "2026-10-12" }]);
    expect(remoteFiles(remote)).toContain("diario/2026-10-12.json");
  });

  it("se niega a escribir en main", async () => {
    const remote = await createRemote();
    const clone = cloneDataBranch(remote, "trabajo");

    await expect(
      persist(clone, [snapshot()], { branch: "main" }),
    ).rejects.toThrow(/rama de datos/);
    expect(remoteFiles(remote)).toEqual(["README.md"]);
  });
});

describe("CLI", { timeout: 20_000 }, () => {
  it("guarda las observaciones y lo comunica a Actions", async () => {
    const remote = await createRemote();
    const clone = cloneDataBranch(remote, "trabajo");
    const source = await prepared(snapshot());
    const output = path.join(workspace, "output.txt");

    const result = spawnSync(
      process.execPath,
      [script, "persist", clone, source],
      { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output } },
    );

    expect(result.status).toBe(0);
    expect(await readFile(output, "utf8")).toBe("saved=1\n");
    expect(remoteFiles(remote)).toContain("diario/2026-10-12.json");
  });

  it("explica el uso si faltan argumentos", () => {
    const result = spawnSync(process.execPath, [script, "persist"], {
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Uso:/);
  });
});
