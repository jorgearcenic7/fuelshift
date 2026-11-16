import { PriceUnitLabel } from "@/components/price-unit";
import { getBrandIdentity } from "@/domain/brands";
import { buildComparatorHref } from "@/domain/comparator-link";
import { describeStationPrice } from "@/domain/fill-phrases";
import { priceUnit } from "@/domain/fuel-units";
import { scalePosition, type PriceScale } from "@/domain/price-heatmap";
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
import { HEAT_GRADIENT_CSS } from "./price-heatmap-layer";

// Ficha de una estación: tótem con todos sus precios, posición en la escala
// nacional, horario, dirección, cómo llegar y enlace al comparador con el
// precio de esta estación ya rellenado.

/** Ruta en OpenStreetMap; si hay ubicación de la persona, sale desde ahí. */
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

/** Texto para lectores de pantalla equivalente al indicador visual. */
function describeScalePosition(
  price: number,
  scale: PriceScale,
  fuel: FuelCode,
): string {
  const range = `entre el percentil 5 (${formatPrice(scale.low)}) y el percentil 95 (${formatPrice(scale.high)})`;
  if (price <= scale.low) {
    return `En la escala nacional de ${FUEL_LABELS[fuel]}, este precio está en el extremo barato, ${range}.`;
  }
  if (price >= scale.high) {
    return `En la escala nacional de ${FUEL_LABELS[fuel]}, este precio está en el extremo caro, ${range}.`;
  }
  const percent = Math.round(scalePosition(price, scale) * 100);
  return `En la escala nacional de ${FUEL_LABELS[fuel]}, este precio está al ${percent} % del recorrido ${range}.`;
}

export function StationDetail({
  station,
  fuel,
  userLocation,
  rankPosition,
  rankingContext,
  nationalMean,
  nationalScale,
  onClose,
}: {
  station: Station;
  fuel: FuelCode;
  userLocation: Coordinates | null;
  rankPosition: number | null;
  rankingContext: string;
  /** Media nacional del combustible; `null` si la carga está incompleta. */
  nationalMean: number | null;
  /** Escala P5–P95 del mapa de calor; `null` mientras no está calculada. */
  nationalScale: PriceScale | null;
  onClose: () => void;
}) {
  const selectedPrice = getStationPrice(station, fuel);
  const unit = priceUnit(fuel);
  const comparatorHref =
    selectedPrice === null
      ? null
      : buildComparatorHref(station.id, fuel, selectedPrice);
  const availablePrices = Object.entries(station.fuels) as [FuelCode, string][];
  const identity = getBrandIdentity(station.brand);
  const facts =
    selectedPrice === null
      ? null
      : describeStationPrice({ price: selectedPrice, unit, nationalMean });
  const flatScale =
    nationalScale !== null && nationalScale.high - nationalScale.low < 1e-9;

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
          aria-label="Cerrar ficha de la estación"
        >
          <CloseIcon className="size-[1.125rem]" />
        </button>
      </div>

      {/* Tótem: como el poste de precios de una gasolinera. */}
      <div className="rounded-[1.125rem_1.125rem_0.625rem_0.625rem] bg-[linear-gradient(180deg,#163f6c,#0f2f52)] px-3.5 pt-3.5 pb-2.5 text-white shadow-[0_18px_34px_-18px_rgb(15_47_82/80%)]">
        {/* El color de marca se usa solo como acento. */}
        <div
          aria-hidden="true"
          className="mx-auto mb-2.5 h-1 w-16 rounded-full"
          style={{ backgroundColor: identity.color }}
        />
        <div className="text-ink flex items-center gap-3 rounded-[0.625rem] bg-white px-2.5 py-2">
          <BrandMark identity={identity} size="lg" />
          <div className="min-w-0">
            <h2
              id="station-detail-title"
              tabIndex={-1}
              className="optical rounded-sm text-[1.25rem] leading-tight font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere]"
            >
              {station.brand ?? "Sin rótulo"}
            </h2>
            <p className="text-muted mt-0.5 text-[0.8125rem] leading-snug">
              {station.provinceName}
              <span aria-hidden="true"> · </span>
              {identity.known ? `${identity.name} · ` : ""}Estación MITECO{" "}
              {station.id}
            </p>
          </div>
        </div>

        <section aria-labelledby="available-prices-title" className="mt-2.5">
          <h3
            id="available-prices-title"
            className="px-1.5 text-[0.75rem] font-bold text-[#c9d6e4]"
          >
            Precios disponibles
          </h3>
          <ul className="mt-1">
            {availablePrices.map(([code, price]) => {
              const current = code === fuel;
              return (
                <li
                  key={code}
                  className={`flex items-baseline justify-between gap-3 rounded-lg px-1.5 pt-2.5 pb-2 ${current ? "bg-positive" : "[&+&]:shadow-[inset_0_1px_0_rgb(255_255_255/10%)]"}`}
                >
                  <span
                    className={`text-[0.8125rem] font-bold ${current ? "text-[#e3f3ea]" : "text-[#c9d6e4]"}`}
                  >
                    {FUEL_LABELS[code]}
                    {current ? (
                      <span className="sr-only"> (combustible elegido)</span>
                    ) : null}
                  </span>
                  <span
                    className={`num leading-none font-extrabold tracking-[-0.03em] ${current ? "text-[2rem]" : "text-[1.5rem]"}`}
                  >
                    {formatPrice(Number(price))}
                    <PriceUnitLabel
                      unit={priceUnit(code)}
                      className={`ml-0.5 text-[0.75rem] font-bold tracking-normal ${current ? "text-[#e3f3ea]" : "text-[#c9d6e4]"}`}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <p className="mt-2 text-center text-[0.75rem] leading-4 text-[#c9d6e4]">
          Precio en surtidor sin descuentos, comunicado a MITECO.
        </p>
      </div>

      {rankPosition !== null || (nationalScale && selectedPrice !== null) ? (
        <div className="flex flex-col gap-3">
          {rankPosition !== null ? (
            <p className="bg-positive-soft text-positive-strong optical inline-flex self-start rounded-full px-2.5 py-1 text-[0.8125rem] font-extrabold">
              #{rankPosition} {rankingContext}
            </p>
          ) : null}
          {nationalScale && selectedPrice !== null && !flatScale ? (
            <div>
              <span
                aria-hidden="true"
                className="gauge"
                style={{ background: HEAT_GRADIENT_CSS }}
              >
                <i
                  className="gauge-mark"
                  style={{
                    left: `${scalePosition(selectedPrice, nationalScale) * 100}%`,
                  }}
                />
              </span>
              <p className="sr-only">
                {describeScalePosition(selectedPrice, nationalScale, fuel)}
              </p>
              <p
                aria-hidden="true"
                className="num text-muted mt-2.5 flex justify-between gap-2 text-[0.75rem]"
              >
                <span>
                  {formatPrice(nationalScale.low)}{" "}
                  <span className="text-ink-2 font-bold">barato</span>
                </span>
                <span className="text-center">
                  escala nacional · {FUEL_LABELS[fuel]}
                </span>
                <span>
                  <span className="text-ink-2 font-bold">caro</span>{" "}
                  {formatPrice(nationalScale.high)}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {facts ? (
        <p className="text-ink-2 num text-[0.9375rem] leading-relaxed text-pretty">
          {facts}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <a
          href={directionsUrl(station, userLocation)}
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary"
        >
          <RouteIcon className="size-4" />
          <span className="optical">Cómo llegar</span>
          <span className="sr-only">(se abre en una pestaña nueva)</span>
        </a>
        {comparatorHref ? (
          <a href={comparatorHref} className="btn btn-soft">
            <span className="optical">
              Comparar coste de conducción con este precio
            </span>
          </a>
        ) : null}
      </div>

      <dl className="text-ink-2 flex flex-col gap-2.5 text-[0.875rem] leading-5">
        <div className="flex gap-2.5">
          <dt className="text-muted mt-0.5 shrink-0">
            <PinIcon className="size-4" />
            <span className="sr-only">Dirección</span>
          </dt>
          <dd>
            {station.address}
            <span className="text-muted block text-[0.8125rem]">
              {station.postal_code ? `${station.postal_code} · ` : ""}
              {station.municipality}
              {station.locality && station.locality !== station.municipality
                ? ` · ${station.locality}`
                : ""}
            </span>
          </dd>
        </div>
        <div className="flex gap-2.5">
          <dt className="text-muted mt-0.5 shrink-0">
            <ClockIcon className="size-4" />
            <span className="sr-only">Horario comunicado</span>
          </dt>
          <dd>{station.opening_hours ?? "Horario no comunicado"}</dd>
        </div>
      </dl>

      <p className="text-muted text-[0.75rem] leading-[1.125rem]">
        MITECO comunica una fecha global del conjunto, no una fecha individual
        para esta estación o cada precio.
      </p>
    </div>
  );
}
