import { afterEach, describe, expect, it, vi } from "vitest";

import manifestFixture from "./__fixtures__/manifest.test.json";
import provinceFixture from "./__fixtures__/province.test.json";
import {
  DataContractError,
  clearMitecoCacheForTests,
  loadMitecoManifest,
  loadMitecoStations,
  parseManifest,
  parseProvince,
} from "./miteco";

function mockFetch(responses: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) =>
    url in responses
      ? new Response(JSON.stringify(responses[url]), { status: 200 })
      : new Response("", { status: 404 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearMitecoCacheForTests();
});

describe("contrato estático MITECO", () => {
  it("lee un manifiesto válido y conserva las dos fechas globales", () => {
    const manifest = parseManifest(manifestFixture);

    expect(manifest.station_count).toBe(2);
    expect(manifest.retrieved_at).toBe("2026-10-11T15:07:33Z");
    expect(manifest.source.reported_at.raw).toBe("11/10/2026 17:07:30");
    expect(manifest.source.reported_at.timezone).toBeNull();
  });

  it("rechaza rutas provinciales fuera del contrato", () => {
    const unsafe = structuredClone(manifestFixture);
    unsafe.provinces[0].file = "../secret.json";

    expect(() => parseManifest(unsafe)).toThrow(DataContractError);
  });

  it("valida estaciones y añade la provincia sin inventar datos", () => {
    const province = parseProvince(provinceFixture);

    expect(province.stations).toHaveLength(2);
    expect(province.stations[0]).toMatchObject({
      id: "test-101",
      provinceId: "28",
      provinceName: "MADRID",
      opening_hours: "L-D: 24H",
    });
    expect(province.stations[1].brand).toBeNull();
  });

  it("rechaza precios que no sean cadenas decimales positivas", () => {
    const invalid = structuredClone(provinceFixture);
    invalid.stations[0].fuels.gasoline_95_e5 = "0";

    expect(() => parseProvince(invalid)).toThrow(/precio/);
  });

  type Manifest = typeof manifestFixture;
  it.each<[string, (manifest: Manifest) => unknown]>([
    ["no es un objeto", () => []],
    [
      "usa otra versión del contrato",
      (manifest) => ({ ...manifest, schema_version: "2.0.0" }),
    ],
    [
      "atribuye una zona horaria que MITECO no publica",
      (manifest) => {
        manifest.source.reported_at.timezone = "Europe/Madrid" as never;
        return manifest;
      },
    ],
    [
      "no cuadra el recuento de provincias",
      (manifest) => ({ ...manifest, province_count: 2 }),
    ],
    [
      "no cuadra el recuento nacional de estaciones",
      (manifest) => ({ ...manifest, station_count: 3 }),
    ],
    [
      "tiene un recuento no numérico",
      (manifest) => {
        manifest.provinces[0].station_count = "2" as never;
        return manifest;
      },
    ],
  ])("rechaza un manifiesto que %s", (_reason, mutate) => {
    expect(() =>
      parseManifest(mutate(structuredClone(manifestFixture))),
    ).toThrow(DataContractError);
  });

  type Province = typeof provinceFixture;
  it.each<[string, (province: Province) => void]>([
    [
      "duplica un identificador",
      (province) => {
        province.stations[1].id = province.stations[0].id;
      },
    ],
    [
      "declara un combustible fuera del contrato",
      (province) => {
        Object.assign(province.stations[0].fuels, { kerosene: "1.000" });
      },
    ],
    [
      "usa como combustible una clave heredada del prototipo",
      (province) => {
        Object.assign(province.stations[0].fuels, { toString: "1.000" });
      },
    ],
    [
      "sitúa una estación fuera de España",
      (province) => {
        province.stations[0].location.latitude = 48.85;
      },
    ],
    [
      "usa otra versión del contrato",
      (province) => {
        province.schema_version = "2.0.0";
      },
    ],
  ])("rechaza un archivo provincial que %s", (_reason, mutate) => {
    const invalid = structuredClone(provinceFixture);
    mutate(invalid);

    expect(() => parseProvince(invalid)).toThrow(DataContractError);
  });
});

describe("carga de datos estáticos", () => {
  it("informa explícitamente cuando no hay datos preparados", async () => {
    mockFetch({});

    await expect(
      loadMitecoManifest(new AbortController().signal, "/d/"),
    ).rejects.toThrow("No hay datos MITECO preparados para la web.");
  });

  it("carga las provincias del manifiesto una sola vez", async () => {
    const fetchMock = mockFetch({
      "/d/manifest.json": manifestFixture,
      "/d/provinces/28.json": provinceFixture,
    });
    const signal = new AbortController().signal;
    const manifest = await loadMitecoManifest(signal, "/d/");
    const onProvince = vi.fn();

    const first = await loadMitecoStations({
      manifest,
      signal,
      onProvince,
      dataRoot: "/d/",
    });
    await loadMitecoStations({ manifest, signal, onProvince, dataRoot: "/d/" });

    expect(first.failed).toEqual([]);
    expect(onProvince).toHaveBeenCalledTimes(2);
    expect(onProvince.mock.calls[0][0].stations).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("descarta la provincia que no coincide con el manifiesto", async () => {
    const manifest = parseManifest(manifestFixture);
    const truncated = structuredClone(provinceFixture);
    truncated.stations.pop();
    mockFetch({ "/d/provinces/28.json": truncated });
    const onProvince = vi.fn();

    const { failed } = await loadMitecoStations({
      manifest,
      signal: new AbortController().signal,
      onProvince,
      dataRoot: "/d/",
    });

    expect(onProvince).not.toHaveBeenCalled();
    expect(failed).toEqual([
      "MADRID: La provincia 28 no coincide con el manifiesto.",
    ]);
  });

  it("indica el estado HTTP cuando falla el servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );

    await expect(
      loadMitecoManifest(new AbortController().signal, "/d/"),
    ).rejects.toThrow("No se pudo cargar /d/manifest.json (HTTP 503).");
  });

  it("no informa como fallidas las provincias de una carga cancelada", async () => {
    const manifest = parseManifest(manifestFixture);
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw new DOMException("Cancelada", "AbortError");
      }),
    );
    const onProvince = vi.fn();

    const { failed } = await loadMitecoStations({
      manifest,
      signal: controller.signal,
      onProvince,
      dataRoot: "/d/",
    });

    expect(onProvince).not.toHaveBeenCalled();
    expect(failed).toEqual([]);
  });
});
