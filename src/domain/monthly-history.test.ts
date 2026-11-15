import { describe, expect, it } from "vitest";

import {
  availablePeriods,
  buildChartGeometry,
  dateToTime,
  nearestPointIndex,
  selectMonthlyPeriod,
  splitAtGaps,
  subtractYears,
  type MonthlyObservation,
} from "./monthly-history";

const point = (date: string, price = 1): MonthlyObservation => ({
  date,
  price,
  count: 100,
});
const points = [
  point("2007-01-01"),
  point("2007-02-01", 1.1),
  point("2007-04-01", 1.5),
  point("2026-11-01", 2),
];

describe("muestras mensuales independientes", () => {
  it("filtra fechas, calcula variación y respeta el calendario", () => {
    expect(selectMonthlyPeriod([], "all")).toBeNull();
    expect(selectMonthlyPeriod([points[0]], "all")).toBeNull();
    const all = selectMonthlyPeriod(points, "all")!;
    expect(all.changePercent).toBe(100);
    expect(all.first.date).toBe("2007-01-01");
    expect(all.last.date).toBe("2026-11-01");
    expect(all.startsAfterRequested).toBe(false);
    expect(selectMonthlyPeriod(points, 1)).toBeNull();
    expect(selectMonthlyPeriod(points, 20)!.startsAfterRequested).toBe(true);
    expect(
      selectMonthlyPeriod(points, "all", "2007-04-01")!.points,
    ).toHaveLength(3);
    expect(subtractYears("2024-02-29", 1)).toBe("2023-02-28");
    expect(subtractYears("2024-02-29", 4)).toBe("2020-02-29");
  });
  it("solo habilita periodos con cobertura real", () => {
    expect(availablePeriods("2007-01-01", "2026-11-01")).toEqual([
      1,
      5,
      10,
      15,
      "all",
    ]);
    expect(availablePeriods("2026-01-01", "2026-11-01")).toEqual(["all"]);
    expect(availablePeriods("2007-01-01", "2027-01-01")).toContain(20);
  });
  it("corta huecos por meses de calendario incluso en febrero", () => {
    expect(splitAtGaps([])).toEqual([]);
    expect(splitAtGaps(points).map((segment) => segment.length)).toEqual([
      2, 1, 1,
    ]);
    expect(
      splitAtGaps([
        point("2024-01-01"),
        point("2024-02-01"),
        point("2024-03-01"),
      ]),
    ).toHaveLength(1);
  });
  it("encuentra la muestra real más cercana sin inventar precios", () => {
    expect(nearestPointIndex(points, dateToTime("2000-01-01"))).toBe(0);
    expect(nearestPointIndex(points, dateToTime("2027-01-01"))).toBe(3);
    expect(nearestPointIndex(points, dateToTime("2007-03-25"))).toBe(2);
    expect(nearestPointIndex([points[0]], dateToTime("2007-02-01"))).toBe(0);
  });
  it("genera trazos separados y coordenadas temporales reversibles", () => {
    const box = {
      width: 600,
      height: 240,
      left: 40,
      right: 10,
      top: 10,
      bottom: 20,
    };
    const chart = buildChartGeometry(points, box);
    expect(chart.paths).toHaveLength(3);
    expect(chart.paths[0]).toContain("L");
    expect(chart.paths[1]).not.toContain("L");
    expect(chart.x(points[0].date)).toBe(40);
    expect(chart.timeAt(chart.x(points[2].date))).toBeCloseTo(
      dateToTime(points[2].date),
    );
    expect(chart.y(2)).toBeLessThan(chart.y(1));
    expect(chart.minPrice).toBe(1);
    expect(chart.maxPrice).toBe(2);
    expect(
      buildChartGeometry(
        [point("2007-01-01"), point("2007-02-01")],
        box,
      ).paths.join(""),
    ).not.toContain("NaN");
  });
});
