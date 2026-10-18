import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import manifestFixture from "./__fixtures__/manifest.test.json";
import provinceFixture from "./__fixtures__/province.test.json";
import { DataContractError } from "./miteco";
import { loadPublishedDataset } from "./published-dataset";
import { buildStatisticsSnapshot } from "./statistics-snapshot";

let root: string;

async function publish(
  province: unknown = provinceFixture,
  tamper?: (bytes: Buffer) => Buffer,
) {
  const bytes = Buffer.from(JSON.stringify(province));
  await mkdir(path.join(root, "provinces"), { recursive: true });
  await writeFile(
    path.join(root, "provinces", "28.json"),
    tamper ? tamper(bytes) : bytes,
  );
  const manifest = structuredClone(manifestFixture);
  manifest.provinces[0].bytes = bytes.byteLength;
  manifest.provinces[0].sha256 = createHash("sha256")
    .update(bytes)
    .digest("hex");
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "fuelshift-published-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loadPublishedDataset", () => {
  it("devuelve null si todavía no hay datos preparados", async () => {
    expect(await loadPublishedDataset(root)).toBeNull();
  });

  it("lee y valida el manifiesto y las provincias publicadas", async () => {
    await publish();

    const dataset = await loadPublishedDataset(root);

    expect(dataset!.manifest.station_count).toBe(2);
    expect(dataset!.provinces).toHaveLength(1);
    expect(dataset!.provinces[0].stations[0].provinceName).toBe("MADRID");
  });

  it("rechaza un archivo provincial que no coincide con su hash", async () => {
    await publish(provinceFixture, (bytes) =>
      Buffer.from(bytes.toString("utf8").replace("1.499", "1.399")),
    );

    await expect(loadPublishedDataset(root)).rejects.toThrow(DataContractError);
  });

  it("rechaza una provincia con un recuento distinto del manifiesto", async () => {
    const truncated = structuredClone(provinceFixture);
    truncated.stations.pop();
    await publish(truncated);

    await expect(loadPublishedDataset(root)).rejects.toThrow(
      /no coincide con el manifiesto/,
    );
  });
});

describe("buildStatisticsSnapshot", () => {
  it("resume los tres combustibles con la procedencia y fecha del conjunto", async () => {
    await publish();
    const snapshot = buildStatisticsSnapshot(
      (await loadPublishedDataset(root))!,
    );

    expect(snapshot).toMatchObject({
      schema_version: "1.0.0",
      retrieved_at: "2026-10-11T15:07:33Z",
      reported_at: { raw: "11/10/2026 17:07:30" },
      station_count: 2,
      province_count: 1,
    });
    expect(Object.keys(snapshot.fuels)).toEqual([
      "gasoline_95_e5",
      "gasoline_98_e5",
      "diesel_a",
    ]);
    // El fixture solo tiene una estación con Gasolina 98 E5.
    expect(snapshot.fuels.gasoline_98_e5.national).toMatchObject({
      count: 1,
      mean: 1.699,
    });
    expect(snapshot.fuels.gasoline_98_e5.excludedStations).toBe(1);
  });
});
