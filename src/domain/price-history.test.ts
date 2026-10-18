import { describe, expect, it } from "vitest";

import {
  addDays,
  buildHistorySeries,
  MIN_CHART_OBSERVATIONS,
  type HistoryObservation,
} from "./price-history";

const observation = (date: string, mean: number): HistoryObservation => ({
  date,
  mean,
  count: 9_000,
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
      [observation("2026-10-12", 1.8), observation("2026-10-15", 1.82)],
      { first: "2026-10-12", last: "2026-10-15" },
      7,
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
      [
        observation("2026-10-01", 1.79),
        observation("2026-10-12", 1.8),
        observation("2026-10-15", 1.82),
      ],
      { first: "2026-10-01", last: "2026-10-15" },
      7,
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
    const observations = Array.from({ length: 7 }, (_, index) =>
      observation(addDays("2026-10-10", index), 1.8 + index / 100),
    );

    const series = buildHistorySeries(
      observations,
      { first: "2026-10-10", last: "2026-10-16" },
      7,
    );

    expect(series).toMatchObject({ observedDays: 7, complete: true });
    expect(series.points[0].count).toBe(9_000);
  });

  it("solo muestra gráfico con observaciones suficientes en el periodo", () => {
    const single = buildHistorySeries(
      [observation("2026-10-12", 1.8)],
      { first: "2026-10-12", last: "2026-10-12" },
      30,
    );
    // Dos observaciones, pero una queda fuera de los últimos 7 días.
    const outside = buildHistorySeries(
      [observation("2026-09-01", 1.7), observation("2026-10-12", 1.8)],
      { first: "2026-09-01", last: "2026-10-12" },
      7,
    );

    expect(MIN_CHART_OBSERVATIONS).toBe(2);
    expect(single).toMatchObject({ observedDays: 1, chartable: false });
    expect(outside).toMatchObject({
      observedDays: 1,
      chartable: false,
      collectingSince: "2026-09-01",
    });
  });

  it("termina el periodo en la última fecha registrada aunque el ámbito no tenga dato ese día", () => {
    // Una provincia sin estaciones de un combustible el último día.
    const series = buildHistorySeries(
      [observation("2026-10-12", 1.75)],
      { first: "2026-10-12", last: "2026-10-13" },
      7,
    );

    expect(series.endDate).toBe("2026-10-13");
    expect(series.points.map((point) => point.mean)).toEqual([1.75, null]);
    expect(series.observedDays).toBe(1);
  });

  it("devuelve una serie vacía si todavía no hay histórico", () => {
    expect(buildHistorySeries([], null, 7)).toMatchObject({
      points: [],
      observedDays: 0,
      chartable: false,
      collectingSince: null,
    });
  });
});
