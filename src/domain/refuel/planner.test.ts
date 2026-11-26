import { describe, expect, it } from "vitest";

import { distanceInKm, type Coordinates } from "@/domain/stations";
import { featureBounds, refuelResultToGeoJSON } from "./map-features";
import { findNearbyRefuel, findTripRefuel } from "./planner";
import {
  RoutingError,
  type RoadMatrixRequest,
  legsViaMatrix,
  type RoadMatrixProvider,
} from "./road-routing";
import { testStation } from "./test-stations";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const FRESH = "2026-11-26T08:00:00Z";
const origin = { latitude: 40.400_012, longitude: -3.700_049 };
const north = (km: number) => 40.4 + km / 111.2;

const assumptions = {
  fuel: "diesel_a" as const,
  quantity: 40,
  consumptionPer100Km: 6,
};

const key = (point: Coordinates) => `${point.latitude},${point.longitude}`;

/**
 * Proveedor simulado solo para pruebas: carretera = línea recta × 1,3 a 50 km/h.
 * Los puntos de `isolated` no tienen ruta (isla, recinto cerrado, etc.).
 */
function fakeProvider(
  options: {
    isolated?: Coordinates[];
    id?: "geoapify" | "openrouteservice";
    answerAs?: "geoapify" | "openrouteservice";
    fail?: RoutingError;
    wrongShape?: boolean;
  } = {},
) {
  const isolated = new Set((options.isolated ?? []).map(key));
  const calls: RoadMatrixRequest[] = [];
  const leg = (a: Coordinates, b: Coordinates) => {
    if (isolated.has(key(a)) || isolated.has(key(b))) return null;
    const meters = distanceInKm(a, b) * 1.3 * 1000;
    return { distanceMeters: meters, durationSeconds: meters / (50 / 3.6) };
  };
  const provider: RoadMatrixProvider = {
    id: options.id ?? "geoapify",
    maxMatrixCells: 1000,
    async matrix(request) {
      calls.push(request);
      if (options.fail) throw options.fail;
      const cells = request.sources.map((source) =>
        request.targets.map((target) => leg(source, target)),
      );
      return {
        provider: options.answerAs ?? provider.id,
        computedAt: "2026-11-26T11:59:00Z",
        cells: options.wrongShape ? cells.slice(1) : cells,
      };
    },
    async route(waypoints) {
      const [start, end] = [waypoints[0], waypoints[waypoints.length - 1]];
      return {
        provider: options.answerAs ?? provider.id,
        computedAt: "2026-11-26T11:58:00Z",
        leg: leg(start, end)!,
        geometry: [start, end],
      };
    },
  };
  return { provider: legsViaMatrix(provider), calls };
}

const stations = [
  testStation("cercana", north(1), -3.7, { diesel_a: "1.550" }),
  testStation("barata", north(6), -3.7, { diesel_a: "1.400" }),
  testStation("misma-area", north(6), -3.7, { diesel_a: "1.410" }),
  testStation("aislada", north(4), -3.7, { diesel_a: "1.300" }),
];

const baseSearch = {
  stations,
  origin,
  assumptions,
  pricesRetrievedAt: FRESH,
  now: NOW,
};

describe("repostar cerca de mí", () => {
  it("ordena por ahorro neto con distancias de ida y vuelta por carretera", async () => {
    const { provider } = fakeProvider();
    const result = await findNearbyRefuel(provider, baseSearch);
    if (result.status !== "ok") throw new Error(result.status);

    expect(result.movement).toBe("dedicated-trip");
    expect(result.provider).toBe("geoapify");
    expect(result.freshness).toEqual({ retrievedAt: FRESH, stale: false });
    expect(result.ranking.reference.station.id).toBe("cercana");
    expect(result.ranking.options[0].station.id).toBe("aislada");

    const barata = result.ranking.options.find(
      ({ station }) => station.id === "barata",
    )!;
    // 6 km de ida en línea recta → 7,8 km por carretera, 15,6 km ida y vuelta.
    expect(barata.cost.attributable.distanceMeters).toBeCloseTo(15_600, -2);
    expect(barata.versusReference.grossSaving).toBeCloseTo(6);
    expect(barata.versusReference.netSaving).toBeLessThan(6);
    expect(barata.profitability).toBe("worthwhile");
  });

  it("envía la ubicación reducida y una sola vez cada punto compartido", async () => {
    const { provider, calls } = fakeProvider();
    await findNearbyRefuel(provider, baseSearch);

    expect(calls).toHaveLength(2);
    expect(calls[0].sources).toEqual([{ latitude: 40.4, longitude: -3.7 }]);
    expect(calls[0].targets).toHaveLength(3);
    expect(calls[1].sources).toEqual(calls[0].targets);
    expect(calls[1].targets).toEqual(calls[0].sources);
  });

  it("excluye las estaciones sin ruta en lugar de aproximarlas", async () => {
    const { provider } = fakeProvider({ isolated: [stations[3].location] });
    const result = await findNearbyRefuel(provider, baseSearch);
    if (result.status !== "ok") throw new Error(result.status);

    expect(result.unreachable.map(({ id }) => id)).toEqual(["aislada"]);
    expect(result.ranking.options[0].station.id).toBe("barata");
  });

  it("informa de que no hay ruta si ninguna candidata es accesible", async () => {
    const { provider } = fakeProvider({
      isolated: [{ latitude: 40.4, longitude: -3.7 }],
    });
    const result = await findNearbyRefuel(provider, baseSearch);
    expect(result.status).toBe("no-route");
    if (result.status === "no-route")
      expect(result.unreachable).toHaveLength(4);
  });

  it("no consulta al proveedor si no hay candidatas en el radio", async () => {
    const { provider, calls } = fakeProvider();
    const result = await findNearbyRefuel(provider, {
      ...baseSearch,
      assumptions: { ...assumptions, fuel: "hydrogen" },
    });
    expect(result.status).toBe("no-candidates");
    expect(calls).toHaveLength(0);
  });

  it("marca como obsoletos los precios antiguos o con fecha ilegible", async () => {
    const { provider } = fakeProvider();
    const old = await findNearbyRefuel(provider, {
      ...baseSearch,
      pricesRetrievedAt: "2026-11-20T08:00:00Z",
    });
    const unreadable = await findNearbyRefuel(provider, {
      ...baseSearch,
      pricesRetrievedAt: "sin fecha",
    });
    expect(old.status === "ok" && old.freshness.stale).toBe(true);
    expect(unreadable.status === "ok" && unreadable.freshness.stale).toBe(true);
  });

  it("rechaza supuestos y ubicaciones no válidos sin llamar al proveedor", async () => {
    const { provider, calls } = fakeProvider();
    const result = await findNearbyRefuel(provider, {
      ...baseSearch,
      origin: { latitude: 0, longitude: 0 },
      assumptions: {
        fuel: "adblue" as never,
        quantity: 0,
        consumptionPer100Km: 6,
      },
    });
    expect(result).toEqual({
      status: "invalid-input",
      fields: ["fuel", "quantity", "origin"],
    });
    expect(calls).toHaveLength(0);
  });

  it("devuelve el fallo del proveedor tipado para conservar los precios oficiales", async () => {
    const failure = new RoutingError(
      "quota-exceeded",
      "Cuota agotada.",
      "geoapify",
    );
    const { provider } = fakeProvider({ fail: failure });
    expect(await findNearbyRefuel(provider, baseSearch)).toEqual({
      status: "error",
      error: failure,
    });
  });

  it("no mezcla distancias de proveedores distintos ni matrices incompletas", async () => {
    const mixed = await findNearbyRefuel(
      fakeProvider({ answerAs: "openrouteservice" }).provider,
      baseSearch,
    );
    const broken = await findNearbyRefuel(
      fakeProvider({ wrongShape: true }).provider,
      baseSearch,
    );
    expect(mixed.status === "error" && mixed.error.kind).toBe(
      "invalid-response",
    );
    expect(broken.status === "error" && broken.error.kind).toBe(
      "invalid-response",
    );
  });

  it("propaga los errores que no son del proveedor, porque indican un defecto", async () => {
    const { provider } = fakeProvider();
    provider.legs = async () => {
      throw new TypeError("defecto");
    };
    await expect(findNearbyRefuel(provider, baseSearch)).rejects.toThrow(
      TypeError,
    );
  });
});

describe("repostar durante un viaje", () => {
  const destination = { latitude: north(20), longitude: -3.7 };
  const tripStations = [
    testStation("en-ruta", north(10), -3.7005, { diesel_a: "1.500" }),
    testStation("desvio", north(12), -3.715, { diesel_a: "1.420" }),
    testStation("lejos", north(10), -3.9, { diesel_a: "1.000" }),
  ];

  it("atribuye al repostaje solo los kilómetros añadidos al trayecto", async () => {
    const { provider } = fakeProvider();
    const result = await findTripRefuel(provider, {
      ...baseSearch,
      stations: tripStations,
      destination,
    });
    if (result.status !== "ok") throw new Error(result.status);

    expect(result.movement).toBe("detour");
    expect(result.route).not.toBeNull();
    expect(result.routesComputedAt).toBe("2026-11-26T11:58:00Z");
    expect(
      result.ranking.options.map(({ station }) => station.id).sort(),
    ).toEqual(["desvio", "en-ruta"]);
    const enRuta = result.ranking.options.find(
      ({ station }) => station.id === "en-ruta",
    )!;
    expect(enRuta.cost.attributable.distanceMeters).toBeLessThan(50);
    expect(result.ranking.reference.station.id).toBe("en-ruta");
  });

  it("rechaza un destino no válido y una ruta de otro proveedor", async () => {
    const invalid = await findTripRefuel(fakeProvider().provider, {
      ...baseSearch,
      destination: { latitude: 100, longitude: 0 },
    });
    expect(invalid).toEqual({
      status: "invalid-input",
      fields: ["destination"],
    });

    const mixed = await findTripRefuel(
      fakeProvider({ answerAs: "openrouteservice" }).provider,
      { ...baseSearch, stations: tripStations, destination },
    );
    expect(mixed.status === "error" && mixed.error.kind).toBe(
      "invalid-response",
    );
  });

  it("genera GeoJSON con el trazado, los extremos y las estaciones en orden [lon, lat]", async () => {
    const result = await findTripRefuel(fakeProvider().provider, {
      ...baseSearch,
      stations: tripStations,
      destination,
    });
    if (result.status !== "ok") throw new Error(result.status);
    const collection = refuelResultToGeoJSON({
      ranking: result.ranking,
      route: result.route,
      origin,
      destination,
    });
    const [route, start, end, first] = collection.features;
    expect(route.geometry.type).toBe("LineString");
    expect(start.properties).toEqual({ kind: "origin" });
    expect(end.properties).toEqual({ kind: "destination" });
    expect(first.properties).toMatchObject({ kind: "station", rank: 1 });
    if (first.geometry.type === "Point") {
      expect(first.geometry.coordinates[0]).toBeLessThan(0);
    }
    const bounds = featureBounds(collection)!;
    expect(bounds[0][1]).toBeLessThanOrEqual(origin.latitude);
    expect(bounds[1][1]).toBeGreaterThanOrEqual(destination.latitude);
    expect(
      featureBounds({ type: "FeatureCollection", features: [] }),
    ).toBeNull();
  });
});

describe("GeoJSON de búsqueda cercana", () => {
  it("no incluye trazado cuando no hay viaje", async () => {
    const result = await findNearbyRefuel(fakeProvider().provider, baseSearch);
    if (result.status !== "ok") throw new Error(result.status);
    const collection = refuelResultToGeoJSON({
      ranking: result.ranking,
      route: null,
      origin,
      destination: null,
    });
    expect(
      collection.features.every(({ geometry }) => geometry.type === "Point"),
    ).toBe(true);
    // Origen y una entrada por estación con ruta.
    expect(collection.features).toHaveLength(1 + result.ranking.options.length);
    expect(collection.features[0].properties).toEqual({ kind: "origin" });
  });
});
