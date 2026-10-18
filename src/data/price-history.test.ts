import { describe, expect, it, vi } from "vitest";

import { DataContractError } from "./miteco";
import {
  fetchNationalHistory,
  fetchProvinceHistory,
  historyObservations,
  historyTimeline,
  parseNationalHistory,
  parseProvinceHistory,
} from "./price-history";

const national = (mean = 1.8) => ({
  mean,
  min: 1.5,
  max: 2.1,
  count: 9_000,
  excluded: 1_000,
});
const nationalEntry = (date: string, mean?: number) => ({
  date,
  retrieved_at: `${date}T14:00:00Z`,
  station_count: 11_000,
  fuels: {
    gasoline_95_e5: national(mean),
    gasoline_98_e5: national(mean),
    diesel_a: national(mean),
  },
});
const header = { schema_version: "1.0.0", source: null, discarded: 0 };
const validNational = {
  ...header,
  entries: [nationalEntry("2026-10-12"), nationalEntry("2026-10-13", 1.82)],
};
const validProvince = {
  ...header,
  province_id: "28",
  entries: [
    { date: "2026-10-12", fuels: { diesel_a: { mean: 1.75, count: 700 } } },
    {
      date: "2026-10-13",
      fuels: { gasoline_95_e5: { mean: 1.79, count: 690 } },
    },
  ],
};

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => Response.json(body, { status }));

describe("parseNationalHistory", () => {
  it("acepta el formato publicado por scripts/price-history.mjs", () => {
    const parsed = parseNationalHistory({ ...validNational, discarded: 2 });

    expect(parsed.discarded).toBe(2);
    expect(parsed.entries.map((entry) => entry.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
    ]);
    expect(parsed.entries[1].fuels.diesel_a?.mean).toBe(1.82);
    expect(parsed.entries[0].fuels.diesel_a?.excluded).toBe(1_000);
  });

  it.each([
    ["otra versión", { ...validNational, schema_version: "2.0.0" }],
    ["sin entradas", { ...header }],
    [
      "fechas repetidas",
      {
        ...validNational,
        entries: [nationalEntry("2026-10-12"), nationalEntry("2026-10-12")],
      },
    ],
    [
      "fechas desordenadas",
      {
        ...validNational,
        entries: [nationalEntry("2026-10-13"), nationalEntry("2026-10-12")],
      },
    ],
    [
      "una media no válida",
      { ...validNational, entries: [nationalEntry("2026-10-12", -1)] },
    ],
    [
      "un máximo inferior al mínimo",
      {
        ...validNational,
        entries: [
          {
            ...nationalEntry("2026-10-12"),
            fuels: { diesel_a: { ...national(), min: 3 } },
          },
        ],
      },
    ],
    [
      "un combustible que no es un objeto",
      {
        ...validNational,
        entries: [{ ...nationalEntry("2026-10-12"), fuels: { diesel_a: 1 } }],
      },
    ],
    [
      "un recuento no entero",
      {
        ...validNational,
        entries: [{ ...nationalEntry("2026-10-12"), station_count: 10.5 }],
      },
    ],
    ["un descarte negativo", { ...validNational, discarded: -1 }],
    ["una entrada que no es un objeto", { ...validNational, entries: [null] }],
  ])("rechaza %s", (_reason, value) => {
    expect(() => parseNationalHistory(value)).toThrow(DataContractError);
  });
});

describe("parseProvinceHistory", () => {
  it("acepta la serie de la provincia pedida", () => {
    const parsed = parseProvinceHistory(validProvince, "28");

    expect(parsed.provinceId).toBe("28");
    expect(parsed.entries[0].fuels.diesel_a).toEqual({
      mean: 1.75,
      count: 700,
    });
  });

  it("rechaza la serie de otra provincia", () => {
    expect(() => parseProvinceHistory(validProvince, "08")).toThrow(
      /provincia 08/,
    );
  });
});

describe("historyTimeline e historyObservations", () => {
  it("extraen las fechas del histórico y las observaciones de un combustible", () => {
    const history = parseNationalHistory(validNational);
    const province = parseProvinceHistory(validProvince, "28");

    expect(historyTimeline(history)).toEqual({
      first: "2026-10-12",
      last: "2026-10-13",
    });
    expect(historyObservations(history, "diesel_a")).toEqual([
      { date: "2026-10-12", mean: 1.8, count: 9_000 },
      { date: "2026-10-13", mean: 1.82, count: 9_000 },
    ]);
    // Un día sin dato de ese combustible no se convierte en cero.
    expect(historyObservations(province, "diesel_a")).toEqual([
      { date: "2026-10-12", mean: 1.75, count: 700 },
    ]);
  });

  it("no tiene fechas si el histórico está vacío", () => {
    expect(historyTimeline({ discarded: 0, entries: [] })).toBeNull();
  });
});

describe("descarga del histórico publicado", () => {
  it("pide el índice nacional publicado y lo valida", async () => {
    const fetchImpl = respond(200, validNational);

    const history = await fetchNationalHistory(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "/data/historico/nacional.json",
      expect.anything(),
    );
    expect(history?.entries).toHaveLength(2);
  });

  it("devuelve null mientras no exista histórico publicado", async () => {
    expect(await fetchNationalHistory(respond(404))).toBeNull();
    expect(await fetchProvinceHistory("28", respond(404))).toBeNull();
  });

  it("descarga una provincia solo cuando se pide", async () => {
    const fetchImpl = respond(200, validProvince);

    const history = await fetchProvinceHistory("28", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "/data/historico/provincias/28.json",
      expect.anything(),
    );
    expect(history?.entries).toHaveLength(2);
  });

  it("informa de un error del servidor", async () => {
    await expect(fetchNationalHistory(respond(500))).rejects.toThrow(/500/);
  });

  it("rechaza un identificador de provincia no válido sin descargar nada", async () => {
    const fetchImpl = respond(200, validProvince);

    await expect(fetchProvinceHistory("../x", fetchImpl)).rejects.toThrow(
      DataContractError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
