import { useEffect, useMemo, useRef, useState } from "react";

import { withRoutingCache } from "@/data/road-routing/cache";
import {
  createWorkerAutocomplete,
  createWorkerRoutingProvider,
  routingServiceUrl,
  type AddressSuggestion,
} from "@/data/road-routing/worker-client";
import type {
  RefuelAssumptions,
  RefuelOption,
} from "@/domain/refuel/economics";
import {
  RoutingError,
  type RoadRoute,
  type RoadRoutingProvider,
} from "@/domain/refuel/road-routing";
import {
  findNearbyRefuel,
  findTripRefuel,
  findSelectedRefuelRoute,
  type RefuelSearchResult,
} from "@/domain/refuel/planner";
import type { Coordinates, Station } from "@/domain/stations";

// Estado de una búsqueda de repostaje. Solo se llama al servicio tras pulsar
// «Calcular»: nunca al abrir el panel, escribir ni mover el mapa. Una búsqueda
// nueva cancela la anterior.

export interface RefuelRequest {
  movement: "dedicated-trip" | "detour";
  origin: Coordinates;
  destination: Coordinates | null;
  assumptions: RefuelAssumptions;
}

export type RefuelSearchState =
  | { phase: "idle" }
  | { phase: "loading"; request: RefuelRequest }
  | {
      phase: "done";
      request: RefuelRequest;
      result: RefuelSearchResult<Station>;
    };

/** URL del Worker fijada al compilar; sin ella no se hace ninguna petición. */
const SERVICE_URL = routingServiceUrl();

export function useRefuelSearch(
  stations: readonly Station[],
  pricesRetrievedAt: string | null,
) {
  const provider = useMemo(
    () =>
      // La caché de sesión evita repetir (y pagar) una búsqueda idéntica.
      SERVICE_URL
        ? withRoutingCache(
            createWorkerRoutingProvider({ baseUrl: SERVICE_URL }),
          )
        : null,
    [],
  );
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<RefuelSearchState>({ phase: "idle" });

  useEffect(() => () => controller.current?.abort(), []);

  async function run(request: RefuelRequest) {
    if (!provider || !pricesRetrievedAt) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ phase: "loading", request });
    const base = {
      stations,
      origin: request.origin,
      assumptions: request.assumptions,
      pricesRetrievedAt,
      signal: current.signal,
    };
    const result =
      request.movement === "detour" && request.destination
        ? await findTripRefuel(provider, {
            ...base,
            destination: request.destination,
          })
        : await findNearbyRefuel(provider, base);
    if (current.signal.aborted) return;
    setState({ phase: "done", request, result });
  }

  function reset() {
    controller.current?.abort();
    setState({ phase: "idle" });
  }

  return { enabled: provider !== null, provider, state, run, reset };
}

/** Seleccionar solo resalta; el botón «Mostrar recorrido» es quien consulta.
 * El cambio de estación o búsqueda cancela y descarta la respuesta anterior. */
export function useSelectedRefuelRoute(
  provider: RoadRoutingProvider | null,
  done: Extract<RefuelSearchState, { phase: "done" }> | null,
  option: RefuelOption<Station> | null,
) {
  const key =
    done && option
      ? JSON.stringify([
          done.request,
          option.station.id,
          option.cost.attributable,
        ])
      : null;
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    key: string;
    phase: "loading" | "done" | "error";
    route?: RoadRoute;
    message?: string;
  } | null>(null);
  useEffect(() => () => controller.current?.abort(), [key]);

  async function show() {
    if (!provider || !done || !option || !key || done.result.status !== "ok")
      return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setState({ key, phase: "loading" });
    try {
      const route = await findSelectedRefuelRoute(
        provider,
        done.request.origin,
        done.request.destination,
        option.station.location,
        option.cost.attributable,
        done.result.route,
        current.signal,
      );
      if (!current.signal.aborted) setState({ key, phase: "done", route });
    } catch (error) {
      if (!current.signal.aborted)
        setState({
          key,
          phase: "error",
          message:
            error instanceof RoutingError
              ? error.message
              : "No se ha podido mostrar el recorrido.",
        });
    }
  }
  const visible = state?.key === key ? state : null;
  return {
    show,
    route: visible?.route ?? null,
    loading: visible?.phase === "loading",
    message: visible?.message ?? null,
  };
}

/** Autocompletado bajo demanda: una consulta por pulsación de «Buscar». */
export function useAddressSearch() {
  const search = useMemo(
    () =>
      SERVICE_URL ? createWorkerAutocomplete({ baseUrl: SERVICE_URL }) : null,
    [],
  );
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  return useMemo(
    () =>
      search
        ? (text: string): Promise<AddressSuggestion[]> => {
            controller.current?.abort();
            const current = new AbortController();
            controller.current = current;
            return search(text, current.signal);
          }
        : null,
    [search],
  );
}
