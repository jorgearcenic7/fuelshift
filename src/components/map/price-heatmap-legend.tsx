import { useState } from "react";

import { PriceUnitLabel } from "@/components/price-unit";
import { priceUnit } from "@/domain/fuel-units";
import { HEATMAP_SIGMA_KM, type PriceHeatmap } from "@/domain/price-heatmap";
import { FUEL_LABELS, type FuelCode } from "@/domain/stations";
import { formatPrice } from "@/lib/format";

import { HEAT_GRADIENT_CSS } from "./price-heatmap-layer";

// A partir de `md` hay espacio para mostrar la leyenda completa sobre el mapa.
const EXPANDED_BY_DEFAULT_QUERY = "(min-width: 48rem)";

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
  // Solo se monta en el navegador, tras elegir el mapa de calor, así que el
  // estado inicial no puede discrepar del HTML estático.
  const [expanded, setExpanded] = useState(
    () => window.matchMedia(EXPANDED_BY_DEFAULT_QUERY).matches,
  );
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
      className="border-line text-muted w-[18rem] max-w-full rounded-xl border bg-white/95 px-3 py-2 text-xs leading-5 shadow-[0_12px_30px_-14px_rgb(15_29_46/45%)] backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="heat-legend-title"
          className="text-ink min-w-0 truncate text-[0.8125rem] font-semibold"
        >
          Precio relativo · {FUEL_LABELS[fuel]}
        </h2>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="heat-legend-details"
          onClick={() => setExpanded((current) => !current)}
          className="text-accent hover:text-accent-strong hover:bg-accent-soft -mr-1 shrink-0 rounded-md px-1.5 font-semibold"
        >
          {expanded ? "Reducir" : "Ampliar"}
          <span className="sr-only"> la leyenda</span>
        </button>
      </div>

      {status ? (
        <p className="leading-4" role="status">
          {status}
        </p>
      ) : null}

      {scale ? (
        <>
          <div
            aria-hidden="true"
            className="mt-1 h-2.5 rounded-full ring-1 ring-black/10"
            style={{ background: HEAT_GRADIENT_CSS }}
          />
          {flat ? (
            <p className="mt-0.5 leading-4 tabular-nums">
              {formatPrice(scale.low)}
              <PriceUnitLabel unit={unit} /> en todo el mapa
            </p>
          ) : (
            <p className="mt-0.5 flex justify-between gap-2 leading-4 tabular-nums">
              <span>
                <span className="sr-only">
                  Verde, más barato: hasta el percentil 5 nacional,{" "}
                </span>
                <span aria-hidden="true">
                  <span className="text-[0.625rem] font-semibold">P5</span>{" "}
                  ≤{" "}
                </span>
                {formatPrice(scale.low)}
                <PriceUnitLabel unit={unit} visuallyHidden />
                <span className="text-ink font-medium"> barato</span>
              </span>
              <span>
                <span className="sr-only">
                  Rojo, más caro: desde el percentil 95 nacional,{" "}
                </span>
                <span className="text-ink font-medium">caro </span>
                <span aria-hidden="true">≥ </span>
                {formatPrice(scale.high)}
                <PriceUnitLabel unit={unit} visuallyHidden />
                <span
                  aria-hidden="true"
                  className="text-[0.625rem] font-semibold"
                >
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
            <p className="mt-1.5 leading-4 tabular-nums">
              <span className="text-ink font-medium">Escala nacional</span> de{" "}
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
              <p className="mt-1 leading-4 tabular-nums">
                <span className="text-ink font-medium">Precios reales</span> de
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
            <p className="mt-1 leading-4">
              {filtersActive
                ? `Representa las ${shownStations.toLocaleString("es-ES")} estaciones que cumplen tus filtros.`
                : `Representa las ${shownStations.toLocaleString("es-ES")} estaciones con precio de ${FUEL_LABELS[fuel]}.`}
            </p>
          </>
        ) : null}

        {stale ? (
          <p className="mt-1.5 rounded-md bg-amber-50 px-2 leading-5 text-amber-950">
            Datos de hace más de 48 horas.
          </p>
        ) : null}
        {failedProvinces > 0 ? (
          <p className="mt-1.5 rounded-md bg-amber-50 px-2 leading-5 text-amber-950">
            Faltan {failedProvinces} provincias en el cálculo.
          </p>
        ) : null}

        {scale ? (
          <details className="mt-1.5">
            <summary className="text-accent hover:text-accent-strong cursor-pointer font-semibold">
              Cómo se calcula
            </summary>
            <p className="mt-1.5 leading-4">
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
