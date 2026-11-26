import { DatabaseSync } from "node:sqlite";

import { distanceInKm, type Coordinates } from "@/domain/stations";

import { RoutingBudget } from "../src/budget";
import { CHARGE_GUARANTEE_CONFIRMED, matrixBaseCredits } from "../src/costs";
import { handleRequest, type Deps } from "../src/index";
import { DEFAULT_LIMITS, type RoutingLimits } from "../src/limits";
import type { DurableObjectStorageLike, Env, SqlValue } from "../src/types";

/**
 * Banco de pruebas local. Todo es simulado y solo existe en las pruebas:
 * - el almacenamiento del Durable Object es SQLite real de Node;
 * - Geoapify es un `fetch` falso que nunca sale a la red y cuenta los
 *   créditos que habría cobrado según su fórmula publicada;
 * - la distancia por carretera es la recta × `roadFactor`, que las pruebas
 *   suben para simular rodeos que ninguna cota geográfica prevé.
 */
export const ORIGIN = "https://fuelshift.pages.dev";
export const madrid = { latitude: 40.4168, longitude: -3.7038 };

export function sqliteStorage(
  db = new DatabaseSync(":memory:"),
  failing: () => boolean = () => false,
): DurableObjectStorageLike {
  return {
    setAlarm: async () => {},
    deleteAlarm: async () => {},
    sql: {
      exec(query: string, ...bindings: SqlValue[]) {
        if (failing()) throw new Error("almacenamiento caído");
        const rows = db.prepare(query).all(...bindings);
        return { toArray: () => rows as Record<string, SqlValue>[] };
      },
    },
    transactionSync<T>(callback: () => T): T {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = callback();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export type ProviderMode =
  | "ok"
  | "429"
  | "401"
  | "503"
  | "503-then-ok"
  | "hang";

export function fakeGeoapify(
  initialMode: ProviderMode = "ok",
  roadFactor = 1.3,
) {
  let mode = initialMode;
  let calls = 0;
  let charged = 0;
  const hosts = new Set<string>();
  const requests: string[] = [];

  const leg = (a: Coordinates, b: Coordinates) => {
    const meters = distanceInKm(a, b) * roadFactor * 1000;
    return { distance: meters, time: meters / 13.9 };
  };

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    hosts.add(url.host);
    requests.push(`${url.pathname}?${url.searchParams} ${init?.body ?? ""}`);
    calls += 1;
    if (mode === "hang") {
      return new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("abortado", "AbortError")),
        ),
      );
    }
    if (mode === "503-then-ok") {
      mode = "ok";
      return new Response("{}", { status: 503 });
    }
    if (mode !== "ok") {
      return new Response("{}", { status: Number(mode) });
    }

    if (url.pathname === "/v1/routematrix") {
      const body = JSON.parse(String(init?.body));
      const point = ({ location }: { location: [number, number] }) => ({
        latitude: location[1],
        longitude: location[0],
      });
      const sources: Coordinates[] = body.sources.map(point);
      const targets: Coordinates[] = body.targets.map(point);
      const grid = sources.map((source) =>
        targets.map((target) => leg(source, target)),
      );
      charged +=
        matrixBaseCredits(sources.length, targets.length) +
        grid
          .flat()
          .reduce((sum, cell) => sum + Math.floor(cell.distance / 500_000), 0);
      return Response.json({ sources_to_targets: grid });
    }
    if (url.pathname === "/v1/routing") {
      const points = url.searchParams
        .get("waypoints")!
        .split("|")
        .map((pair) => {
          const [latitude, longitude] = pair.split(",").map(Number);
          return { latitude, longitude };
        });
      const { distance, time } = points.slice(1).reduce(
        (sum, point, index) => {
          const part = leg(points[index], point);
          return {
            distance: sum.distance + part.distance,
            time: sum.time + part.time,
          };
        },
        { distance: 0, time: 0 },
      );
      charged += points.length - 1 + Math.floor(distance / 500_000);
      return Response.json({
        features: [
          {
            properties: { distance, time, distance_units: "meters" },
            geometry: {
              type: "LineString",
              coordinates: points.map((point) => [
                point.longitude,
                point.latitude,
              ]),
            },
          },
        ],
      });
    }
    if (url.pathname === "/v1/geocode/autocomplete") {
      charged += 1;
      return Response.json({
        results: [
          { formatted: "Calle Mayor, Madrid", lat: 40.415, lon: -3.708 },
        ],
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    setMode: (next: ProviderMode) => {
      mode = next;
    },
    stats: () => ({
      calls,
      charged,
      hosts: [...hosts],
      requests: [...requests],
    }),
  };
}

export function createHarness(
  options: {
    limits?: Partial<RoutingLimits>;
    mode?: ProviderMode;
    roadFactor?: number;
    env?: Partial<Env>;
    failingStorage?: () => boolean;
    /** Como en producción: Worker y Durable Object deducen los límites del modo económico. */
    limitsFromEnv?: boolean;
  } = {},
) {
  const limits = options.limitsFromEnv
    ? undefined
    : { ...DEFAULT_LIMITS, ...options.limits };
  let clock = Date.parse("2026-11-26T12:00:00Z");
  const now = () => clock;
  const db = new DatabaseSync(":memory:");
  const storage = sqliteStorage(db, options.failingStorage);
  let budget: RoutingBudget;
  const provider = fakeGeoapify(options.mode, options.roadFactor);

  const env: Env = {
    ROUTING_ENABLED: "true",
    GEOAPIFY_ENABLED: "true",
    // Simula el estado futuro autorizado; las pruebas de la política la retiran.
    GEOAPIFY_CHARGE_GUARANTEE: CHARGE_GUARANTEE_CONFIRMED,
    GEOAPIFY_API_KEY: "clave-de-prueba",
    VISITOR_SALT: "sal-de-prueba",
    ALLOWED_ORIGINS: ORIGIN,
    ROUTING_BUDGET: {
      idFromName: () => "global",
      get: () => ({
        fetch: (input: string, init?: RequestInit) =>
          budget.fetch(new Request(input, init)),
      }),
    },
    ...options.env,
  };
  budget = new RoutingBudget({ storage }, env, limits, now);
  const deps: Deps = { fetch: provider.fetch, limits, now };

  const spent = (endpoint?: string) => {
    const exists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reservations'",
      )
      .get();
    // Sin tabla: el Durable Object nunca llegó a usarse, luego no hay gasto.
    if (!exists) return 0;
    const row = endpoint
      ? db
          .prepare(
            "SELECT COALESCE(SUM(credits), 0) AS total FROM reservations WHERE endpoint = ?",
          )
          .get(endpoint)
      : db
          .prepare(
            "SELECT COALESCE(SUM(credits), 0) AS total FROM reservations",
          )
          .get();
    return Number(row?.total ?? 0);
  };

  return {
    env,
    provider,
    db,
    spent,
    /** Nueva instancia del Durable Object sobre el mismo almacenamiento (despliegue o reinicio). */
    restart: () => {
      budget = new RoutingBudget({ storage }, env, limits, now);
    },
    advance: (ms: number) => {
      clock += ms;
    },
    send: (request: Request) => handleRequest(request, env, deps),
  };
}

export function post(
  path: string,
  body: unknown,
  ip = "203.0.113.1",
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://rutas.example${path}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function get(path: string, ip = "203.0.113.1"): Request {
  return new Request(`https://rutas.example${path}`, {
    headers: { Origin: ORIGIN, "CF-Connecting-IP": ip },
  });
}

/** `count` estaciones a menos de 10 km al norte de Madrid. */
export function nearbyBody(count = 15, offset = 0) {
  return {
    start: madrid,
    end: madrid,
    locations: Array.from({ length: count }, (_, index) => ({
      latitude: madrid.latitude + (index + 1 + offset) / 1000,
      longitude: madrid.longitude,
    })),
  };
}

export const ipFor = (index: number) =>
  `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;
