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
});
