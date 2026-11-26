import { describe, expect, it, vi } from "vitest";

import { legsViaMatrix, RoutingError } from "@/domain/refuel/road-routing";

import { withRoutingCache } from "./cache";
import { createGeoapifyProvider } from "./geoapify";
import { requestJson } from "./http";

// Respuestas simuladas con la forma documentada por cada proveedor; solo para pruebas.
const a = { latitude: 40.4, longitude: -3.7 };
const b = { latitude: 40.5, longitude: -3.6 };
const c = { latitude: 40.6, longitude: -3.5 };
const now = () => new Date("2026-11-26T12:00:00Z");

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("sin respuesta preparada");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const kindOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof RoutingError ? error.kind : "otro";
  }
};

describe("Geoapify", () => {
  it("pide la matriz en [lon, lat] y traduce metros, segundos y celdas sin ruta", async () => {
    const { fetch, calls } = fakeFetch(
      json({
        sources_to_targets: [
          [
            { distance: 1500, time: 120, source_index: 0, target_index: 0 },
            { distance: null, time: null, source_index: 0, target_index: 1 },
          ],
        ],
      }),
    );
    const provider = createGeoapifyProvider({ apiKey: "clave", http: { fetch }, now });
    const matrix = await provider.matrix({ sources: [a], targets: [b, c] });

    expect(matrix).toEqual({
      provider: "geoapify",
      computedAt: "2026-11-26T12:00:00.000Z",
      cells: [[{ distanceMeters: 1500, durationSeconds: 120 }, null]],
    });
    expect(calls[0].url).toBe(
      "https://api.geoapify.com/v1/routematrix?apiKey=clave",
    );
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      mode: "drive",
      sources: [{ location: [-3.7, 40.4] }],
      targets: [{ location: [-3.6, 40.5] }, { location: [-3.5, 40.6] }],
    });
  });

  it("pide la ruta en lat,lon y lee distancia, tiempo y trazado", async () => {
    const { fetch, calls } = fakeFetch(
      json({
        features: [
          {
            properties: { distance: 20_000, time: 900, distance_units: "meters" },
            geometry: {
              type: "MultiLineString",
              coordinates: [
                [
                  [-3.7, 40.4],
                  [-3.65, 40.45],
                ],
                [[-3.6, 40.5]],
              ],
            },
          },
        ],
      }),
    );
    // Sin clave: apuntaría a un intermediario que la añade.
    const provider = createGeoapifyProvider({
      baseUrl: "https://rutas.example/",
      http: { fetch },
      now,
    });
    const route = await provider.route([a, b]);

    expect(route.leg).toEqual({ distanceMeters: 20_000, durationSeconds: 900 });
    expect(route.geometry).toHaveLength(3);
    expect(route.geometry[2]).toEqual(b);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://rutas.example/v1/routing");
    expect(url.searchParams.get("waypoints")).toBe("40.4,-3.7|40.5,-3.6");
    expect(url.searchParams.has("apiKey")).toBe(false);
  });

  it("rechaza respuestas sin ruta, en millas o con matriz incompleta", async () => {
    const provider = (response: Response) =>
      createGeoapifyProvider({ http: { fetch: fakeFetch(response).fetch } });
    expect(await kindOf(provider(json({ features: [] })).route([a, b]))).toBe(
      "no-route",
    );
    expect(
      await kindOf(
        provider(
          json({ features: [{ properties: { distance: 1, time: 1, distance_units: "miles" } }] }),
        ).route([a, b]),
      ),
    ).toBe("invalid-response");
    expect(
      await kindOf(
        provider(json({ features: [{ properties: { distance: null, time: 1 } }] })).route([a, b]),
      ),
    ).toBe("invalid-response");
    expect(
      await kindOf(
        provider(
          json({ features: [{ properties: { distance: 1, time: 1 }, geometry: { type: "Point" } }] }),
        ).route([a, b]),
      ),
    ).toBe("invalid-response");
    expect(
      await kindOf(
        provider(json({ sources_to_targets: [[]] })).matrix({ sources: [a], targets: [b] }),
      ),
    ).toBe("invalid-response");
    expect(
      await kindOf(provider(json({})).matrix({ sources: [a], targets: [b] })),
    ).toBe("invalid-response");
  });

  it("valida la petición antes de gastar cuota", async () => {
    const { fetch, calls } = fakeFetch();
    const provider = createGeoapifyProvider({ http: { fetch } });
    expect(await kindOf(provider.route([a]))).toBe("invalid-request");
    expect(await kindOf(provider.matrix({ sources: [], targets: [a] }))).toBe(
      "invalid-request",
    );
    expect(calls).toHaveLength(0);
  });
});

describe("peticiones HTTP", () => {
  const call = (fetch: typeof globalThis.fetch, retries = 1, signal?: AbortSignal) =>
    requestJson("geoapify", "https://x.example", {}, { fetch, retries }, signal);

  it("clasifica los códigos de estado", async () => {
    for (const [status, kind] of [
      [401, "unauthorized"],
      [403, "unauthorized"],
      [429, "quota-exceeded"],
      [400, "invalid-request"],
    ] as const) {
      expect(await kindOf(call(fakeFetch(json({}, status)).fetch, 0))).toBe(kind);
    }
  });

  it("reintenta una vez los fallos transitorios y nunca la cuota agotada", async () => {
    const transient = fakeFetch(json({}, 503), json({ ok: true }));
    expect(await call(transient.fetch)).toEqual({ ok: true });
    expect(transient.calls).toHaveLength(2);

    const quota = fakeFetch(json({}, 429), json({ ok: true }));
    expect(await kindOf(call(quota.fetch))).toBe("quota-exceeded");
    expect(quota.calls).toHaveLength(1);

    const down = fakeFetch(new TypeError("red"), new TypeError("red"));
    expect(await kindOf(call(down.fetch))).toBe("unavailable");
    expect(down.calls).toHaveLength(2);
  });

  it("distingue cancelación, tiempo agotado y respuestas no JSON", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await kindOf(call(fakeFetch().fetch, 0, controller.signal))).toBe(
      "aborted",
    );

    const cancelledDuring = new AbortController();
    const aborting = vi.fn(async () => {
      cancelledDuring.abort();
      throw new DOMException("abortado", "AbortError");
    }) as unknown as typeof fetch;
    expect(await kindOf(call(aborting, 1, cancelledDuring.signal))).toBe(
      "aborted",
    );

    const slow = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("timeout"))),
        ),
    ) as unknown as typeof fetch;
    expect(
      await kindOf(
        requestJson("geoapify", "https://x.example", {}, { fetch: slow, timeoutMs: 5, retries: 0 }),
      ),
    ).toBe("timeout");

    const notJson = fakeFetch(new Response("<html>", { status: 200 }));
    expect(await kindOf(call(notJson.fetch))).toBe("invalid-response");
  });
});

describe("caché de rutas en memoria", () => {
  function counting() {
    let legsCalls = 0;
    let routeCalls = 0;
    const provider = legsViaMatrix(createGeoapifyProvider());
    const matrix = { provider: "geoapify" as const, computedAt: "t", cells: [[null]] };
    provider.legs = async () => {
      legsCalls += 1;
      return { toStation: matrix, fromStation: matrix };
    };
    provider.route = async () => {
      routeCalls += 1;
      if (routeCalls === 1) throw new RoutingError("unavailable", "caído");
      return {
        provider: "geoapify",
        computedAt: "t",
        leg: { distanceMeters: 1, durationSeconds: 1 },
        geometry: [a, b],
      };
    };
    return { provider, counts: () => ({ legsCalls, routeCalls }) };
  }
  const legs = (start: typeof a, locations: (typeof a)[]) => ({
    start,
    end: start,
    locations,
  });

  it("reutiliza respuestas idénticas y caduca por tiempo y por tamaño", async () => {
    let clock = 0;
    const { provider, counts } = counting();
    const cached = withRoutingCache(provider, {
      ttlMs: 100,
      maxEntries: 2,
      now: () => clock,
    });
    expect(cached.id).toBe("geoapify");
    expect(cached.maxLocations).toBe(1000);

    await cached.legs(legs(a, [b]));
    await cached.legs(legs(a, [b]));
    expect(counts().legsCalls).toBe(1);

    clock = 101;
    await cached.legs(legs(a, [b]));
    expect(counts().legsCalls).toBe(2);

    await cached.legs(legs(a, [c]));
    await cached.legs(legs(b, [c]));
    // La primera entrada salió al superar el tamaño máximo.
    await cached.legs(legs(a, [b]));
    expect(counts().legsCalls).toBe(5);
  });

  it("no guarda los fallos", async () => {
    const { provider, counts } = counting();
    const cached = withRoutingCache(provider);
    expect(await kindOf(cached.route([a, b]))).toBe("unavailable");
    expect((await cached.route([a, b])).leg.distanceMeters).toBe(1);
    expect(counts().routeCalls).toBe(2);
  });
});
