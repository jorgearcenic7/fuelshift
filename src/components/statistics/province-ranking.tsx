import { useState, type PointerEvent } from "react";

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

import { CHEAPER, PRICIER, PRICIER_TEXT } from "./province-colors";

const VISIBLE_ROWS = 10;
const SORTS: readonly [ProvinceSort, string][] = [
  ["price-asc", "Más baratas primero"],
  ["price-desc", "Más caras primero"],
  ["name", "Por nombre"],
  ["stations", "Por número de estaciones"],
];

/** Solo el ratón resalta: en táctil, el estado quedaría «pegado». */
const mouseOnly = (handler: () => void) => (event: PointerEvent) => {
  if (event.pointerType === "mouse") handler();
};

export function ProvinceRanking({
  statistics,
  hotProvince = null,
  onHotProvince,
}: {
  statistics: FuelStatistics;
  /** Provincia resaltada desde el mapa (o desde esta lista). */
  hotProvince?: string | null;
  onHotProvince?: (id: string | null) => void;
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
    <section aria-labelledby="ranking-title">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-[62ch]">
          <h2
            id="ranking-title"
            className="text-ink text-[1.5rem] leading-tight font-extrabold tracking-[-0.025em] md:text-[1.875rem]"
          >
            Precio medio por provincia
          </h2>
          <p className="text-muted mt-2 text-[0.9375rem]">
            Precio medio en {unit} y diferencia frente a la media nacional.
          </p>
          <p className="text-muted mt-1 text-[0.8125rem] leading-5">
            Canarias, Ceuta y Melilla tienen una fiscalidad propia que puede
            influir en sus precios y en su posición.
          </p>
        </div>
        <fieldset className="min-w-0">
          <legend className="text-muted mb-1.5 text-[0.75rem] font-bold">
            Ordenar
          </legend>
          <div className="flex flex-wrap gap-1">
            {SORTS.map(([value, label]) => (
              <label key={value} className="chip-option">
                <input
                  type="radio"
                  name="ranking-sort"
                  value={value}
                  checked={sort === value}
                  onChange={() => setSort(value)}
                  className="sr-only"
                />
                <span className="optical">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div
        aria-hidden="true"
        className="mt-6 flex justify-between text-[0.75rem] font-bold"
      >
        <span className="text-positive">◀ Más barata que la media</span>
        <span style={{ color: PRICIER_TEXT }}>Más cara que la media ▶</span>
      </div>
      <ol
        className="mt-1 grid gap-x-14 lg:grid-flow-col lg:grid-cols-2"
        style={{
          gridTemplateRows: `repeat(${Math.ceil(visible.length / 2)}, auto)`,
        }}
        aria-label="Provincias"
      >
        {visible.map((province) => {
          const difference = province.differenceFromNational;
          const share = difference
            ? (Math.abs(difference.absolute) / largestGap) * 50
            : 0;
          const cheaper = (difference?.absolute ?? 0) < 0;
          return (
            <li
              key={province.id}
              data-hot={hotProvince === province.id}
              onPointerEnter={mouseOnly(() => onHotProvince?.(province.id))}
              onPointerLeave={mouseOnly(() => onHotProvince?.(null))}
              className="province-row grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[0.625rem] px-2 py-2.5 shadow-[inset_0_-1px_0_var(--line-soft)] md:grid-cols-[1.75rem_minmax(0,1fr)_5.5rem_7.25rem]"
            >
              <span className="num text-muted text-[0.8125rem]">
                {province.summary ? (
                  <>
                    <span className="sr-only">Puesto </span>
                    {priceRank.get(province.id)}
                  </>
                ) : (
                  "–"
                )}
              </span>
              <span className="min-w-0">
                <span className="text-ink optical block text-[0.9375rem] leading-snug font-bold [overflow-wrap:anywhere]">
                  {province.name}
                </span>
                <span className="num text-muted block text-[0.75rem]">
                  {province.summary
                    ? `${formatCount(province.summary.count)} estaciones`
                    : "Ninguna estación comunica este combustible"}
                  {province.summary && !province.sufficient ? (
                    <span className="ml-1.5 inline-block rounded-md bg-[#fdf3d7] px-1.5 pt-px text-[0.6875rem] font-extrabold text-[#7a5200]">
                      Muestra reducida (menos de {MIN_PROVINCE_SAMPLE})
                    </span>
                  ) : null}
                </span>
              </span>
              {province.summary ? (
                <>
                  <span
                    aria-hidden="true"
                    className="relative col-span-3 row-start-2 mt-1.5 block h-2 md:col-span-1 md:col-start-3 md:row-start-1 md:mt-0"
                  >
                    <span className="bg-line absolute inset-y-0 left-1/2 w-px" />
                    <span
                      className="absolute inset-y-0.5 rounded-full"
                      style={{
                        backgroundColor: cheaper ? CHEAPER : PRICIER,
                        width: `${Math.max(share, 0.6)}%`,
                        [cheaper ? "right" : "left"]: "50%",
                      }}
                    />
                  </span>
                  <span className="num text-right md:col-start-4 md:row-start-1">
                    <span className="text-ink block text-[1rem] font-extrabold">
                      {formatPrice(province.summary.mean)}
                      <PriceUnitLabel unit={unit} visuallyHidden />
                    </span>
                    <span className="text-muted block text-[0.75rem]">
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
                  </span>
                </>
              ) : (
                <span className="text-muted text-[0.75rem]">Sin datos</span>
              )}
            </li>
          );
        })}
      </ol>
      {sorted.length > VISIBLE_ROWS ? (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            className="btn btn-soft"
            aria-expanded={showAll}
            onClick={() => setShowAll((current) => !current)}
          >
            <span className="optical">
              {showAll
                ? `Mostrar solo ${VISIBLE_ROWS}`
                : `Ver las ${sorted.length} provincias`}
            </span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
