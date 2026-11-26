import { useEffect, useMemo, useState } from "react";

import { AlertIcon, CloseIcon, LocateIcon } from "@/components/map/icons";
import { Segmented } from "@/components/segmented";
import type { AddressSuggestion } from "@/data/road-routing/worker-client";
import { priceUnit } from "@/domain/fuel-units";
import {
  findInvalidRefuelInputs,
  isRefuelFuel,
  quantityUnit,
  REFUEL_INPUT_LIMITS,
  type RefuelAssumptions,
} from "@/domain/refuel/economics";
import {
  refuelResultToGeoJSON,
  type RefuelFeatureCollection,
} from "@/domain/refuel/map-features";
import {
  describeRefuelOutcome,
  rerankWithReference,
  SERVICE_DISABLED_NOTICE,
  type RefuelNotice,
} from "@/domain/refuel/outcome";
import { ROUTING_API_LIMITS } from "@/domain/refuel/routing-api";
import {
  FUEL_LABELS,
  type Coordinates,
  type FuelCode,
  type Station,
} from "@/domain/stations";
import {
  formatCount,
  formatEuros,
  formatRetrievedAt,
  formatSignedEuros,
} from "@/lib/format";

import { AddressField } from "./address-field";
import { RefuelResults } from "./refuel-results";
import {
  useAddressSearch,
  useRefuelSearch,
  useSelectedRefuelRoute,
} from "./use-refuel-search";

// Panel «Repostar cerca de mí» y «Repostar durante un viaje». Reúne los
// supuestos del usuario, lanza una búsqueda explícita y presenta el ahorro
// neto. Los precios oficiales siguen visibles aunque el servicio de rutas
// esté desactivado, agotado o caído.

export type RefuelMode = "nearby" | "trip";
const MODES: readonly [RefuelMode, string][] = [
  ["nearby", "Cerca de mí"],
  ["trip", "Durante un viaje"],
];
type OriginMode = "location" | "address";
const ORIGIN_MODES: readonly [OriginMode, string][] = [
  ["location", "Mi ubicación"],
  ["address", "Otra dirección"],
];

const fieldLabel = "mb-1.5 block text-[0.75rem] font-bold text-muted";
const NOTICE_TONES: Record<RefuelNotice["kind"], string> = {
  disabled: "bg-mist text-ink-2",
  quota: "bg-amber-50 text-amber-950",
  "rate-limited": "bg-amber-50 text-amber-950",
  unavailable: "bg-rose-50 text-rose-900",
  "invalid-request": "bg-rose-50 text-rose-900",
  "invalid-input": "bg-rose-50 text-rose-900",
  "no-route": "bg-amber-50 text-amber-950",
  "no-candidates": "bg-amber-50 text-amber-950",
};

/** Admite coma o punto decimal; vacío o ilegible da NaN. */
function parseDecimal(value: string): number {
  const trimmed = value.trim().replace(",", ".");
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

function Notice({ notice }: { notice: RefuelNotice }) {
  return (
    <div
      role={notice.role}
      className={`flex gap-2.5 rounded-xl px-3.5 pt-3 pb-2.5 text-[0.875rem] leading-5 ${NOTICE_TONES[notice.kind]}`}
    >
      <AlertIcon className="mt-px size-4 shrink-0" />
      <p>
        <strong className="block font-extrabold">{notice.title}</strong>
        {notice.message}
      </p>
    </div>
  );
}

export function RefuelPanel({
  mode,
  onModeChange,
  stations,
  fuel,
  pricesRetrievedAt,
  dataReady,
  userLocation,
  locationStatus,
  onRequestLocation,
  focusedId,
  onFocusStation,
  onMapChange,
  onClose,
}: {
  mode: RefuelMode;
  onModeChange: (mode: RefuelMode) => void;
  stations: readonly Station[];
  fuel: FuelCode;
  /** Descarga del conjunto publicado; `null` mientras no hay manifiesto. */
  pricesRetrievedAt: string | null;
  dataReady: boolean;
  userLocation: Coordinates | null;
  locationStatus: string | null;
  onRequestLocation: () => void;
  focusedId: string | null;
  onFocusStation: (stationId: string | null) => void;
  /** Geometrías del resultado para el mapa; `null` las retira. */
  onMapChange: (collection: RefuelFeatureCollection | null) => void;
  onClose: () => void;
}) {
  const { enabled, provider, state, run, reset } = useRefuelSearch(
    stations,
    pricesRetrievedAt,
  );
  const searchAddress = useAddressSearch();
  const [quantity, setQuantity] = useState("40");
  const [consumption, setConsumption] = useState("6,5");
  const [originMode, setOriginMode] = useState<OriginMode>("location");
  const [originAddress, setOriginAddress] = useState<AddressSuggestion | null>(
    null,
  );
  const [destination, setDestination] = useState<AddressSuggestion | null>(
    null,
  );
  const [referenceId, setReferenceId] = useState<string | null>(null);

  const refuelFuel = isRefuelFuel(fuel) ? fuel : null;
  const unit = refuelFuel ? quantityUnit(refuelFuel) : "L";
  const assumptions: RefuelAssumptions | null = refuelFuel
    ? {
        fuel: refuelFuel,
        quantity: parseDecimal(quantity),
        consumptionPer100Km: parseDecimal(consumption),
      }
    : null;
  const invalidFields = assumptions ? findInvalidRefuelInputs(assumptions) : [];
  const origin =
    mode === "trip" && originMode === "address"
      ? (originAddress?.location ?? null)
      : userLocation;
  const tripDestination =
    mode === "trip" ? (destination?.location ?? null) : null;
  const loading = state.phase === "loading";
  const missing = !origin
    ? mode === "nearby" || originMode === "location"
      ? "Activa tu ubicación para calcular."
      : "Elige la dirección de salida."
    : mode === "trip" && !tripDestination
      ? "Elige el destino del viaje."
      : null;
  const canSubmit =
    enabled &&
    dataReady &&
    assumptions !== null &&
    invalidFields.length === 0 &&
    missing === null &&
    !loading;

  // Cantidad y consumo no cambian las rutas: se recalcula al vuelo, sin
  // nuevas peticiones, mientras el combustible sea el de la búsqueda.
  const done = state.phase === "done" ? state : null;
  const fuelChanged =
    done !== null && done.request.assumptions.fuel !== refuelFuel;
  const quantityValue = parseDecimal(quantity);
  const consumptionValue = parseDecimal(consumption);
  const inputsValid = invalidFields.length === 0;
  const ranking = useMemo(() => {
    if (!done || done.result.status !== "ok" || fuelChanged) return null;
    const current = inputsValid
      ? {
          ...done.request.assumptions,
          quantity: quantityValue,
          consumptionPer100Km: consumptionValue,
        }
      : done.request.assumptions;
    return rerankWithReference(done.result.ranking, current, referenceId);
  }, [
    done,
    fuelChanged,
    inputsValid,
    quantityValue,
    consumptionValue,
    referenceId,
  ]);

  const selectedOption =
    ranking?.options.find((option) => option.station.id === focusedId) ?? null;
  const selectedRoute = useSelectedRefuelRoute(provider, done, selectedOption);
  const selectedGeometry = selectedRoute.route;
  const collection = useMemo(
    () =>
      ranking && done && done.result.status === "ok"
        ? refuelResultToGeoJSON({
            ranking,
            route: selectedGeometry ?? done.result.route,
            origin: done.request.origin,
            destination: done.request.destination,
          })
        : null,
    [ranking, done, selectedGeometry],
  );
  useEffect(() => {
    onMapChange(collection);
  }, [collection, onMapChange]);
  useEffect(() => () => onMapChange(null), [onMapChange]);

  // Al terminar una búsqueda, el resultado queda a la vista bajo el formulario.
  useEffect(() => {
    if (state.phase !== "done") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    document.getElementById("refuel-results-title")?.scrollIntoView({
      block: "start",
      behavior: reduced.matches ? "auto" : "smooth",
    });
  }, [state]);

  // Al pulsar un punto del mapa, la fila correspondiente se hace visible.
  useEffect(() => {
    if (!focusedId) return;
    document
      .querySelector(`[data-refuel-row="${CSS.escape(focusedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  function changeMode(next: RefuelMode) {
    reset();
    setReferenceId(null);
    onFocusStation(null);
    onModeChange(next);
  }

  function submit() {
    if (!canSubmit || !origin || !assumptions) return;
    setReferenceId(null);
    onFocusStation(null);
    void run({
      movement: mode === "trip" ? "detour" : "dedicated-trip",
      origin,
      destination: tripDestination,
      assumptions,
    });
  }

  const notice: RefuelNotice | null = !enabled
    ? SERVICE_DISABLED_NOTICE
    : done && !fuelChanged
      ? describeRefuelOutcome(
          done.result,
          done.request.assumptions.fuel,
          done.request.movement,
        )
      : null;
  const best = ranking?.options[0];
  const announcement = loading
    ? "Calculando rutas por carretera…"
    : ranking && best
      ? `${formatCount(ranking.options.length)} gasolineras comparadas. La primera, ${best.station.brand ?? "sin rótulo"} en ${best.station.municipality}, ${best.profitability === "reference" ? "es la referencia" : `con un ahorro neto de ${formatSignedEuros(best.versusReference.netSaving)}`}.`
      : "";

  return (
    <div className="flex flex-col gap-5 px-5 pt-2 pb-6">
      <div className="-mx-1 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="link-action press group px-1"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 6-6 6 6 6" />
          </svg>
          Volver a la lista
        </button>
        <button
          type="button"
          onClick={onClose}
          className="press text-muted hover-fine:bg-[rgb(15_29_46/6%)] hover-fine:text-ink grid size-11 place-items-center rounded-xl transition-colors duration-150"
          aria-label="Cerrar el cálculo de repostaje"
        >
          <CloseIcon className="size-[1.125rem]" />
        </button>
      </div>

      <div>
        <h2
          id="refuel-title"
          tabIndex={-1}
          className="text-ink optical rounded-sm text-[1.25rem] leading-tight font-extrabold tracking-[-0.02em]"
        >
          ¿Dónde compensa repostar?
        </h2>
        <p className="text-muted mt-1 text-[0.875rem] leading-5">
          Compara el ahorro por precio con lo que cuesta llegar hasta cada
          gasolinera por carretera.
        </p>
      </div>

      <Segmented
        name="refuel-mode"
        legend="Modalidad"
        options={MODES}
        value={mode}
        onChange={changeMode}
      />

      {notice?.kind === "disabled" ? <Notice notice={notice} /> : null}

      <form
        className="flex flex-col gap-4"
        aria-describedby="refuel-privacy"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {mode === "trip" ? (
          <>
            <Segmented
              name="refuel-origin"
              legend="Salida"
              legendClassName={fieldLabel}
              options={ORIGIN_MODES}
              value={originMode}
              onChange={setOriginMode}
              className="seg-sm"
            />
            {originMode === "address" ? (
              <AddressField
                label="Dirección de salida"
                value={originAddress}
                onChange={setOriginAddress}
                search={searchAddress}
                disabled={!enabled}
              />
            ) : null}
          </>
        ) : null}

        {mode === "nearby" || originMode === "location" ? (
          <div>
            <button
              type="button"
              onClick={onRequestLocation}
              aria-pressed={userLocation !== null}
              className={`btn w-full ${userLocation ? "bg-positive-soft text-positive-strong" : "btn-soft"}`}
            >
              <LocateIcon className="size-4" />
              <span className="optical">
                {userLocation ? "Ubicación activada" : "Usar mi ubicación"}
              </span>
            </button>
            <p
              className="text-muted mt-1.5 min-h-4 text-[0.75rem] leading-4"
              role="status"
              aria-live="polite"
            >
              {locationStatus ??
                "Solo se solicitará permiso al pulsar el botón."}
            </p>
          </div>
        ) : null}

        {mode === "trip" ? (
          <AddressField
            label="Destino"
            value={destination}
            onChange={setDestination}
            search={searchAddress}
            disabled={!enabled}
          />
        ) : null}

        <fieldset className="grid grid-cols-2 gap-x-3 gap-y-1">
          <legend className={fieldLabel}>
            Tus supuestos ·{" "}
            {refuelFuel ? FUEL_LABELS[refuelFuel] : FUEL_LABELS[fuel]}
          </legend>
          {(
            [
              ["quantity", "A repostar", unit, quantity, setQuantity],
              [
                "consumptionPer100Km",
                "Consumo",
                `${unit}/100 km`,
                consumption,
                setConsumption,
              ],
            ] as const
          ).map(([field, label, suffix, value, setValue]) => {
            const invalid = invalidFields.includes(field);
            const { min, max } = REFUEL_INPUT_LIMITS[field];
            return (
              <div key={field}>
                <label
                  htmlFor={`refuel-${field}`}
                  className="text-ink-2 mb-1 block text-[0.8125rem] font-bold"
                >
                  {label}{" "}
                  <span className="text-muted font-medium">({suffix})</span>
                </label>
                <input
                  id={`refuel-${field}`}
                  type="text"
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  aria-invalid={invalid}
                  aria-describedby={`refuel-${field}-hint`}
                  className={`control num ${invalid ? "border-dear" : ""}`}
                />
                <p
                  id={`refuel-${field}-hint`}
                  className={`mt-1 text-[0.75rem] leading-4 ${invalid ? "font-bold text-rose-800" : "text-muted"}`}
                >
                  Entre {formatCount(min)} y {formatCount(max)}
                </p>
              </div>
            );
          })}
        </fieldset>
        {!refuelFuel ? (
          <p className="text-[0.8125rem] font-bold text-rose-800" role="alert">
            Elige un combustible de automoción en «Buscar y filtrar».
          </p>
        ) : null}

        <p
          id="refuel-privacy"
          className="text-muted text-[0.75rem] leading-[1.05rem]"
        >
          Al calcular, tu punto de salida (redondeado a unos 11 m)
          {mode === "trip" ? ", el destino" : ""} y hasta{" "}
          {ROUTING_API_LIMITS.maxLocations} gasolineras se envían al servicio de
          rutas de FuelShift y a Geoapify. Al buscar una dirección se envía el
          texto a ambos servicios. FuelShift no guarda trayectos legibles; para
          limitar abusos conserva unas 48 h códigos seudónimos de tu conexión y
          de cada consulta. Según su política, Geoapify (alojado en la UE)
          conserva las peticiones correctas hasta 24 h.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="btn btn-primary flex-1"
            disabled={!canSubmit}
            aria-describedby="refuel-submit-hint"
          >
            <span className="optical">
              {loading ? "Calculando…" : "Calcular ahorro"}
            </span>
          </button>
          {loading ? (
            <button type="button" className="btn btn-soft" onClick={reset}>
              <span className="optical">Cancelar</span>
            </button>
          ) : null}
        </div>
        <p
          id="refuel-submit-hint"
          className="text-muted -mt-2 min-h-4 text-[0.75rem] leading-4"
        >
          {!enabled
            ? "Disponible cuando se active el servicio de rutas."
            : !dataReady
              ? "Esperando a que carguen los precios oficiales."
              : invalidFields.length > 0
                ? "Revisa la cantidad y el consumo."
                : (missing ?? "")}
        </p>
      </form>

      <section
        aria-labelledby="refuel-results-title"
        className="flex flex-col gap-3 pt-4 shadow-[inset_0_1px_0_var(--line-soft)]"
      >
        <h3
          id="refuel-results-title"
          className="text-ink text-[0.9375rem] font-extrabold tracking-[-0.01em]"
        >
          Resultado
        </h3>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        {loading ? (
          <div aria-hidden="true" className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="border-line animate-pulse rounded-2xl border px-3 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-mist size-9 rounded-[0.625rem]" />
                  <div className="flex-1 space-y-2">
                    <div className="bg-mist h-3 w-2/5 rounded" />
                    <div className="bg-mist h-2.5 w-3/5 rounded" />
                  </div>
                </div>
                <div className="bg-mist mt-3 h-8 rounded" />
              </div>
            ))}
            <p className="text-muted text-[0.8125rem]">
              Calculando rutas por carretera…
            </p>
          </div>
        ) : null}

        {notice && notice.kind !== "disabled" ? (
          <Notice notice={notice} />
        ) : null}

        {fuelChanged ? (
          <p className="text-muted text-[0.875rem]" role="status">
            Has cambiado de combustible. Vuelve a calcular para comparar precios
            de {FUEL_LABELS[fuel]}.
          </p>
        ) : null}

        {ranking && done && done.result.status === "ok" ? (
          <>
            <RefuelResults
              ranking={ranking}
              movement={done.request.movement}
              unit={priceUnit(done.request.assumptions.fuel)}
              focusedId={focusedId}
              onFocus={(id) => onFocusStation(id)}
              onReferenceChange={(id) => {
                setReferenceId(id);
                onFocusStation(id);
              }}
            />
            {selectedOption ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="btn btn-soft"
                  disabled={selectedRoute.loading}
                  onClick={() => void selectedRoute.show()}
                >
                  {selectedRoute.loading
                    ? "Cargando recorrido…"
                    : "Mostrar recorrido de la gasolinera seleccionada"}
                </button>
                <p className="text-muted text-[0.75rem]" role="status">
                  {selectedRoute.message ??
                    (selectedGeometry
                      ? "Recorrido por carretera mostrado; incluye ida y vuelta o continuación al destino."
                      : "Solo se consultará el recorrido de esta gasolinera al pulsar el botón.")}
                </p>
              </div>
            ) : null}
            <div className="text-muted space-y-1 text-[0.75rem] leading-[1.15rem]">
              {done.result.unreachable.length > 0 ? (
                <p>
                  {formatCount(done.result.unreachable.length)}{" "}
                  {done.result.unreachable.length === 1
                    ? "gasolinera cercana no tiene"
                    : "gasolineras cercanas no tienen"}{" "}
                  ruta por carretera y se han excluido.
                </p>
              ) : null}
              <p>
                <strong className="text-ink-2">Precios oficiales</strong>:
                MITECO, descarga{" "}
                {formatRetrievedAt(done.result.freshness.retrievedAt)}.
                {done.result.freshness.stale ? (
                  <strong className="text-amber-900">
                    {" "}
                    Tienen más de 48 horas.
                  </strong>
                ) : null}
              </p>
              <p>
                <strong className="text-ink-2">Rutas</strong>: calculadas por{" "}
                <a
                  className="text-ink-2 font-semibold underline underline-offset-[3px]"
                  href="https://www.geoapify.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Geoapify
                </a>{" "}
                con datos de{" "}
                <a
                  className="text-ink-2 font-semibold underline underline-offset-[3px]"
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenStreetMap
                </a>
                , {formatRetrievedAt(done.result.routesComputedAt)}.
              </p>
              <p>
                <strong className="text-ink-2">Cálculo de FuelShift</strong> con
                tus supuestos. Repostaje de referencia:{" "}
                {formatEuros(ranking.reference.cost.fillCost)}.
              </p>
            </div>
          </>
        ) : null}

        {state.phase === "idle" && enabled ? (
          <p className="text-muted text-[0.875rem] leading-5">
            {mode === "trip"
              ? "Elige salida y destino y pulsa «Calcular ahorro» para ver las gasolineras de tu ruta."
              : "Activa tu ubicación y pulsa «Calcular ahorro» para comparar las gasolineras cercanas."}
          </p>
        ) : null}
      </section>
    </div>
  );
}
