import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  seedPublishedManifest,
  validatePublishedManifest,
} from "./fetch-published-manifest.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function manifestBytes(stationCount = 11_511) {
  return Buffer.from(
    JSON.stringify({ schema_version: "1.0.0", station_count: stationCount }),
  );
}

function jsonResponse(body, init = {}) {
  return new Response(body, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("validatePublishedManifest", () => {
  it("acepta el contrato y un recuento positivo", () => {
    expect(validatePublishedManifest(manifestBytes()).station_count).toBe(
      11_511,
    );
  });

  it.each([
    [{ schema_version: "2.0.0", station_count: 11_511 }],
    [{ schema_version: "1.0.0", station_count: 0 }],
    [{ schema_version: "1.0.0", station_count: "11511" }],
  ])("rechaza un manifiesto incompatible: %j", (manifest) => {
    expect(() =>
      validatePublishedManifest(Buffer.from(JSON.stringify(manifest))),
    ).toThrow();
  });
});

describe("seedPublishedManifest", () => {
  it("exige una URL publicada salvo en el primer despliegue", async () => {
    await expect(
      seedPublishedManifest({ publishedSiteUrl: "", log: console }),
    ).rejects.toThrow("Falta CLOUDFLARE_PAGES_URL");
  });

  it("permite explícitamente que el primer despliegue no tenga manifiesto", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    await expect(
      seedPublishedManifest({
        publishedSiteUrl: "https://fuelshift.pages.dev",
        allowMissing: true,
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 404 })),
        log,
      }),
    ).resolves.toEqual({ status: "missing" });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("bloquea un 404 después del primer despliegue", async () => {
    await expect(
      seedPublishedManifest({
        publishedSiteUrl: "https://fuelshift.pages.dev",
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 404 })),
        log: { info: vi.fn(), warn: vi.fn() },
      }),
    ).rejects.toThrow("HTTP 404");
  });

  it("guarda un manifiesto válido para la comparación histórica", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fuelshift-manifest-"));
    temporaryDirectories.push(directory);
    const destination = path.join(directory, "manifest.json");
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(manifestBytes()));

    await expect(
      seedPublishedManifest({
        publishedSiteUrl: "https://fuelshift.pages.dev/otra/ruta",
        destination,
        fetchImpl,
        log: { info: vi.fn(), warn: vi.fn() },
      }),
    ).resolves.toEqual({ status: "seeded", stationCount: 11_511 });

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://fuelshift.pages.dev/data/miteco/manifest.json"),
      expect.objectContaining({ redirect: "error" }),
    );
    expect(await readFile(destination)).toEqual(manifestBytes());
  });

  it("rechaza respuestas que no sean JSON", async () => {
    await expect(
      seedPublishedManifest({
        publishedSiteUrl: "https://fuelshift.pages.dev",
        fetchImpl: vi.fn().mockResolvedValue(
          new Response("<html></html>", {
            headers: { "Content-Type": "text/html" },
          }),
        ),
        log: { info: vi.fn(), warn: vi.fn() },
      }),
    ).rejects.toThrow("Content-Type inesperado");
  });

  it("rechaza URLs sin HTTPS o con credenciales", async () => {
    await expect(
      seedPublishedManifest({
        publishedSiteUrl: "http://user:secret@fuelshift.example",
        fetchImpl: vi.fn(),
        log: { info: vi.fn(), warn: vi.fn() },
      }),
    ).rejects.toThrow("URL HTTPS sin credenciales");
  });
});
