"use client";

import { useState } from "react";

import { PriceUnitLabel } from "@/components/price-unit";
import {
  MIN_PROVINCE_SAMPLE,
  sortProvinces,
  type FuelStatistics,
  type ProvinceSort,
} from "@/domain/fuel-statistics";
import { priceUnit } from "@/domain/fuel-units";
import {
  formatCount,
  formatPrice,
  formatSignedPercent,
  formatSignedPrice,
} from "@/lib/format";

const VISIBLE_ROWS = 10;
const SORTS: readonly [ProvinceSort, string][] = [
  ["price-asc", "Más baratas primero"],
  ["price-desc", "Más caras primero"],
  ["name", "Por nombre"],
  ["stations", "Por número de estaciones"],
];
// Validados para daltonismo como pareja (ΔE 9,7); la dirección de la barra y
// el signo del valor también indican el sentido.
const CHEAPER = "#0f8a5f";
const PRICIER = "#d9442f";
// El texto necesita 4,5:1 sobre blanco; las barras, que son gráficos, 3:1.
const PRICIER_TEXT = "#c93d29";

export function ProvinceRanking({
  statistics,
}: {
  statistics: FuelStatistics;
}) {
  const [sort, setSort] = useState<ProvinceSort>("price-asc");
  const unit = priceUnit(statistics.fuel);
  const [showAll, setShowAll] = useState(false);
  const sorted = sortProvinces(statistics.provinces, sort);
  const visible = showAll ? sorted : sorted.slice(0, VISIBLE_ROWS);
  // Puesto por precio (de más barata a más cara), independiente del orden elegido.
  const priceRank = new Map(
    sortProvinces(statistics.provinces, "price-asc")
      .filter((province) => province.summary)
      .map((province, index) => [province.id, index + 1]),
  );
  const largestGap = Math.max(
    0.001,
    ...statistics.provinces.map((province) =>
      Math.abs(province.differenceFromNational?.absolute ?? 0),
    ),
  );

  return (
    <section
      aria-labelledby="ranking-title"
      className="border-line bg-surface rounded-2xl border p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="ranking-title" className="text-ink text-lg font-semibold">
            Precio medio por provincia
          </h2>
          <p className="text-muted mt-1 text-sm">
            Precio medio en {unit} y diferencia frente a la media nacional.
          </p>
          <p className="text-muted mt-1 text-xs leading-5">
            Canarias, Ceuta y Melilla tienen una fiscalidad propia que puede
            influir en sus precios y en su posición.
          </p>
        </div>
        <div className="w-full sm:w-60">
          <label
            htmlFor="ranking-sort"
            className="text-muted mb-1.5 block text-xs font-medium"
          >
            Ordenar
          </label>
          <select
            id="ranking-sort"
            className="control"
            value={sort}
            onChange={(event) => setSort(event.target.value as ProvinceSort)}
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="text-muted mt-4 flex justify-between text-xs font-medium"
      >
        <span className="text-positive">◀ Más barata que la media</span>
        <span style={{ color: PRICIER_TEXT }}>Más cara que la media ▶</span>
      </div>
      <ol className="divide-line mt-1 divide-y" aria-label="Provincias">
        {visible.map((province) => {
          const difference = province.differenceFromNational;
          const share = difference
            ? (Math.abs(difference.absolute) / largestGap) * 50
            : 0;
          const cheaper = (difference?.absolute ?? 0) < 0;
          return (
            <li key={province.id} className="py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-muted w-6 shrink-0 text-xs tabular-nums">
                  {province.summary ? (
                    <>
                      <span className="sr-only">Puesto </span>
                      {priceRank.get(province.id)}
                    </>
                  ) : (
                    "–"
                  )}
                </span>
                <span className="text-ink min-w-0 flex-1 truncate text-sm font-medium">
                  {province.name}
                </span>
                {province.summary ? (
                  <span className="text-ink text-sm font-semibold tabular-nums">
                    {formatPrice(province.summary.mean)}
                    <PriceUnitLabel unit={unit} visuallyHidden />
                  </span>
                ) : (
                  <span className="text-muted text-xs">Sin datos</span>
                )}
              </div>
              {province.summary ? (
                <div className="mt-1 flex items-center gap-2 pl-8">
                  <div
                    aria-hidden="true"
                    className="bg-canvas relative h-2 flex-1 overflow-hidden rounded-full"
                  >
                    <span className="bg-line absolute inset-y-0 left-1/2 w-px" />
                    <span
                      className="absolute inset-y-0 rounded-full"
                      style={{
                        backgroundColor: cheaper ? CHEAPER : PRICIER,
                        width: `${share}%`,
                        [cheaper ? "right" : "left"]: "50%",
                      }}
                    />
                  </div>
                  <span className="text-muted w-28 shrink-0 text-right text-xs tabular-nums">
                    {difference ? (
                      <>
                        {formatSignedPrice(difference.absolute)}
                        {difference.percent !== null
                          ? ` (${formatSignedPercent(difference.percent)})`
                          : ""}
                        <span className="sr-only">
                          {" "}
                          frente a la media nacional
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
              ) : null}
              <p className="text-muted mt-0.5 pl-8 text-xs">
                {province.summary
                  ? `${formatCount(province.summary.count)} estaciones`
                  : "Ninguna estación comunica este combustible"}
                {province.summary && !province.sufficient ? (
                  <span className="ml-1.5 rounded bg-amber-50 px-1 font-medium text-amber-900">
                    Muestra reducida (menos de {MIN_PROVINCE_SAMPLE})
                  </span>
                ) : null}
              </p>
            </li>
          );
        })}
      </ol>
      {sorted.length > VISIBLE_ROWS ? (
        <button
          type="button"
          className="text-accent hover:bg-accent-soft mt-3 w-full rounded-lg py-2 text-sm font-semibold"
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll
            ? `Mostrar solo ${VISIBLE_ROWS}`
            : `Ver las ${sorted.length} provincias`}
        </button>
      ) : null}
    </section>
  );
}
