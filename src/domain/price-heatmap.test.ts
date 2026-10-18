import { describe, expect, it } from "vitest";

import {
  buildFilteredHeatmap,
  buildPriceHeatmap,
  latitudeFromMercatorY,
  mercatorY,
  sampleHeatmap,
  scalePosition,
} from "./price-heatmap";
import type { FuelCode, Station } from "./stations";

let nextId = 0;

function station(
  latitude: number,
  longitude: number,
  fuels: Partial<Record<FuelCode, string>>,
): Station {
  nextId += 1;
  return {
    id: String(nextId),
    municipality_id: "001",
    municipality: "Municipio",
    locality: "Localidad",
    postal_code: "28001",
    address: "Calle",
    brand: null,
    opening_hours: null,
    location: { latitude, longitude },
    fuels,
    provinceId: "28",
    provinceName: "MADRID",
  };
}

const gasoline = (latitude: number, longitude: number, price: string) =>
  station(latitude, longitude, { gasoline_95_e5: price });

// Madrid y Sevilla: a más de 24 km entre sí, así que no se influyen.
const madrid = { latitude: 40.42, longitude: -3.7 };
const seville = { latitude: 37.39, longitude: -5.98 };

describe("proyección de filas", () => {
  it("convierte latitudes a Mercator y de vuelta sin pérdida apreciable", () => {
    for (const latitude of [27.6, 36, 40.42, 43.9]) {
      expect(latitudeFromMercatorY(mercatorY(latitude))).toBeCloseTo(
        latitude,
        9,
      );
    }
  });
});

describe("buildPriceHeatmap", () => {
  it("devuelve el precio común en toda la zona cubierta si todos coinciden", () => {
    const heatmap = buildPriceHeatmap(
      [
        gasoline(madrid.latitude, madrid.longitude, "1.500"),
        gasoline(madrid.latitude + 0.05, madrid.longitude + 0.05, "1.500"),
      ],
      "gasoline_95_e5",
    );

    expect(
      sampleHeatmap(heatmap, madrid.latitude, madrid.longitude)?.value,
    ).toBeCloseTo(1.5, 6);
    expect(heatmap.scale!.low).toBeCloseTo(1.5, 9);
    expect(heatmap.scale!.high).toBeCloseTo(1.5, 9);
    expect(scalePosition(1.5, heatmap.scale!)).toBe(0.5);
  });

  it("no oscurece ni encarece una zona por tener más estaciones", () => {
    const sparse = [
      gasoline(madrid.latitude, madrid.longitude, "1.400"),
      gasoline(madrid.latitude, madrid.longitude + 0.02, "1.600"),
    ];
    const dense = [
      ...sparse,
      ...sparse.map((item) => ({ ...item, id: `${item.id}-copia` })),
      ...sparse.map((item) => ({ ...item, id: `${item.id}-otra` })),
    ];

    const sparseValue = sampleHeatmap(
      buildPriceHeatmap(sparse, "gasoline_95_e5"),
      madrid.latitude,
      madrid.longitude + 0.01,
    )!.value;
    const denseSample = sampleHeatmap(
      buildPriceHeatmap(dense, "gasoline_95_e5"),
      madrid.latitude,
      madrid.longitude + 0.01,
    )!;

    expect(denseSample.value).toBeCloseTo(sparseValue, 9);
    expect(denseSample.value).toBeCloseTo(1.5, 2);
  });

  it("refleja precios distintos en zonas distintas y deja sin datos lo que está lejos", () => {
    const heatmap = buildPriceHeatmap(
      [
        gasoline(madrid.latitude, madrid.longitude, "1.700"),
        gasoline(seville.latitude, seville.longitude, "1.500"),
      ],
      "gasoline_95_e5",
    );

    expect(
      sampleHeatmap(heatmap, madrid.latitude, madrid.longitude)?.value,
    ).toBeCloseTo(1.7, 6);
    expect(
      sampleHeatmap(heatmap, seville.latitude, seville.longitude)?.value,
    ).toBeCloseTo(1.5, 6);
    // Ciudad Real queda a más de 24 km de ambas estaciones.
    expect(sampleHeatmap(heatmap, 38.98, -3.93)).toBeNull();
  });

  it("calcula cada combustible por separado e ignora precios no válidos", () => {
    const stations = [
      station(madrid.latitude, madrid.longitude, {
        gasoline_95_e5: "1.600",
        diesel_a: "1.400",
      }),
      station(madrid.latitude, madrid.longitude + 0.01, {
        gasoline_95_e5: "abc",
        diesel_a: "0",
      }),
      station(madrid.latitude, madrid.longitude + 0.02, {}),
    ];

    const gasolineMap = buildPriceHeatmap(stations, "gasoline_95_e5");
    const dieselMap = buildPriceHeatmap(stations, "diesel_a");

    expect(gasolineMap).toMatchObject({
      fuel: "gasoline_95_e5",
      stationCount: 1,
      cheapest: 1.6,
      priciest: 1.6,
    });
    expect(dieselMap.stationCount).toBe(1);
    expect(
      sampleHeatmap(dieselMap, madrid.latitude, madrid.longitude)?.value,
    ).toBeCloseTo(1.4, 6);
    expect(buildPriceHeatmap(stations, "gasoline_98_e5")).toMatchObject({
      stationCount: 0,
      cheapest: null,
      priciest: null,
      scale: null,
    });
  });

  it("informa de los precios reales extremos aunque la escala los recorte", () => {
    const stations = [
      ...Array.from({ length: 40 }, (_, index) =>
        gasoline(
          madrid.latitude + (index % 8) * 0.1,
          madrid.longitude + Math.floor(index / 8) * 0.1,
          (1.6 + index * 0.005).toFixed(3),
        ),
      ),
      gasoline(seville.latitude, seville.longitude, "0.999"),
    ];

    const heatmap = buildPriceHeatmap(stations, "gasoline_95_e5");

    expect(heatmap.cheapest).toBe(0.999);
    expect(heatmap.priciest).toBeCloseTo(1.795, 9);
    expect(heatmap.scale!.low).toBeGreaterThanOrEqual(0.999);
    expect(heatmap.scale!.low).toBeLessThan(heatmap.scale!.high);
    expect(heatmap.scale!.high).toBeLessThanOrEqual(1.795);
  });

  it("no deja que un territorio pequeño y mucho más barato desplace toda la escala", () => {
    const mainland = Array.from({ length: 60 }, (_, index) =>
      gasoline(
        39 + (index % 10) * 0.12,
        -4 + Math.floor(index / 10) * 0.12,
        (1.7 + (index % 7) * 0.03).toFixed(3),
      ),
    );
    // Dos islas separadas: alrededor del 4 % de la superficie, como Canarias
    // en los datos reales.
    const canaryIslands = [
      gasoline(28.1, -15.43, "1.400"),
      gasoline(28.47, -16.25, "1.420"),
    ];

    const heatmap = buildPriceHeatmap(
      [...mainland, ...canaryIslands],
      "gasoline_95_e5",
    );

    expect(heatmap.cheapest).toBe(1.4);
    expect(heatmap.scale!.low).toBeGreaterThan(1.7);
    expect(heatmap.scale!.low).toBeLessThan(heatmap.scale!.high);
  });

  it("sitúa las estaciones de Canarias en su propia región", () => {
    const heatmap = buildPriceHeatmap(
      [gasoline(28.1, -15.43, "1.300")],
      "gasoline_95_e5",
    );

    expect(sampleHeatmap(heatmap, 28.1, -15.43)?.value).toBeCloseTo(1.3, 6);
    expect(
      heatmap.rasters
        .find((raster) => raster.region.id === "canarias")
        ?.values.some((value) => !Number.isNaN(value)),
    ).toBe(true);
  });

  it("produce el mismo resultado sea cual sea el orden de las estaciones", () => {
    const stations = [
      gasoline(madrid.latitude, madrid.longitude, "1.700"),
      gasoline(madrid.latitude + 0.03, madrid.longitude, "1.650"),
      gasoline(seville.latitude, seville.longitude, "1.500"),
    ];

    const forward = buildPriceHeatmap(stations, "gasoline_95_e5");
    const backward = buildPriceHeatmap(
      [...stations].reverse(),
      "gasoline_95_e5",
    );

    expect(backward.scale).toEqual(forward.scale);
    expect(
      sampleHeatmap(backward, madrid.latitude, madrid.longitude)?.value,
    ).toBeCloseTo(
      sampleHeatmap(forward, madrid.latitude, madrid.longitude)!.value,
      9,
    );
  });
});

describe("scalePosition", () => {
  const scale = { low: 1.5, high: 1.9 };

  it("sitúa cada precio entre 0 (más barato) y 1 (más caro)", () => {
    expect(scalePosition(1.5, scale)).toBe(0);
    expect(scalePosition(1.7, scale)).toBeCloseTo(0.5, 9);
    expect(scalePosition(1.9, scale)).toBe(1);
  });

  it("satura los valores fuera de la escala", () => {
    expect(scalePosition(1.2, scale)).toBe(0);
    expect(scalePosition(2.4, scale)).toBe(1);
  });
});

describe("buildFilteredHeatmap", () => {
  // Conjunto nacional: una zona con precios variados (Madrid) y una estación
  // aislada (Sevilla) cuyo precio queda dentro de la escala.
  const madridArea = Array.from({ length: 25 }, (_, index) =>
    station(
      madrid.latitude + (index % 5) * 0.1,
      madrid.longitude + Math.floor(index / 5) * 0.1,
      {
        gasoline_95_e5: (1.6 + index * 0.0125).toFixed(4),
        diesel_a: (1.4 + index * 0.01).toFixed(3),
      },
    ),
  );
  const sevilleStation = station(seville.latitude, seville.longitude, {
    gasoline_95_e5: "1.800",
    diesel_a: "1.500",
  });
  const allStations = [...madridArea, sevilleStation];

  it("reutiliza el cálculo nacional cuando no hay filtros activos", () => {
    const national = buildPriceHeatmap(allStations, "gasoline_95_e5");

    expect(buildFilteredHeatmap(national, allStations, false)).toBe(national);
  });

  it("conserva el mismo color para el mismo precio al aplicar filtros", () => {
    const national = buildPriceHeatmap(allStations, "gasoline_95_e5");
    const filtered = buildFilteredHeatmap(national, [sevilleStation], true);
    const nationalValue = sampleHeatmap(
      national,
      seville.latitude,
      seville.longitude,
    )!.value;
    const filteredValue = sampleHeatmap(
      filtered,
      seville.latitude,
      seville.longitude,
    )!.value;

    expect(filtered.scale).toEqual(national.scale);
    expect(filteredValue).toBeCloseTo(nationalValue, 9);
    expect(scalePosition(filteredValue, filtered.scale!)).toBeCloseTo(
      scalePosition(nationalValue, national.scale!),
      9,
    );
    // Con una escala propia, el subconjunto se vería con otro color.
    expect(
      scalePosition(
        filteredValue,
        buildPriceHeatmap([sevilleStation], "gasoline_95_e5").scale!,
      ),
    ).not.toBeCloseTo(scalePosition(nationalValue, national.scale!), 2);
  });

  it("mantiene los límites con cualquier subconjunto filtrado", () => {
    const national = buildPriceHeatmap(allStations, "gasoline_95_e5");
    const subsets = [
      madridArea.slice(0, 3),
      madridArea.slice(20),
      [sevilleStation],
      [],
    ];

    for (const subset of subsets) {
      expect(buildFilteredHeatmap(national, subset, true).scale).toEqual(
        national.scale,
      );
    }
  });

  it("representa solo las estaciones filtradas y sus extremos reales", () => {
    const national = buildPriceHeatmap(allStations, "gasoline_95_e5");
    const filtered = buildFilteredHeatmap(national, [sevilleStation], true);

    expect(filtered).toMatchObject({
      stationCount: 1,
      cheapest: 1.8,
      priciest: 1.8,
    });
    expect(national.cheapest).toBe(1.6);
    // Sin estaciones filtradas cerca, Madrid queda sin datos.
    expect(
      sampleHeatmap(filtered, madrid.latitude, madrid.longitude),
    ).toBeNull();
  });

  it("cambia la escala al seleccionar otro combustible", () => {
    const gasoline = buildPriceHeatmap(allStations, "gasoline_95_e5");
    const diesel = buildPriceHeatmap(allStations, "diesel_a");
    const filteredDiesel = buildFilteredHeatmap(
      diesel,
      madridArea.slice(0, 5),
      true,
    );

    expect(diesel.scale).not.toEqual(gasoline.scale);
    expect(diesel.scale!.high).toBeLessThan(gasoline.scale!.low);
    expect(filteredDiesel.fuel).toBe("diesel_a");
    expect(filteredDiesel.scale).toEqual(diesel.scale);
  });

  it("no inventa una escala si el combustible no tiene estaciones", () => {
    const empty = buildPriceHeatmap(allStations, "gasoline_98_e5");

    expect(buildFilteredHeatmap(empty, allStations, true).scale).toBeNull();
  });
});
