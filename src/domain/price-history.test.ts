import { describe, expect, it } from "vitest";

import {
  addDays,
  buildHistorySeries,
  MIN_CHART_OBSERVATIONS,
  type HistoryEntry,
  type HistoryFuel,
  type PriceHistory,
} from "./price-history";

function entry(
  date: string,
  mean: number,
  provinceMean?: number,
): HistoryEntry {
  const fuel: HistoryFuel = {
    national: { mean, min: mean - 0.2, max: mean + 0.2, count: 9_000 },
    provinces:
      provinceMean === undefined
        ? {}
        : { "28": { mean: provinceMean, count: 700 } },
  };
  return {
    date,
    retrieved_at: `${date}T14:00:00Z`,
    reported_at: date,
    station_count: 11_000,
    province_count: 52,
    fuels: { gasoline_95_e5: fuel, gasoline_98_e5: fuel, diesel_a: fuel },
  };
}

const history = (...entries: HistoryEntry[]): PriceHistory => ({
  source: { attribution: "MITECO", catalog: "", license_url: "" },
  entries,
});

describe("addDays", () => {
  it("suma días de calendario, incluso entre meses y años", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("buildHistorySeries", () => {
  it("devuelve un punto por día del periodo y deja huecos donde no hay observación", () => {
    const series = buildHistorySeries(
      history(entry("2026-10-12", 1.8), entry("2026-10-15", 1.82)),
      "gasoline_95_e5",
      { periodDays: 7 },
    );

    expect(series.startDate).toBe("2026-10-09");
    expect(series.endDate).toBe("2026-10-15");
    // Antes del 12 no se recogían datos: la serie empieza ahí, sin días vacíos
    // que parezcan observaciones perdidas.
    expect(series.points.map((point) => point.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
    ]);
    expect(series.points.map((point) => point.mean)).toEqual([
      1.8,
      null,
      null,
      1.82,
    ]);
    expect(series).toMatchObject({
      observedDays: 2,
      complete: false,
      startsAfterPeriod: true,
      chartable: true,
      collectingSince: "2026-10-12",
    });
  });

  it("mantiene los huecos dentro del periodo cuando el histórico es más largo", () => {
    const series = buildHistorySeries(
      history(
        entry("2026-10-01", 1.79),
        entry("2026-10-12", 1.8),
        entry("2026-10-15", 1.82),
      ),
      "gasoline_95_e5",
      { periodDays: 7 },
    );

    expect(series.points).toHaveLength(7);
    expect(series.points.map((point) => point.mean)).toEqual([
      null,
      null,
      null,
      1.8,
      null,
      null,
      1.82,
    ]);
    expect(series.startsAfterPeriod).toBe(false);
  });

  it("marca como completo un periodo con observación todos los días", () => {
    const entries = Array.from({ length: 7 }, (_, index) =>
      entry(addDays("2026-10-10", index), 1.8 + index / 100),
    );

    const series = buildHistorySeries(history(...entries), "diesel_a", {
      periodDays: 7,
    });

    expect(series).toMatchObject({ observedDays: 7, complete: true });
  });

  it("solo muestra gráfico con observaciones suficientes en el periodo", () => {
    const single = buildHistorySeries(
      history(entry("2026-10-12", 1.8)),
      "gasoline_95_e5",
      { periodDays: 30 },
    );
    // Dos observaciones, pero una queda fuera de los últimos 7 días.
    const outside = buildHistorySeries(
      history(entry("2026-09-01", 1.7), entry("2026-10-12", 1.8)),
      "gasoline_95_e5",
      { periodDays: 7 },
    );

    expect(MIN_CHART_OBSERVATIONS).toBe(2);
    expect(single).toMatchObject({ observedDays: 1, chartable: false });
    expect(outside).toMatchObject({
      observedDays: 1,
      chartable: false,
      collectingSince: "2026-09-01",
    });
  });

  it("usa la media de la provincia y deja hueco si ese día no tenía datos", () => {
    const series = buildHistorySeries(
      history(entry("2026-10-12", 1.8, 1.75), entry("2026-10-13", 1.81)),
      "gasoline_95_e5",
      { periodDays: 7, provinceId: "28" },
    );

    expect(series.points.slice(-2).map((point) => point.mean)).toEqual([
      1.75,
      null,
    ]);
    expect(series.points.at(-2)?.count).toBe(700);
    expect(series.observedDays).toBe(1);
  });

  it("devuelve una serie vacía si todavía no hay histórico", () => {
    expect(
      buildHistorySeries(history(), "gasoline_95_e5", { periodDays: 7 }),
    ).toMatchObject({
      points: [],
      observedDays: 0,
      chartable: false,
      collectingSince: null,
    });
  });
});
