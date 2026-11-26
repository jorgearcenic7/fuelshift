import {
  createGeoapifyAutocomplete,
  createGeoapifyProvider,
} from "@/data/road-routing/geoapify";
import type { HttpOptions } from "@/data/road-routing/http";
import {
  ROUTING_LIMIT_MESSAGE,
  ROUTING_RATE_LIMIT_MESSAGE,
  RoutingError,
  type RoadMatrix,
} from "@/domain/refuel/road-routing";
import {
  parseAutocompleteText,
  parseLegsBody,
  parseRouteBody,
  isRoundTrip,
  ROUTING_API_LIMITS,
  ROUTING_API_PATHS,
  type AutocompleteResponse,
  type LegsResponse,
  type RouteResponse,
  type RoutingApiErrorCode,
} from "@/domain/refuel/routing-api";

import type { DenyReason, ReserveInput, ReserveResult } from "./budget";
import {
  AUTOCOMPLETE_CREDITS,
  autocompleteCost,
  chargePolicy,
  matrixActualCredits,
  matrixCost,
  routeActualCredits,
  routeCost,
  type CostBound,
} from "./costs";
import {
  DEFAULT_LIMITS,
  type Action,
  type Endpoint,
  type RoutingLimits,
} from "./limits";
import type { Env } from "./types";
import { requestKey, visitorId, visitorNetwork } from "./visitor";

export { RoutingBudget } from "./budget";

/**
 * Intermediario de rutas. Orden de defensa en cada petición:
 * 1. Origen permitido (complementario), interruptores y lista cerrada de rutas.
 * 2. Cuerpo acotado y validación estricta, antes de tocar el presupuesto.
 * 3. Política económica: sin cota de coste verificable antes de llamar, no se
 *    llama salvo garantía efectiva del proveedor (`costs.ts`).
 * 4. Reserva atómica en el Durable Object (fail-closed).
 * 5. Llamada al proveedor sin reintentos propios; un solo reintento, y solo
 *    si se obtiene una reserva nueva.
 * 6. Liquidación sin devoluciones; pausa del proveedor ante 429 o clave rechazada.
 */
export interface Deps {
  fetch?: typeof fetch;
  limits?: RoutingLimits;
  now?: () => number;
}

const MESSAGES: Record<RoutingApiErrorCode, string> = {
  "invalid-request": "Petición no válida.",
  forbidden: "Origen no permitido.",
  "not-found": "Ruta no disponible.",
  duplicate: ROUTING_RATE_LIMIT_MESSAGE,
  "rate-limited": ROUTING_RATE_LIMIT_MESSAGE,
  quota: ROUTING_LIMIT_MESSAGE,
  disabled: "El cálculo de rutas no está disponible en este momento.",
  "cost-unbounded":
    "El cálculo de rutas está desactivado hasta confirmar que no puede generar costes.",
  unavailable: "El cálculo de rutas no está disponible en este momento.",
  "no-route": "No hay ruta por carretera entre esos puntos.",
};

const STATUS: Record<RoutingApiErrorCode, number> = {
  "invalid-request": 400,
  forbidden: 403,
  "not-found": 404,
  duplicate: 409,
  "rate-limited": 429,
  quota: 503,
  disabled: 503,
  "cost-unbounded": 503,
  unavailable: 503,
  "no-route": 422,
};

const DENY_CODES: Record<DenyReason, RoutingApiErrorCode> = {
  invalid: "invalid-request",
  cooldown: "quota",
  duplicate: "duplicate",
  "visitor-minute": "rate-limited",
  "visitor-day": "rate-limited",
  "global-minute": "rate-limited",
  "global-second": "rate-limited",
  concurrency: "rate-limited",
  budget: "quota",
  "retry-unavailable": "unavailable",
};

class ApiError extends Error {
  constructor(readonly code: RoutingApiErrorCode) {
    super(code);
  }
}

function respond(
  body: unknown,
  status: number,
  cors: Record<string, string> | null,
): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(status === 429 ? { "Retry-After": "60" } : {}),
      ...cors,
    },
  });
}

function corsFor(
  origin: string | null,
  env: Env,
): Record<string, string> | null {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** Lee el cuerpo cortando en cuanto supera el máximo, aunque no declare longitud. */
async function readJson(request: Request): Promise<unknown> {
  const max = ROUTING_API_LIMITS.maxBodyBytes;
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    throw new ApiError("invalid-request");
  }
  if (Number(request.headers.get("Content-Length") ?? 0) > max) {
    throw new ApiError("invalid-request");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("invalid-request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new ApiError("invalid-request");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError("invalid-request");
  }
}

interface Context {
  env: Env;
  visitor: string;
  limits: RoutingLimits;
  http: HttpOptions;
}

async function budgetCall(
  context: Context,
  path: "/reserve" | "/settle" | "/pause",
  payload: unknown,
): Promise<unknown> {
  try {
    const namespace = context.env.ROUTING_BUDGET;
    const stub = namespace.get(namespace.idFromName("global"));
    const response = await stub.fetch(`https://budget.internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(String(response.status));
    return await response.json();
  } catch {
    // Sin certeza sobre el saldo no se consulta al proveedor (fail-closed).
    throw new ApiError("unavailable");
  }
}

async function reserve(
  context: Context,
  input: Omit<ReserveInput, "visitor" | "provider">,
) {
  const result = (await budgetCall(context, "/reserve", {
    ...input,
    visitor: context.visitor,
    provider: "geoapify",
  })) as ReserveResult;
  if (!result || result.ok !== true || !Array.isArray(result.ids)) {
    throw new ApiError(
      result && result.ok === false
        ? (DENY_CODES[result.reason] ?? "unavailable")
        : "unavailable",
    );
  }
  return result.ids;
}

/** Coste y pausa son una confirmación indivisible e idempotente. Si se pierde,
 * la reserva persistida bloquea nuevas operaciones, incluso tras un reinicio. */
async function settle(
  context: Context,
  id: number,
  credits: number,
  pauseMs = 0,
) {
  const payload = { ids: [id], credits: [credits], pauseMs };
  try {
    await budgetCall(context, "/settle", payload);
  } catch {
    // Reintento interno de contabilidad; nunca repite la llamada al proveedor.
    await budgetCall(context, "/settle", payload);
  }
}

interface Billable<T> {
  action: Action;
  key: string;
  items: {
    endpoint: Endpoint;
    bound: CostBound;
    call: () => Promise<T>;
    actual: (result: T) => number;
  }[];
}

async function runBillable<T>(
  context: Context,
  operation: Billable<T>,
): Promise<T[]> {
  // Antes de tocar el presupuesto: sin cota verificable ni garantía, nada sale.
  const items = operation.items.map(({ endpoint, bound }) => {
    const decision = chargePolicy(bound, context.env.GEOAPIFY_CHARGE_GUARANTEE);
    if (!decision.allowed) throw new ApiError("cost-unbounded");
    return { endpoint, credits: decision.reserveCredits };
  });
  const reserved = items.map((item) => item.credits);
  const ids = await reserve(context, {
    action: operation.action,
    requestKey: operation.key,
    items,
  });

  const execute = async (index: number, id: number): Promise<T> => {
    const item = operation.items[index];
    let result: T;
    try {
      result = await item.call();
    } catch (error) {
      const pauseMs =
        error instanceof RoutingError
          ? error.kind === "quota-exceeded"
            ? context.limits.cooldownAfterQuotaMs
            : error.kind === "unauthorized"
              ? context.limits.cooldownAfterAuthMs
              : 0
          : 0;
      await settle(context, id, reserved[index], pauseMs);
      throw error;
    }
    // Fuera del catch del proveedor: un fallo contable nunca se convierte
    // en otra consulta ni liquida por error con el mínimo.
    await settle(context, id, item.actual(result));
    return result;
  };
  const outcomes = await Promise.allSettled(ids.map((id, i) => execute(i, id)));
  const failed = outcomes.flatMap((outcome, index) =>
    outcome.status === "rejected" ? [index] : [],
  );
  const retryable = failed.filter((index) => {
    const outcome = outcomes[index] as PromiseRejectedResult;
    return (
      outcome.reason instanceof RoutingError &&
      ["unavailable", "timeout"].includes(outcome.reason.kind)
    );
  });
  // No reintentar nada si hubo pausa o deuda contable. Ya se han esperado
  // todas las llamadas; ninguna plaza se libera por el fallo de su compañera.
  if (retryable.length > 0 && retryable.length === failed.length) {
    const retryIds = await reserve(context, {
      action: "retry",
      requestKey: operation.key,
      items: retryable.map((index) => items[index]),
    });
    const retried = await Promise.allSettled(
      retryIds.map((id, i) => execute(retryable[i], id)),
    );
    retryable.forEach((index, i) => {
      outcomes[index] = retried[i];
    });
  }
  for (const outcome of outcomes) {
    if (outcome.status !== "rejected") continue;
    const error = outcome.reason;
    if (error instanceof RoutingError && error.kind === "quota-exceeded")
      throw new ApiError("quota");
    if (error instanceof RoutingError && error.kind === "no-route")
      throw new ApiError("no-route");
    throw new ApiError("unavailable");
  }
  return outcomes.map(
    (outcome) => (outcome as PromiseFulfilledResult<T>).value,
  );
}

const column = (matrix: RoadMatrix, byRow: boolean) =>
  byRow ? matrix.cells.map((row) => row[0]) : matrix.cells[0];

async function handleLegs(
  context: Context,
  payload: unknown,
): Promise<LegsResponse> {
  const body = parseLegsBody(payload);
  if (!body) throw new ApiError("invalid-request");
  const provider = createGeoapifyProvider({
    apiKey: context.env.GEOAPIFY_API_KEY,
    http: context.http,
  });
  const to = { sources: [body.start], targets: body.locations };
  const from = { sources: body.locations, targets: [body.end] };
  const [toStation, fromStation] = await runBillable(context, {
    action: isRoundTrip(body) ? "nearby" : "trip-legs",
    key: await requestKey(context.visitor, ROUTING_API_PATHS.legs, body),
    items: [
      {
        endpoint: "matrix",
        bound: matrixCost(to.sources.length, to.targets.length),
        call: () => provider.matrix(to),
        actual: (matrix) => matrixActualCredits(matrix.cells),
      },
      {
        endpoint: "matrix",
        bound: matrixCost(from.sources.length, from.targets.length),
        call: () => provider.matrix(from),
        actual: (matrix) => matrixActualCredits(matrix.cells),
      },
    ],
  });
  return {
    provider: "geoapify",
    computedAt: toStation.computedAt,
    toStation: column(toStation, false),
    fromStation: column(fromStation, true),
  };
}

async function handleRoute(
  context: Context,
  payload: unknown,
): Promise<RouteResponse> {
  const body = parseRouteBody(payload);
  if (!body) throw new ApiError("invalid-request");
  const provider = createGeoapifyProvider({
    apiKey: context.env.GEOAPIFY_API_KEY,
    http: context.http,
  });
  const waypoints = body.via
    ? [body.start, body.via, body.end]
    : [body.start, body.end];
  const [route] = await runBillable(context, {
    action: body.via ? "selected-route" : "trip-route",
    key: await requestKey(context.visitor, ROUTING_API_PATHS.route, body),
    items: [
      {
        endpoint: "routing",
        bound: routeCost(waypoints.length),
        call: () => provider.route(waypoints),
        actual: (result) => routeActualCredits(result.leg, waypoints.length),
      },
    ],
  });
  return {
    provider: "geoapify",
    computedAt: route.computedAt,
    leg: route.leg,
    geometry: route.geometry,
  };
}

async function handleAutocomplete(
  context: Context,
  url: URL,
): Promise<AutocompleteResponse> {
  if ([...url.searchParams.keys()].some((key) => key !== "text")) {
    throw new ApiError("invalid-request");
  }
  const text = parseAutocompleteText(url.searchParams.get("text"));
  if (!text) throw new ApiError("invalid-request");
  const search = createGeoapifyAutocomplete({
    apiKey: context.env.GEOAPIFY_API_KEY,
    http: context.http,
  });
  const limit = ROUTING_API_LIMITS.autocomplete.results;
  const normalized = text.toLocaleLowerCase("es");
  const [results] = await runBillable(context, {
    action: "autocomplete",
    key: await requestKey(
      context.visitor,
      ROUTING_API_PATHS.autocomplete,
      normalized,
    ),
    items: [
      {
        endpoint: "autocomplete",
        bound: autocompleteCost(),
        call: () => search(text, limit),
        actual: () => AUTOCOMPLETE_CREDITS,
      },
    ],
  });
  return { results };
}

export async function handleRequest(
  request: Request,
  env: Env,
  deps: Deps = {},
): Promise<Response> {
  const cors = corsFor(request.headers.get("Origin"), env);
  const fail = (code: RoutingApiErrorCode) =>
    respond({ error: code, message: MESSAGES[code] }, STATUS[code], cors);

  if (!cors) return fail("forbidden");
  if (request.method === "OPTIONS") return respond(null, 204, cors);
  if (env.ROUTING_ENABLED !== "true") return fail("disabled");

  const url = new URL(request.url);
  const route = (
    {
      [`POST ${ROUTING_API_PATHS.legs}`]: "legs",
      [`POST ${ROUTING_API_PATHS.route}`]: "route",
      [`GET ${ROUTING_API_PATHS.autocomplete}`]: "autocomplete",
    } as Record<string, "legs" | "route" | "autocomplete">
  )[`${request.method} ${url.pathname}`];
  if (!route) return fail("not-found");

  try {
    const payload = route === "autocomplete" ? null : await readJson(request);
    // Interruptor de emergencia y secretos: sin ellos no se consulta a nadie.
    if (
      env.GEOAPIFY_ENABLED !== "true" ||
      !env.GEOAPIFY_API_KEY ||
      !env.VISITOR_SALT
    ) {
      return fail("disabled");
    }
    const network = visitorNetwork(request.headers.get("CF-Connecting-IP"));
    if (!network) return fail("forbidden");

    const limits = deps.limits ?? DEFAULT_LIMITS;
    const context: Context = {
      env,
      visitor: await visitorId(network, env.VISITOR_SALT),
      limits,
      http: {
        fetch: deps.fetch,
        retries: 0,
        timeoutMs: limits.providerTimeoutMs,
      },
    };
    const body =
      route === "legs"
        ? await handleLegs(context, payload)
        : route === "route"
          ? await handleRoute(context, payload)
          : await handleAutocomplete(context, url);
    return respond(body, 200, cors);
  } catch (error) {
    return fail(error instanceof ApiError ? error.code : "unavailable");
  }
}

const worker = {
  fetch: (request: Request, env: Env) => handleRequest(request, env),
};

export default worker;
