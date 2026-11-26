import { describe, expect, it } from "vitest";

import {
  distanceToPolylineKm,
  preselectAlongRoute,
  preselectNearby,
  uniqueLocations,
} from "./candidates";
import { testStation } from "./test-stations";

const origin = { latitude: 40.4, longitude: -3.7 };
// 0,01° de latitud son unos 1,11 km.
const north = (km: number) => origin.latitude + km / 111.2;

describe("preselección alrededor del origen", () => {
  const stations = [
    testStation("cerca-cara", north(0.5), origin.longitude, {
      diesel_a: "1.700",
    }),
    testStation("media", north(3), origin.longitude, { diesel_a: "1.600" }),
    testStation("lejos-barata", north(8), origin.longitude, {
      diesel_a: "1.400",
    }),
    testStation("fuera-radio", north(15), origin.longitude, {
      diesel_a: "1.100",
    }),
    testStation("sin-precio", north(1), origin.longitude, {
      gasoline_95_e5: "1.5",
    }),
    testStation("precio-cero", north(1), origin.longitude, {
      diesel_a: "0.000",
    }),
    testStation("sin-coordenadas", 0, 0, { diesel_a: "1.000" }),
  ];

  it("filtra por radio, precio válido y coordenadas", () => {
    const ids = preselectNearby(stations, "diesel_a", origin, {
      radiusKm: 10,
      maxCandidates: 10,
    }).map(({ station }) => station.id);
    expect(ids.sort()).toEqual(["cerca-cara", "lejos-barata", "media"]);
  });

  it("conserva la más cercana y la más barata aunque el cupo sea pequeño", () => {
    const ids = preselectNearby(stations, "diesel_a", origin, {
      radiusKm: 10,
      maxCandidates: 2,
    }).map(({ station }) => station.id);
    expect(ids).toEqual(["cerca-cara", "lejos-barata"]);
  });

  it("no devuelve candidatas si no hay estaciones con precio en el radio", () => {
    expect(
      preselectNearby(stations, "liquefied_natural_gas", origin, {
        radiusKm: 10,
        maxCandidates: 5,
      }),
    ).toEqual([]);
  });
});

describe("distancia a un trazado", () => {
  const line = [
    { latitude: 40, longitude: -4 },
    { latitude: 40, longitude: -3 },
  ];

  it("mide la perpendicular al segmento y el extremo más próximo fuera de él", () => {
    expect(
      distanceToPolylineKm({ latitude: 40.01, longitude: -3.5 }, line),
    ).toBeCloseTo(1.112, 2);
    expect(
      distanceToPolylineKm({ latitude: 40, longitude: -2.99 }, line),
    ).toBeCloseTo(0.852, 2);
  });

  it("admite trazados de un punto y vacíos", () => {
    expect(distanceToPolylineKm(origin, [origin])).toBe(0);
    expect(distanceToPolylineKm(origin, [origin, origin])).toBe(0);
    expect(distanceToPolylineKm(origin, [])).toBe(Infinity);
  });
});

describe("preselección a lo largo de la ruta", () => {
  const route = [
    { latitude: 40, longitude: -4 },
    { latitude: 40, longitude: -3 },
  ];
  const stations = [
    testStation("en-ruta", 40.005, -3.5, { diesel_a: "1.500" }),
    testStation("pasillo", 40.015, -3.2, { diesel_a: "1.450" }),
    testStation("fuera", 40.1, -3.5, { diesel_a: "1.000" }),
    testStation("fuera-caja", 41, -3.5, { diesel_a: "1.000" }),
  ];

  it("solo considera estaciones dentro del pasillo", () => {
    const ids = preselectAlongRoute(stations, "diesel_a", route, {
      radiusKm: 2,
      maxCandidates: 10,
    }).map(({ station }) => station.id);
    expect(ids).toEqual(["en-ruta", "pasillo"]);
  });

  it("no preselecciona nada sin trazado", () => {
    expect(preselectAlongRoute(stations, "diesel_a", [])).toEqual([]);
  });
});

describe("puntos únicos", () => {
  it("pide una sola ruta para estaciones con las mismas coordenadas", () => {
    const a = { latitude: 1, longitude: 2 };
    const b = { latitude: 3, longitude: 4 };
    expect(uniqueLocations([a, b, { ...a }])).toEqual({
      locations: [a, b],
      indexOf: [0, 1, 0],
    });
  });
});
