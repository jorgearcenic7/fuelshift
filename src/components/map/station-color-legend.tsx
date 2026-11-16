import { PriceUnitLabel } from "@/components/price-unit";
import { priceUnit } from "@/domain/fuel-units";
import type { PriceScale } from "@/domain/price-heatmap";
import { FUEL_LABELS, type FuelCode } from "@/domain/stations";
import { formatPrice } from "@/lib/format";

import { HEAT_GRADIENT_CSS } from "./price-heatmap-layer";

/**
 * Leyenda del color de cada estación en la vista Estaciones: la misma rampa y
 * la misma escala nacional (P5–P95) que el mapa de calor.
 */
export function StationColorLegend({
  scale,
  fuel,
  expanded,
  onExpandedChange,
}: {
  scale: PriceScale;
  fuel: FuelCode;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const unit = priceUnit(fuel);
  return (
    <section
      aria-labelledby="station-color-title"
      className="station-color-legend glass text-ink-2 w-[20rem] max-w-full px-4 pt-3 pb-3 text-[0.8125rem] leading-5"
    >
      <details className="station-legend-info" open={expanded}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            onExpandedChange(!expanded);
          }}
        >
          <h2
            id="station-color-title"
            className="text-ink optical text-[0.8125rem] font-extrabold"
          >
            Color de cada estación · {FUEL_LABELS[fuel]}
          </h2>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <p className="legend-note text-muted mb-2">
          Misma escala nacional que el mapa de calor. Los grupos no llevan
          color: reúnen estaciones con precios distintos.
        </p>
      </details>
      <div
        aria-hidden="true"
        className="mt-1.5 h-2 rounded-full"
        style={{ background: HEAT_GRADIENT_CSS }}
      />
      <p className="num mt-1.5 flex justify-between gap-2">
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
    </section>
  );
}
