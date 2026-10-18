import { getBrandIdentity } from "@/domain/brands";
import { buildComparatorHref } from "@/domain/comparator-link";
import {
  FUEL_LABELS,
  getStationPrice,
  type Coordinates,
  type FuelCode,
  type Station,
} from "@/domain/stations";
import { formatPrice } from "@/lib/format";

import { BrandMark } from "./brand-mark";
import { ClockIcon, CloseIcon, PinIcon, RouteIcon } from "./icons";

function directionsUrl(
  station: Station,
  userLocation: Coordinates | null,
): string {
  const destination = `${station.location.latitude},${station.location.longitude}`;
  const origin = userLocation
    ? `${userLocation.latitude},${userLocation.longitude}`
    : "";
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(origin)}%3B${encodeURIComponent(destination)}`;
}

export function StationDetail({
  station,
  fuel,
  userLocation,
  rankPosition,
  rankingContext,
  onClose,
}: {
  station: Station;
  fuel: FuelCode;
  userLocation: Coordinates | null;
  rankPosition: number | null;
  rankingContext: string;
  onClose: () => void;
}) {
  const selectedPrice = getStationPrice(station, fuel);
  const comparatorHref =
    selectedPrice === null
      ? null
      : buildComparatorHref(station.id, fuel, selectedPrice);
  const availablePrices = Object.entries(station.fuels) as [FuelCode, string][];
  const identity = getBrandIdentity(station.brand);

  return (
    <div>
      {/* El color de marca se usa solo como acento. */}
      <div
        className="h-1.5"
        style={{ backgroundColor: identity.color }}
        aria-hidden="true"
      />
      <div className="p-5">
        <div className="flex items-start gap-3">
          <BrandMark identity={identity} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-muted text-[0.6875rem] font-semibold tracking-[0.12em] uppercase">
              {station.provinceName}
            </p>
            <h2
              id="station-detail-title"
              className="text-ink mt-0.5 text-xl leading-tight font-semibold tracking-[-0.02em]"
            >
              {station.brand ?? "Sin rótulo"}
            </h2>
            <p className="text-muted mt-1 text-xs">
              {identity.known ? `${identity.name} · ` : ""}Estación MITECO{" "}
              {station.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-canvas hover:text-ink -mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg transition-colors"
            aria-label="Cerrar ficha de la estación"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        {selectedPrice !== null ? (
          <div
            className="border-line bg-canvas/70 mt-4 rounded-xl border border-l-4 px-4 py-4"
            style={{ borderLeftColor: identity.color }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-medium">
                {FUEL_LABELS[fuel]}
              </p>
              {rankPosition !== null ? (
                <span className="bg-positive-soft text-positive rounded-full px-2 py-0.5 text-xs font-semibold">
                  #{rankPosition} {rankingContext}
                </span>
              ) : null}
            </div>
            <p className="text-ink mt-1.5 text-[2.75rem] leading-none font-bold tracking-[-0.035em] tabular-nums">
              {formatPrice(selectedPrice)}
            </p>
            <p className="text-muted mt-2.5 text-[0.6875rem] leading-4">
              Precio comunicado · unidad no acreditada por el contrato REST
            </p>
          </div>
        ) : null}

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex gap-3">
            <dt className="text-muted mt-0.5">
              <PinIcon className="size-4" />
              <span className="sr-only">Dirección</span>
            </dt>
            <dd className="text-ink leading-5">
              {station.address}
              <span className="text-muted block text-xs">
                {station.postal_code ? `${station.postal_code} · ` : ""}
                {station.municipality}
                {station.locality && station.locality !== station.municipality
                  ? ` · ${station.locality}`
                  : ""}
              </span>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-muted mt-0.5">
              <ClockIcon className="size-4" />
              <span className="sr-only">Horario comunicado</span>
            </dt>
            <dd className="text-ink leading-5">
              {station.opening_hours ?? "Horario no comunicado"}
            </dd>
          </div>
        </dl>

        {comparatorHref ? (
          <a
            href={comparatorHref}
            className="border-accent text-accent hover:bg-accent-soft mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-[0.625rem] border px-4 text-sm font-semibold"
          >
            Comparar coste de conducción con este precio
          </a>
        ) : null}

        <a
          href={directionsUrl(station, userLocation)}
          target="_blank"
          rel="noreferrer"
          className="bg-accent hover:bg-accent-strong mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[0.625rem] px-4 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgb(31_98_176/70%)] transition-colors"
        >
          <RouteIcon className="size-4" />
          Obtener indicaciones
          <span className="sr-only">(se abre en una pestaña nueva)</span>
        </a>

        <section
          className="border-line mt-5 border-t pt-4"
          aria-labelledby="available-prices-title"
        >
          <h3
            id="available-prices-title"
            className="text-muted text-xs font-semibold tracking-[0.08em] uppercase"
          >
            Precios disponibles
          </h3>
          <ul className="mt-2">
            {availablePrices.map(([code, price]) => {
              const current = code === fuel;
              return (
                <li
                  className={`flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm ${current ? "bg-canvas" : ""}`}
                  key={code}
                >
                  <span
                    className={current ? "text-ink font-medium" : "text-muted"}
                  >
                    {FUEL_LABELS[code]}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${current ? "text-accent-strong" : "text-ink"}`}
                  >
                    {formatPrice(Number(price))}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-muted mt-3 text-[0.6875rem] leading-4">
            MITECO comunica una fecha global del conjunto, no una fecha
            individual para esta estación o cada precio.
          </p>
        </section>
      </div>
    </div>
  );
}
