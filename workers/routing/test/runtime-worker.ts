// Solo Wrangler local: proveedor simulado sin acceso a la red. Este archivo no
// es el entrypoint de producción y no contiene credenciales reales.
import { RoutingBudget as ProductionBudget } from "../src/budget";
import { handleRequest } from "../src/index";
import { DEFAULT_LIMITS, type RoutingLimits } from "../src/limits";
import type { DurableObjectStateLike, Env } from "../src/types";

type SmokeEnv = Env & { SMOKE_AUTOCOMPLETE_CREDITS?: string };

/**
 * Sin variables de prueba usa el presupuesto de producción. Solo esta prueba
 * puede reducir el del autocompletado con `SMOKE_AUTOCOMPLETE_CREDITS`, para
 * comprobar el corte y su persistencia en workerd sin cientos de peticiones;
 * el Durable Object de producción no lee ninguna variable.
 */
function smokeLimits(env: SmokeEnv): RoutingLimits | undefined {
  const credits = Number(env.SMOKE_AUTOCOMPLETE_CREDITS);
  if (!Number.isInteger(credits) || credits <= 0) return undefined;
  return {
    ...DEFAULT_LIMITS,
    endpointCredits: {
      ...DEFAULT_LIMITS.endpointCredits,
      autocomplete: credits,
    },
  };
}

export class RoutingBudget extends ProductionBudget {
  constructor(
    private readonly testState: DurableObjectStateLike,
    env: SmokeEnv,
  ) {
    super(testState, env, smokeLimits(env));
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/stats") {
      const storage = this.testState.storage;
      const alarmStorage = storage as typeof storage & {
        getAlarm(): Promise<number | null>;
      };
      // Lectura de diagnóstico del presupuesto que eligió el constructor.
      const { limits } = this as unknown as { limits: RoutingLimits };
      return Response.json({
        providerCredits: limits.providerCredits.geoapify,
        endpointCredits: limits.endpointCredits,
        rows: storage.sql
          .exec("SELECT endpoint, status, credits FROM reservations")
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
