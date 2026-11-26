import { describe, expect, it } from "vitest";

import {
  createWorkerAutocomplete,
  createWorkerRoutingProvider,
  routingServiceUrl,
} from "@/data/road-routing/worker-client";
import { findNearbyRefuel, findTripRefuel } from "@/domain/refuel/planner";
import {
  ROUTING_LIMIT_MESSAGE,
  ROUTING_RATE_LIMIT_MESSAGE,
  RoutingError,
} from "@/domain/refuel/road-routing";
import { testStation } from "@/domain/refuel/test-stations";
import { withRoutingCache } from "@/data/road-routing/cache";
import { findSelectedRefuelRoute } from "@/domain/refuel/planner";

import { createHarness, madrid, ORIGIN } from "./harness";

const stations = [
  testStation("cerca", 40.4268, -3.7038, { diesel_a: "1.550" }),
  testStation("barata", 40.4668, -3.7038, { diesel_a: "1.420" }),
];
const search = {
  stations,
  origin: madrid,
  assumptions: {
    fuel: "diesel_a" as const,
    quantity: 40,
    consumptionPer100Km: 6,
  },
  pricesRetrievedAt: "2026-11-26T08:00:00Z",
  now: Date.parse("2026-11-26T12:00:00Z"),
};

/** El cliente del navegador habla con el Worker del banco de pruebas, no con la red. */
function clientFor(
  harness: ReturnType<typeof createHarness>,
  ip = "203.0.113.5",
) {
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(String(input), init);
    request.headers.set("Origin", ORIGIN);
    request.headers.set("CF-Connecting-IP", ip);
    return harness.send(request);
  }) as typeof globalThis.fetch;
  return createWorkerRoutingProvider({
    baseUrl: "https://rutas.example/",
    fetch,
  });
}

describe("motor de FuelShift a través del Worker", () => {
  it("reutiliza la ruta directa al cambiar candidatas, sin permisos consumibles", async () => {
    const harness = createHarness();
    const provider = withRoutingCache(clientFor(harness));
    const trip = {
      ...search,
      destination: { latitude: 40.9, longitude: -3.7038 },
    };
    expect((await findTripRefuel(provider, trip)).status).toBe("ok");
    harness.advance(60_001);
    expect(
      (await findTripRefuel(provider, { ...trip, stations: [stations[0]] }))
        .status,
    ).toBe("ok");
    expect(
      harness.provider
        .stats()
        .requests.filter((url) => url.startsWith("/v1/routing?")),
    ).toHaveLength(1);
  });

  it.each([false, true])(
    "solo consulta el trazado de la elegida (viaje: %s), lo contabiliza y reutiliza",
    async (trip) => {
      const harness = createHarness();
      const provider = withRoutingCache(clientFor(harness));
      const destination = trip ? { latitude: 40.9, longitude: -3.7038 } : null;
      const result = destination
        ? await findTripRefuel(provider, { ...search, destination })
        : await findNearbyRefuel(provider, search);
      if (result.status !== "ok") throw new Error(result.status);
      expect(harness.provider.stats().calls).toBe(trip ? 3 : 2);
      harness.advance(60_001);
      const option = result.ranking.options[0];
      const show = (signal?: AbortSignal) =>
        findSelectedRefuelRoute(
          provider,
          search.origin,
          destination,
          option.station.location,
          option.cost.attributable,
          result.route,
          signal,
        );
      const route = await show();
      expect(route.geometry).toHaveLength(3);
      expect(route.geometry[1]).toEqual(option.station.location);
      const calls = harness.provider.stats().calls;
      expect(await show()).toEqual(route);
      expect(harness.provider.stats().calls).toBe(calls);
      expect(harness.spent()).toBe(harness.provider.stats().charged);
    },
  );

  it("rechaza un trazado incompatible con las distancias del ahorro y cancela antes de consultar", async () => {
    const harness = createHarness();
    const provider = clientFor(harness);
    await expect(
      findSelectedRefuelRoute(
        provider,
        search.origin,
        null,
        stations[0].location,
        { distanceMeters: 500_000, durationSeconds: 30_000 },
        null,
      ),
    ).rejects.toMatchObject({ kind: "invalid-response" });
    const controller = new AbortController();
    controller.abort();
    const calls = harness.provider.stats().calls;
    await expect(
      findSelectedRefuelRoute(
        provider,
        search.origin,
        null,
        stations[1].location,
        { distanceMeters: 1, durationSeconds: 1 },
        null,
        controller.signal,
      ),
    ).rejects.toMatchObject({ kind: "aborted" });
    expect(harness.provider.stats().calls).toBe(calls);
  });

  it("calcula «cerca de mí» con una sola operación contabilizada", async () => {
    const harness = createHarness();
    const result = await findNearbyRefuel(clientFor(harness), search);
    if (result.status !== "ok") throw new Error(result.status);

    expect(result.provider).toBe("geoapify");
    expect(result.ranking.options).toHaveLength(2);
    expect(result.ranking.reference.station.id).toBe("cerca");
    expect(harness.spent()).toBe(4);
  });

  it("calcula un viaje: ruta y después tramos con el permiso concedido", async () => {
    const harness = createHarness();
    const result = await findTripRefuel(clientFor(harness), {
      ...search,
      destination: { latitude: 40.9, longitude: -3.7038 },
    });
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.movement).toBe("detour");
    expect(result.route?.geometry).toHaveLength(2);
  });

  it("degrada con el mensaje acordado cuando se agota la cuota", async () => {
    const harness = createHarness({
      limits: {
        endpointCredits: { matrix: 1, routing: 300, autocomplete: 300 },
      },
    });
    const result = await findNearbyRefuel(clientFor(harness), search);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.kind).toBe("quota-exceeded");
      expect(result.error.message).toBe(ROUTING_LIMIT_MESSAGE);
    }
  });

  it("informa del límite por visitante sin reintentar desde el navegador", async () => {
    const harness = createHarness();
    const client = clientFor(harness);
    for (let index = 0; index < 3; index += 1) {
      await findNearbyRefuel(client, {
        ...search,
        assumptions: { ...search.assumptions, quantity: 40 },
        origin: {
          latitude: madrid.latitude + index / 10_000,
          longitude: madrid.longitude,
        },
      });
      harness.advance(1001);
    }
    const limited = await findNearbyRefuel(client, {
      ...search,
      origin: {
        latitude: madrid.latitude + 0.001,
        longitude: madrid.longitude,
      },
    });
    expect(limited.status === "error" && limited.error.message).toBe(
      ROUTING_RATE_LIMIT_MESSAGE,
    );
  });
});

describe("activación desde la web", () => {
  it("sin URL HTTPS válida el servicio queda desactivado", () => {
    for (const value of [
      undefined,
      "",
      "http://rutas.example",
      "no es url",
      "https://rutas.example/?k=1",
    ]) {
      expect(routingServiceUrl(value)).toBeNull();
    }
    expect(routingServiceUrl("https://rutas.example/")).toBe(
      "https://rutas.example",
    );
  });

  it("sin garantía del proveedor la búsqueda muestra servicio desactivado", async () => {
    const harness = createHarness({
      env: { GEOAPIFY_CHARGE_GUARANTEE: undefined },
    });
    const result = await findNearbyRefuel(clientFor(harness), search);
    expect(result.status === "error" && result.error.kind).toBe("disabled");
    expect(harness.provider.stats().calls).toBe(0);
  });

  it("autocompleta a través del Worker y contabiliza la consulta", async () => {
    const harness = createHarness({
      env: { GEOAPIFY_CHARGE_GUARANTEE: undefined },
    });
    const fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const request = new Request(String(input), init);
      request.headers.set("Origin", ORIGIN);
      request.headers.set("CF-Connecting-IP", "203.0.113.9");
      return harness.send(request);
    }) as typeof globalThis.fetch;
    const autocomplete = createWorkerAutocomplete({
      baseUrl: "https://rutas.example",
      fetch,
    });
    expect(await autocomplete("  Calle   Mayor ")).toEqual([
      {
        label: "Calle Mayor, Madrid",
        location: { latitude: 40.415, longitude: -3.708 },
      },
    ]);
    expect(harness.spent("autocomplete")).toBe(1);
    // Un texto que el Worker rechazaría no llega a enviarse.
    await expect(autocomplete("ab")).rejects.toMatchObject({
      kind: "invalid-request",
    });
    expect(harness.provider.stats().calls).toBe(1);
  });

  it("descarta sugerencias fuera de España o mal formadas", async () => {
    const autocomplete = createWorkerAutocomplete({
      baseUrl: "https://x.example",
      fetch: (async () =>
        Response.json({
          results: [
            { label: "París", latitude: 48.85, longitude: 2.35 },
            { label: 5, latitude: 40.4, longitude: -3.7 },
            { label: "Sol", latitude: 40.417, longitude: -3.703 },
          ],
        })) as unknown as typeof fetch,
    });
    expect(await autocomplete("plaza")).toEqual([
      { label: "Sol", location: { latitude: 40.417, longitude: -3.703 } },
    ]);
    const broken = createWorkerAutocomplete({
      baseUrl: "https://x.example",
      fetch: (async () => Response.json({})) as unknown as typeof fetch,
    });
    await expect(broken("plaza")).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });
});

describe("cliente del Worker", () => {
  const respond = (body: unknown, status = 200) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
      })) as unknown as typeof fetch;
  const legs = { start: madrid, end: madrid, locations: [madrid] };
  const kindOf = async (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error) => (error instanceof RoutingError ? error.kind : "otro"),
    );

  it("traduce errores del Worker y respuestas inesperadas", async () => {
    const client = (fetch: typeof globalThis.fetch) =>
      createWorkerRoutingProvider({ baseUrl: "https://x.example", fetch });
    expect(
      await kindOf(client(respond({ error: "quota" }, 503)).legs(legs)),
    ).toBe("quota-exceeded");
    expect(await kindOf(client(respond("html", 429)).legs(legs))).toBe(
      "rate-limited",
    );
    expect(await kindOf(client(respond({}, 500)).legs(legs))).toBe(
      "unavailable",
    );
    expect(
      await kindOf(client(respond({ error: "no-route" }, 422)).legs(legs)),
    ).toBe("no-route");
    expect(await kindOf(client(respond({ provider: "otro" })).legs(legs))).toBe(
      "invalid-response",
    );
    expect(
      await kindOf(
        client(
          respond({
            provider: "geoapify",
            computedAt: "x",
            toStation: [],
            fromStation: [],
          }),
        ).legs(legs),
      ),
    ).toBe("invalid-response");
    expect(
      await kindOf(
        client(
          respond({
            provider: "geoapify",
            computedAt: "2026-11-26T12:00:00Z",
            toStation: [],
          }),
        ).legs(legs),
      ),
    ).toBe("invalid-response");
    expect(
      await kindOf(
        client(
          respond({
            provider: "geoapify",
            computedAt: "2026-11-26T12:00:00Z",
            leg: null,
          }),
        ).route([madrid, madrid]),
      ),
    ).toBe("invalid-response");
    expect(
      await kindOf(
        client(
          respond({
            provider: "geoapify",
            computedAt: "2026-11-26T12:00:00Z",
            leg: { distanceMeters: 1, durationSeconds: 1 },
          }),
        ).route([madrid, madrid]),
      ),
    ).toBe("invalid-response");
    expect(await kindOf(client(respond({})).route([madrid]))).toBe(
      "invalid-request",
    );
  });

  it("distingue red caída, tiempo agotado y cancelación", async () => {
    const failing = (async () => {
      throw new TypeError("red");
    }) as unknown as typeof fetch;
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("abortado")),
        ),
      )) as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();

    expect(
      await kindOf(
        createWorkerRoutingProvider({
          baseUrl: "https://x",
          fetch: failing,
        }).legs(legs),
      ),
    ).toBe("unavailable");
    expect(
      await kindOf(
        createWorkerRoutingProvider({
          baseUrl: "https://x",
          fetch: hanging,
          timeoutMs: 5,
        }).legs(legs),
      ),
    ).toBe("timeout");
    expect(
      await kindOf(
        createWorkerRoutingProvider({
          baseUrl: "https://x",
          fetch: hanging,
        }).legs(legs, controller.signal),
      ),
    ).toBe("aborted");
  });
});
