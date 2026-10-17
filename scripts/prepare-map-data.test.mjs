import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("./prepare-map-data.mjs", import.meta.url),
);

let workspace;

function provinceBytes(id, stationIds) {
  return Buffer.from(
    JSON.stringify({
      province: { id, name: `Provincia ${id}` },
      schema_version: "1.0.0",
      stations: stationIds.map((stationId) => ({ id: stationId })),
    }),
  );
}

async function writeDataset(directory, provinces, overrides = {}) {
  await mkdir(path.join(workspace, directory, "provinces"), {
    recursive: true,
  });
  const entries = [];
  for (const [id, stationIds] of Object.entries(provinces)) {
    const bytes = provinceBytes(id, stationIds);
    const file = `provinces/${id}.json`;
    await writeFile(path.join(workspace, directory, file), bytes);
    entries.push({
      id,
      file,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      station_count: stationIds.length,
    });
  }
  const manifest = {
    schema_version: "1.0.0",
    province_count: entries.length,
    station_count: entries.reduce(
      (total, entry) => total + entry.station_count,
      0,
    ),
    provinces: entries,
    ...overrides,
  };
  await writeFile(
    path.join(workspace, directory, "manifest.json"),
    JSON.stringify(manifest),
  );
  return manifest;
}

function prepare(source = "candidate", destination = "public/data") {
  return spawnSync(process.execPath, [script, source, destination], {
    cwd: workspace,
    encoding: "utf8",
  });
}

const readPublished = (file) =>
  readFile(path.join(workspace, "public/data", file), "utf8");

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "fuelshift-prepare-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("prepare-map-data", () => {
  it("publica un conjunto válido con el manifiesto y sus provincias", async () => {
    await writeDataset("candidate", { 28: ["1", "2"], "08": ["3"] });

    const result = prepare();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("3 estaciones en 2 provincias");
    expect(JSON.parse(await readPublished("manifest.json")).station_count).toBe(
      3,
    );
    expect(await readPublished("provinces/08.json")).toContain('"3"');
  });

  it("conserva el último conjunto válido si el candidato está corrupto", async () => {
    await writeDataset("candidate", { 28: ["1"] });
    expect(prepare().status).toBe(0);
    const previous = await readPublished("provinces/28.json");

    await writeDataset("candidate", { 28: ["1", "2"] });
    await writeFile(
      path.join(workspace, "candidate/provinces/28.json"),
      provinceBytes("28", ["9", "8"]),
    );
    const result = prepare();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SHA-256");
    expect(await readPublished("provinces/28.json")).toBe(previous);
  });

  it.each([
    [
      "una estación duplicada entre provincias",
      { 28: ["1"], "08": ["1"] },
      {},
      "duplicada",
    ],
    [
      "un recuento nacional incorrecto",
      { 28: ["1"] },
      { station_count: 5 },
      "recuento nacional",
    ],
    [
      "una versión de contrato incompatible",
      { 28: ["1"] },
      { schema_version: "2.0.0" },
      "versión del contrato",
    ],
  ])("rechaza %s", async (_reason, provinces, overrides, message) => {
    await writeDataset("candidate", provinces, overrides);

    const result = prepare();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
  });

  it("rechaza rutas provinciales fuera del contrato", async () => {
    const manifest = await writeDataset("candidate", { 28: ["1"] });
    manifest.provinces[0].file = "../manifest.json";
    await writeFile(
      path.join(workspace, "candidate/manifest.json"),
      JSON.stringify(manifest),
    );

    const result = prepare();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Ruta provincial no permitida");
  });

  it("rechaza destinos fuera del repositorio", async () => {
    await writeDataset("candidate", { 28: ["1"] });

    const result = prepare("candidate", "../fuera");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("dentro del repositorio");
  });
});
