// Solo Wrangler local: proveedor simulado sin acceso a la red. Este archivo no
// es el entrypoint de producción y no contiene credenciales reales.
import { RoutingBudget as ProductionBudget } from "../src/budget";
import { handleRequest } from "../src/index";
import type { DurableObjectStateLike, Env } from "../src/types";

export class RoutingBudget extends ProductionBudget {
  constructor(private readonly testState: DurableObjectStateLike) {
    super(testState);
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/stats") {
      const storage = this.testState.storage;
      const alarmStorage = storage as typeof storage & {
        getAlarm(): Promise<number | null>;
      };
      return Response.json({
        rows: storage.sql
          .exec("SELECT status, credits FROM reservations")
          .toArray(),
        pending: storage.sql
          .exec("SELECT * FROM pending_settlements")
          .toArray(),
        alarm: await alarmStorage.getAlarm(),
      });
    }
    return super.fetch(request);
  }
}

const fakeFetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.geoapify.com")
    throw new Error("Red externa prohibida en esta prueba.");
  if (url.pathname === "/v1/routematrix") {
    const body = JSON.parse(String(init?.body)) as {
      sources: unknown[];
      targets: unknown[];
    };
    return Response.json({
      sources_to_targets: body.sources.map(() =>
        body.targets.map(() => ({ distance: 1000, time: 60 })),
      ),
    });
  }
  if (url.pathname === "/v1/routing") {
    const coordinates = url.searchParams
      .get("waypoints")!
      .split("|")
      .map((point) => point.split(",").map(Number).reverse());
    return Response.json({
      features: [
        {
          properties: {
            distance: (coordinates.length - 1) * 1000,
            time: (coordinates.length - 1) * 60,
            distance_units: "meters",
          },
          geometry: { type: "LineString", coordinates },
        },
      ],
    });
  }
  if (url.pathname === "/v1/geocode/autocomplete")
    return Response.json({
      results: [{ formatted: "Madrid", lat: 40.4, lon: -3.7 }],
    });
  throw new Error("Petición inesperada: no se envía a la red.");
}) as typeof fetch;

const runtimeWorker = {
  fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname === "/__stats") {
      return env.ROUTING_BUDGET.get(
        env.ROUTING_BUDGET.idFromName("global"),
      ).fetch("https://budget/stats");
    }
    return handleRequest(request, env, { fetch: fakeFetch });
  },
};

export default runtimeWorker;
