import {
  RoutingError,
  type RoutingProviderId,
} from "@/domain/refuel/road-routing";

export interface HttpOptions {
  /** Inyectable para las pruebas; por defecto, el `fetch` global. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Reintentos solo ante fallos transitorios (red o 5xx); nunca ante 429. */
  retries?: number;
}

export const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 1;

function errorForStatus(
  status: number,
  provider: RoutingProviderId,
): RoutingError {
  if (status === 401 || status === 403) {
    return new RoutingError("unauthorized", "Clave rechazada.", provider);
  }
  if (status === 429) {
    return new RoutingError("quota-exceeded", "Cuota agotada.", provider);
  }
  if (status >= 500) {
    return new RoutingError("unavailable", `Error ${status}.`, provider);
  }
  return new RoutingError("invalid-request", `Error ${status}.`, provider);
}

/**
 * Petición JSON con tiempo límite, cancelación y reintentos acotados. Las
 * coordenadas van en el cuerpo o la URL de esta petición y en ningún registro
 * de FuelShift: no se escriben en consola ni se persisten.
 */
export async function requestJson(
  provider: RoutingProviderId,
  url: string,
  init: RequestInit,
  options: HttpOptions = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) {
      throw new RoutingError("aborted", "Búsqueda cancelada.", provider);
    }
    const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let failure: RoutingError;
    try {
      const response = await doFetch(url, { ...init, signal: combined });
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new RoutingError(
            "invalid-response",
            "Respuesta no JSON.",
            provider,
          );
        }
      }
      failure = errorForStatus(response.status, provider);
    } catch (error) {
      if (error instanceof RoutingError) throw error;
      if (signal?.aborted) {
        throw new RoutingError("aborted", "Búsqueda cancelada.", provider);
      }
      failure = timeout.aborted
        ? new RoutingError("timeout", "Tiempo de espera agotado.", provider)
        : new RoutingError("unavailable", "Proveedor inaccesible.", provider);
    }

    // Cada reintento consume cuota: solo se repite lo que puede ser pasajero.
    const transient = failure.kind === "unavailable" || failure.kind === "timeout";
    if (!transient || attempt >= retries) throw failure;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
