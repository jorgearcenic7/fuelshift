import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import manifestFixture from "./__fixtures__/manifest.test.json";
import provinceFixture from "./__fixtures__/province.test.json";
import { loadStatisticsPageData } from "./statistics-page";

let root: string;
let dataRoot: string;
let historyFile: string;

async function publishDataset(provinceBytes = JSON.stringify(provinceFixture)) {
  await mkdir(path.join(dataRoot, "provinces"), { recursive: true });
  await writeFile(path.join(dataRoot, "provinces", "28.json"), provinceBytes);
  const manifest = structuredClone(manifestFixture);
  manifest.provinces[0].bytes = Buffer.byteLength(provinceBytes);
  manifest.provinces[0].sha256 = createHash("sha256")
    .update(provinceBytes)
    .digest("hex");
  await writeFile(
    path.join(dataRoot, "manifest.json"),
    JSON.stringify(manifest),
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "fuelshift-estadisticas-"));
  dataRoot = path.join(root, "miteco");
  historyFile = path.join(root, "history", "precios.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadStatisticsPageData", () => {
  it("indica un estado vacío si no hay datos preparados", async () => {
    expect(await loadStatisticsPageData({ dataRoot, historyFile })).toEqual({
      status: "empty",
    });
  });

  it("no muestra estadísticas si los datos no superan la validación", async () => {
    await publishDataset();
    await writeFile(path.join(dataRoot, "provinces", "28.json"), "{}");

    const data = await loadStatisticsPageData({ dataRoot, historyFile });

    expect(data.status).toBe("error");
  });

  it("muestra las estadísticas aunque todavía no exista histórico", async () => {
    await publishDataset();

    const data = await loadStatisticsPageData({ dataRoot, historyFile });

    expect(data).toMatchObject({
      status: "ready",
      history: null,
      historyError: null,
    });
  });

  it("conserva las estadísticas actuales si el histórico está corrupto", async () => {
    await publishDataset();
    await mkdir(path.dirname(historyFile), { recursive: true });
    await writeFile(historyFile, JSON.stringify({ schema_version: "9.9.9" }));

    const data = await loadStatisticsPageData({ dataRoot, historyFile });

    expect(data.status).toBe("ready");
    if (data.status !== "ready") return;
    expect(data.snapshot.station_count).toBe(2);
    expect(data.history).toBeNull();
    expect(data.historyError).toMatch(/versión/);
  });
});
