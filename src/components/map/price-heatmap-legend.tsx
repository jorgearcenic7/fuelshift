import { useState } from "react";

import { PriceUnitLabel } from "@/components/price-unit";
import { priceUnit } from "@/domain/fuel-units";
import { HEATMAP_SIGMA_KM, type PriceHeatmap } from "@/domain/price-heatmap";
import { FUEL_LABELS, type FuelCode } from "@/domain/stations";
import { formatPrice } from "@/lib/format";

import { HEAT_GRADIENT_CSS } from "./price-heatmap-layer";

/** Aviso de estado de la leyenda; `null` si hay estaciones que representar. */
function legendStatus({
  loading,
  loadingStatus,
  hasScale,
  shownStations,
  fuel,
}: {
  loading: boolean;
  loadingStatus: string;
  hasScale: boolean;
  shownStations: number;
  fuel: FuelCode;
}): string | null {
  if (loading) {
    return `Se calculará con todas las provincias cargadas. ${loadingStatus}`;
  }
  if (!hasScale) return `No hay estaciones con precio de ${FUEL_LABELS[fuel]}.`;
  if (shownStations === 0) {
    return `Ninguna estación con precio de ${FUEL_LABELS[fuel]} cumple los filtros.`;
  }
  return null;
}

export function PriceHeatmapLegend({
  heatmap,
  fuel,
  loading,
  loadingStatus,
  failedProvinces,
  stale,
  filtersActive,
}: {
  heatmap: PriceHeatmap | null;
  fuel: FuelCode;
  loading: boolean;
  loadingStatus: string;
  failedProvinces: number;
  stale: boolean;
  filtersActive: boolean;
}) {
  // La escala siempre se ve; su explicación se despliega cuando se necesita.
  const [expanded, setExpanded] = useState(false);
  const scale = !loading ? (heatmap?.scale ?? null) : null;
  const flat = scale !== null && scale.high - scale.low < 1e-9;
  const unit = priceUnit(fuel);
  const shownStations = heatmap?.stationCount ?? 0;
  const status = legendStatus({
    loading,
    loadingStatus,
    hasScale: scale !== null,
    shownStations,
    fuel,
  });

  return (
    <section
      aria-labelledby="heat-legend-title"
      className="heat-legend glass text-ink-2 w-[21rem] max-w-full px-4 py-2.5 text-[0.875rem] leading-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="heat-legend-title"
          className="text-ink optical min-w-0 text-[0.875rem] leading-snug font-extrabold"
        >
          Precio relativo · {FUEL_LABELS[fuel]}
        </h2>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="heat-legend-details"
          onClick={() => setExpanded((current) => !current)}
          className="link-action press -my-2 -mr-1 shrink-0 px-1 text-[0.8125rem]"
        >
          {expanded ? "Reducir" : "Ampliar"}
          <span className="sr-only"> la leyenda</span>
        </button>
      </div>

      {status ? (
        <p className="leading-[1.125rem]" role="status">
          {status}
        </p>
      ) : null}

      {scale ? (
        <>
          <div
            aria-hidden="true"
            className="mt-1 h-2 rounded-full"
            style={{ background: HEAT_GRADIENT_CSS }}
          />
          {flat ? (
            <p className="mt-0.5 leading-[1.125rem] tabular-nums">
              {formatPrice(scale.low)}
              <PriceUnitLabel unit={unit} /> en todo el mapa
            </p>
          ) : (
            <p className="mt-1.5 flex justify-between gap-2 leading-[1.125rem] tabular-nums">
              <span>
                <span className="sr-only">
                  Verde, más barato: hasta el percentil 5 nacional,{" "}
                </span>
                <span aria-hidden="true">
                  <span className="text-[0.6875rem] font-bold">P5</span> ≤{" "}
                </span>
                {formatPrice(scale.low)}
                <PriceUnitLabel unit={unit} visuallyHidden />
                <span className="text-ink font-bold"> barato</span>
              </span>
              <span>
                <span className="sr-only">
                  Rojo, más caro: desde el percentil 95 nacional,{" "}
                </span>
                <span className="text-ink font-bold">caro </span>
                <span aria-hidden="true">≥ </span>
                {formatPrice(scale.high)}
                <PriceUnitLabel unit={unit} visuallyHidden />
                <span aria-hidden="true" className="text-[0.6875rem] font-bold">
                  {" "}
                  P95
                </span>
              </span>
            </p>
          )}
        </>
      ) : null}

      <div id="heat-legend-details" hidden={!expanded}>
        {scale && heatmap ? (
          <>
            <p className="mt-1.5 leading-[1.125rem] tabular-nums">
              <span className="text-ink font-bold">Escala nacional</span> de{" "}
              {FUEL_LABELS[fuel]} (percentiles 5 y 95 de toda España):{" "}
              <span className="text-ink">{formatPrice(scale.low)}</span> –{" "}
              <span className="text-ink">
                {formatPrice(scale.high)}
                <PriceUnitLabel unit={unit} />
              </span>
              . No cambia al filtrar ni al mover el mapa: un mismo precio
              conserva su color. Lo que queda fuera satura en verde o rojo, como
              Canarias, Ceuta o Melilla.
            </p>
            {heatmap.cheapest !== null && heatmap.priciest !== null ? (
              <p className="mt-1 leading-[1.125rem] tabular-nums">
                <span className="text-ink font-bold">Precios reales</span> de
                las estaciones mostradas: mínimo{" "}
                <span className="text-ink">
                  {formatPrice(heatmap.cheapest)}
                </span>
                {" · "}máximo{" "}
                <span className="text-ink">
                  {formatPrice(heatmap.priciest)}
                  <PriceUnitLabel unit={unit} />
                </span>
                .
              </p>
            ) : null}
            <p className="mt-1 leading-[1.125rem]">
              {filtersActive
                ? `Representa las ${shownStations.toLocaleString("es-ES")} estaciones que cumplen tus filtros.`
                : `Representa las ${shownStations.toLocaleString("es-ES")} estaciones con precio de ${FUEL_LABELS[fuel]}.`}
            </p>
          </>
        ) : null}

        {stale ? (
          <p className="mt-1.5 rounded-md bg-amber-50 px-2 pt-0.5 leading-5 text-amber-950">
            Datos de hace más de 48 horas.
          </p>
        ) : null}
        {failedProvinces > 0 ? (
          <p className="mt-1.5 rounded-md bg-amber-50 px-2 pt-0.5 leading-5 text-amber-950">
            Faltan {failedProvinces} provincias en el cálculo.
          </p>
        ) : null}

        {scale ? (
          <details className="mt-1.5">
            <summary className="link-action min-h-9 font-extrabold">
              Cómo se calcula
            </summary>
            <p className="mt-1.5 leading-[1.125rem]">
              Cada punto del mapa muestra la media de los precios cercanos,
              ponderada por distancia con un radio de influencia de unos{" "}
              {HEATMAP_SIGMA_KM} km (hasta {HEATMAP_SIGMA_KM * 3} km). Al ser
              una media, tener más estaciones no hace que una zona parezca más
              cara: solo la hace más opaca. Donde no hay estaciones cerca, el
              mapa queda transparente. Es una estimación visual: consulta la
              lista o la ficha de cada estación para ver precios reales.
            </p>
          </details>
        ) : null}
      </div>
    </section>
  );
}
