"use client";

// Panel de estadísticas: medias, mínimos y máximos por combustible, mapa y
// ranking de provincias e históricos. Los datos llegan ya calculados desde el
// build; aquí solo se elige combustible, se compone el titular y se avisa si
// los datos se han quedado viejos.

import { useState, useSyncExternalStore } from "react";

import { PriceUnitLabel } from "@/components/price-unit";
import type { StatisticsPageData } from "@/data/statistics-page";
import type { StatisticsFuel } from "@/data/statistics-snapshot";
import {
  describeFillHeadline,
  FILL_LITRES,
  formatEuros,
  madridDate,
  mitecoDate,
} from "@/domain/fill-phrases";
import {
  MIN_PROVINCE_SAMPLE,
  type ProvinceStatistics,
} from "@/domain/fuel-statistics";
import { isStale } from "@/domain/freshness";
import { priceUnit, type PriceUnit } from "@/domain/fuel-units";
import { FUEL_LABELS, PRIMARY_FUELS } from "@/domain/stations";
import {
  formatCount,
  formatPrice,
  formatRetrievedAt,
  formatSignedPercent,
  formatSignedPrice,
} from "@/lib/format";

import { MonthlyHistoryPanel } from "./monthly-history-panel";
import { PriceHistoryPanel } from "./price-history-panel";
import { PRICIER_TEXT } from "./province-colors";
import { ProvinceMap } from "./province-map";
import { ProvinceRanking } from "./province-ranking";

const subscribeToNothing = () => () => {};
const sectionGap = "mt-12 md:mt-14";
const sectionTitle =
  "text-ink text-[1.5rem] leading-tight font-extrabold tracking-[-0.025em] md:text-[1.875rem]";
// Misma precisión y depósito de referencia que el titular existente.
const fillAmount = (price: number) =>
  formatEuros((Math.round(price * 1000) / 1000) * FILL_LITRES);

function Indicator({
  label,
  value,
  detail,
  unit,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  /** Solo en los indicadores que son precios. */
  unit?: PriceUnit;
  tone?: "cheaper" | "pricier";
}) {
  return (
    <div className="kpi py-1">
      <dt className="text-muted text-[0.8125rem] font-bold">{label}</dt>
      <dd
        className={`num mt-1.5 text-[1.625rem] leading-none font-extrabold tracking-[-0.03em] md:text-[1.75rem] ${tone === "cheaper" ? "text-positive" : tone === "pricier" ? "text-dear" : "text-ink"}`}
      >
        {value}
        {unit ? (
          <PriceUnitLabel
            unit={unit}
            className="text-muted ml-0.5 text-[0.8125rem] font-bold tracking-normal"
          />
        ) : null}
      </dd>
      <dd className="text-muted mt-1 text-[0.8125rem] leading-snug">
        {detail}
      </dd>
    </div>
  );
}

function Extreme({
  title,
  province,
  tone,
  unit,
}: {
  title: string;
  province: ProvinceStatistics;
  tone: "cheaper" | "pricier";
  unit: PriceUnit;
}) {
  const difference = province.differenceFromNational!;
  return (
    <div>
      <h3
        className={`text-[0.875rem] font-extrabold ${tone === "cheaper" ? "text-positive" : ""}`}
        style={tone === "pricier" ? { color: PRICIER_TEXT } : undefined}
      >
        {title}
      </h3>
      <p className="text-ink mt-1 text-[1.5rem] leading-tight font-extrabold tracking-[-0.02em] md:text-[1.75rem]">
        {province.name}
      </p>
      <p
        className={`num mt-2 text-[2.75rem] leading-none font-extrabold tracking-[-0.045em] md:text-[3.25rem] ${tone === "cheaper" ? "text-positive" : "text-dear"}`}
      >
        {formatPrice(province.summary!.mean)}
        <PriceUnitLabel
          unit={unit}
          className="text-muted ml-1 text-[1rem] font-bold tracking-normal"
        />
      </p>
      <p className="num text-ink-2 mt-2.5 text-[0.875rem]">
        {formatSignedPrice(difference.absolute)}
        <PriceUnitLabel unit={unit} />
        {difference.percent !== null
          ? ` (${formatSignedPercent(difference.percent)})`
          : ""}{" "}
        frente a la media nacional · {formatCount(province.summary!.count)}{" "}
        estaciones
      </p>
    </div>
  );
}

// Tres estados posibles: sin datos, datos inválidos o listo para mostrar.
export function StatisticsDashboard({ data }: { data: StatisticsPageData }) {
  const [fuel, setFuel] = useState<StatisticsFuel>("gasoline_95_e5");
  // En el HTML estático se asume vigente; el navegador compara con la hora
  // real de la visita.
  const stale = useSyncExternalStore(
    subscribeToNothing,
    () =>
      data.status === "ready" ? isStale(data.snapshot.retrieved_at) : false,
    () => false,
  );

  return (
    <main id="contenido" className="statistics-page page-shell">
      <div className="page-heading">
        <h1>Precios en España</h1>
        <p className="text-muted text-[0.875rem]">
          Estadísticas de carburantes
        </p>
      </div>

      {data.status === "empty" ? (
        <p className="text-ink-2 mt-6 text-[0.9375rem] leading-6" role="status">
          No hay datos oficiales preparados para calcular estadísticas.
        </p>
      ) : data.status === "error" ? (
        <p
          className="mt-6 rounded-xl bg-rose-50 px-4 pt-3.5 pb-3 text-[0.9375rem] leading-6 text-rose-900"
          role="alert"
        >
          Los datos publicados no superan la validación y no se muestran
          estadísticas: {data.message}
        </p>
      ) : (
        <ReadyDashboard
          data={data}
          fuel={fuel}
          setFuel={setFuel}
          stale={stale}
        />
      )}
      {data.status !== "ready" ? (
        <div className={sectionGap}>
          <MonthlyHistoryPanel />
        </div>
      ) : null}
    </main>
  );
}

function ReadyDashboard({
  data,
  fuel,
  setFuel,
  stale,
}: {
  data: Extract<StatisticsPageData, { status: "ready" }>;
  fuel: StatisticsFuel;
  setFuel: (fuel: StatisticsFuel) => void;
  stale: boolean;
}) {
  const { snapshot } = data;
  const statistics = snapshot.fuels[fuel];
  const { national } = statistics;
  const unit = priceUnit(fuel);
  const provinces = snapshot.fuels.gasoline_95_e5.provinces.map(
    ({ id, name }) => ({ id, name }),
  );
  // Provincia resaltada a la vez en el mapa y en el ranking.
  const [hotProvince, setHotProvince] = useState<string | null>(null);
  // «Hoy» solo se puede afirmar en el navegador, con la fecha de la visita.
  const today = useSyncExternalStore(
    subscribeToNothing,
    () => madridDate(new Date()),
    () => null,
  );
  const headline = describeFillHeadline({
    fuelLabel: FUEL_LABELS[fuel],
    mean: national?.mean ?? null,
    min: national?.min ?? null,
    max: national?.max ?? null,
    dataDate: mitecoDate(snapshot.reported_at.raw),
    today,
  });

  return (
    <>
      <div className="stats-overview">
        <div className="stats-story min-w-0">
          <fieldset className="min-w-0">
            <legend className="sr-only">Combustible</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {PRIMARY_FUELS.map((code) => (
                <label key={code} className="tab-option">
                  <input
                    type="radio"
                    name="statistics-fuel"
                    value={code}
                    checked={fuel === code}
                    onChange={() => setFuel(code)}
                    className="sr-only"
                  />
                  <span className="optical">{FUEL_LABELS[code]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {headline ? (
            <>
              <p className="sr-only" aria-live="polite">
                {headline}
              </p>
              {national ? (
                <div className="fill-headline" aria-hidden="true">
                  <h2>
                    Llenar {FILL_LITRES} litros de {FUEL_LABELS[fuel]}
                  </h2>
                  <p className="fill-amount num">{fillAmount(national.mean)}</p>
                  <p className="fill-caption">
                    de media · datos del{" "}
                    {snapshot.reported_at.raw.split(" ")[0]}
                  </p>
                  <div className="fill-range num">
                    <span>
                      Desde <strong>{fillAmount(national.min)}</strong>
                    </span>
                    <span>
                      Hasta <strong>{fillAmount(national.max)}</strong>
                    </span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="stats-map min-w-0">
          <ProvinceMap
            statistics={statistics}
            hotProvince={hotProvince}
            onHotProvince={setHotProvince}
          />
        </div>
      </div>
      <p className="stats-provenance text-muted text-[0.875rem] leading-relaxed">
        Calculadas por FuelShift con los precios oficiales publicados por
        MITECO: no son estadísticas oficiales. Datos comunicados el{" "}
        {snapshot.reported_at.raw} (zona horaria no indicada) y descargados el{" "}
        {formatRetrievedAt(snapshot.retrieved_at)}.
      </p>
      {stale ? (
        <p
          className="mt-4 max-w-[44ch] rounded-xl bg-amber-50 px-4 pt-3 pb-2.5 text-[0.875rem] leading-6 text-amber-950"
          role="status"
        >
          Estos datos se descargaron hace más de 48 horas y pueden no reflejar
          los precios actuales.
        </p>
      ) : null}

      {national ? (
        <dl className="stats-indicators grid grid-cols-2 gap-y-6 sm:grid-cols-4">
          <Indicator
            label="Precio medio nacional"
            value={formatPrice(national.mean)}
            unit={unit}
            detail="Media de todas las estaciones"
          />
          <Indicator
            label="Estaciones incluidas"
            value={formatCount(national.count)}
            detail={`${formatCount(statistics.excludedStations)} sin precio de este combustible`}
          />
          <Indicator
            label="Precio mínimo"
            value={formatPrice(national.min)}
            unit={unit}
            detail="Estación más barata de España"
            tone="cheaper"
          />
          <Indicator
            label="Precio máximo"
            value={formatPrice(national.max)}
            unit={unit}
            detail="Estación más cara de España"
            tone="pricier"
          />
        </dl>
      ) : (
        <p className="text-ink-2 mt-10 text-[0.9375rem]" role="status">
          Ninguna estación comunica precio de {FUEL_LABELS[fuel]}.
        </p>
      )}

      <div className="stats-histories">
        <PriceHistoryPanel fuel={fuel} provinces={provinces} />
        <MonthlyHistoryPanel />
        <details
          open
          className="how-details history-method pt-5 shadow-[inset_0_1px_0_var(--line-soft)]"
        >
          <summary className="text-ink flex min-h-11 items-center gap-2.5 text-[1rem] font-extrabold">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="how-chevron size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
            <h2 id="method-title" className="optical">
              Cómo se calcula
            </h2>
          </summary>
          <ul className="text-ink-2 mt-3 max-w-[75ch] list-disc space-y-1.5 pl-5 text-[0.9375rem] leading-relaxed">
            <li>
              Las medias se calculan con cada estación que comunica un precio
              válido del combustible elegido. La media nacional no es la media
              de las medias provinciales.
            </li>
            <li>
              Se excluyen las estaciones sin precio de ese combustible; no se
              cuentan como cero.
            </li>
            <li>
              Las provincias con menos de {MIN_PROVINCE_SAMPLE} estaciones se
              marcan como muestra reducida y no compiten por los puestos de más
              barata o más cara. Si no hay ninguna, no se muestra valor.
            </li>
            <li>
              Los precios están en euros por litro (€/L), con los tres decimales
              que publica MITECO: son los precios en surtidor, sin descuentos,
              que cada estación comunica al Ministerio.
            </li>
          </ul>
        </details>
      </div>

      {statistics.cheapest && statistics.priciest && statistics.spread ? (
        <section aria-labelledby="extremes-title" className={sectionGap}>
          <h2 id="extremes-title" className={sectionTitle}>
            Provincias más barata y más cara
          </h2>
          <p className="num text-muted mt-2 text-[0.9375rem]">
            La diferencia entre ambas es de{" "}
            <strong className="text-ink font-extrabold">
              {formatPrice(statistics.spread.absolute)}
              <PriceUnitLabel unit={unit} />
            </strong>
            {statistics.spread.percent !== null
              ? ` (${formatSignedPercent(statistics.spread.percent)} sobre la más barata)`
              : ""}
            .
          </p>
          <div className="mt-7 grid gap-10 md:grid-cols-2 md:gap-12">
            <Extreme
              title="Más barata"
              province={statistics.cheapest}
              tone="cheaper"
              unit={unit}
            />
            <Extreme
              title="Más cara"
              province={statistics.priciest}
              tone="pricier"
              unit={unit}
            />
          </div>
        </section>
      ) : null}

      <div className={sectionGap}>
        <ProvinceRanking
          key={fuel}
          statistics={statistics}
          hotProvince={hotProvince}
          onHotProvince={setHotProvince}
        />
      </div>
    </>
  );
}
