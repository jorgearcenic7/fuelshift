"use client";

import { useState, useSyncExternalStore } from "react";

import type { StatisticsPageData } from "@/data/statistics-page";
import type { StatisticsFuel } from "@/data/statistics-snapshot";
import {
  MIN_PROVINCE_SAMPLE,
  type ProvinceStatistics,
} from "@/domain/fuel-statistics";
import { isStale } from "@/domain/freshness";
import { FUEL_LABELS, PRIMARY_FUELS } from "@/domain/stations";
import {
  formatCount,
  formatPrice,
  formatRetrievedAt,
  formatSignedPercent,
  formatSignedPrice,
} from "@/lib/format";

import { PriceHistoryPanel } from "./price-history-panel";
import { ProvinceRanking } from "./province-ranking";

const card = "border-line bg-surface rounded-2xl border p-5 shadow-sm sm:p-6";
const subscribeToNothing = () => () => {};

function Indicator({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-line bg-surface rounded-2xl border p-4 shadow-sm">
      <dt className="text-muted text-xs font-medium">{label}</dt>
      <dd className="text-ink mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </dd>
      <dd className="text-muted mt-0.5 text-xs leading-5">{detail}</dd>
    </div>
  );
}

function Highlight({
  title,
  province,
  tone,
}: {
  title: string;
  province: ProvinceStatistics;
  tone: "cheaper" | "pricier";
}) {
  const difference = province.differenceFromNational!;
  return (
    <div
      className={`rounded-xl border p-4 ${tone === "cheaper" ? "bg-positive-soft border-emerald-200" : "border-rose-200 bg-rose-50"}`}
    >
      <p className="text-muted text-xs font-medium">{title}</p>
      <p className="text-ink mt-1 text-lg font-semibold">{province.name}</p>
      <p className="text-ink text-2xl font-bold tabular-nums">
        {formatPrice(province.summary!.mean)}
      </p>
      <p className="text-muted mt-1 text-xs leading-5 tabular-nums">
        {formatSignedPrice(difference.absolute)}
        {difference.percent !== null
          ? ` (${formatSignedPercent(difference.percent)})`
          : ""}{" "}
        frente a la media nacional · {formatCount(province.summary!.count)}{" "}
        estaciones
      </p>
    </div>
  );
}

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
    <main
      id="contenido"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <p className="text-accent text-xs font-semibold tracking-widest uppercase">
        Estadísticas de carburantes
      </p>
      <h1 className="text-ink mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        Precios en España
      </h1>

      {data.status === "empty" ? (
        <p className={`${card} mt-6 text-sm leading-6`} role="status">
          No hay datos oficiales preparados para calcular estadísticas.
        </p>
      ) : data.status === "error" ? (
        <p
          className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-900"
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
  const provinces = snapshot.fuels.gasoline_95_e5.provinces.map(
    ({ id, name }) => ({ id, name }),
  );

  return (
    <>
      <p className="text-muted mt-3 max-w-3xl text-sm leading-6">
        Calculadas por FuelShift con los precios oficiales publicados por
        MITECO: no son estadísticas oficiales. Datos comunicados el{" "}
        {snapshot.reported_at.raw} (zona horaria no indicada) y descargados el{" "}
        {formatRetrievedAt(snapshot.retrieved_at)}.
      </p>
      {stale ? (
        <p
          className="mt-3 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
          role="status"
        >
          Estos datos se descargaron hace más de 48 horas y pueden no reflejar
          los precios actuales.
        </p>
      ) : null}

      <fieldset className="mt-6 max-w-xl">
        <legend className="text-muted mb-1.5 text-xs font-medium">
          Combustible
        </legend>
        <div className="bg-surface ring-line grid grid-cols-3 gap-1 rounded-xl p-1 ring-1">
          {PRIMARY_FUELS.map((code) => (
            <label
              key={code}
              className="text-muted hover:text-ink has-checked:text-accent-strong has-checked:bg-accent-soft flex min-h-10 items-center justify-center rounded-lg px-1.5 text-center text-[0.8125rem] leading-tight font-medium transition-colors has-checked:font-semibold has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-[#f4a261]"
            >
              <input
                type="radio"
                name="statistics-fuel"
                value={code}
                checked={fuel === code}
                onChange={() => setFuel(code)}
                className="sr-only"
              />
              {FUEL_LABELS[code]}
            </label>
          ))}
        </div>
      </fieldset>

      {national ? (
        <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicator
            label="Precio medio nacional"
            value={formatPrice(national.mean)}
            detail="Media de todas las estaciones · sin unidad acreditada"
          />
          <Indicator
            label="Estaciones incluidas"
            value={formatCount(national.count)}
            detail={`${formatCount(statistics.excludedStations)} sin precio de este combustible`}
          />
          <Indicator
            label="Precio mínimo"
            value={formatPrice(national.min)}
            detail="Estación más barata de España"
          />
          <Indicator
            label="Precio máximo"
            value={formatPrice(national.max)}
            detail="Estación más cara de España"
          />
        </dl>
      ) : (
        <p className={`${card} mt-6 text-sm`} role="status">
          Ninguna estación comunica precio de {FUEL_LABELS[fuel]}.
        </p>
      )}

      {statistics.cheapest && statistics.priciest && statistics.spread ? (
        <section aria-labelledby="extremes-title" className={`${card} mt-6`}>
          <h2 id="extremes-title" className="text-ink text-lg font-semibold">
            Provincias más barata y más cara
          </h2>
          <p className="text-muted mt-1 text-sm leading-6 tabular-nums">
            La diferencia entre ambas es de{" "}
            <strong className="text-ink">
              {formatPrice(statistics.spread.absolute)}
            </strong>
            {statistics.spread.percent !== null
              ? ` (${formatSignedPercent(statistics.spread.percent)} sobre la más barata)`
              : ""}
            .
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Highlight
              title="Más barata"
              province={statistics.cheapest}
              tone="cheaper"
            />
            <Highlight
              title="Más cara"
              province={statistics.priciest}
              tone="pricier"
            />
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <ProvinceRanking key={fuel} statistics={statistics} />
        <div className="space-y-6">
          <PriceHistoryPanel
            history={data.history}
            historyError={data.historyError}
            fuel={fuel}
            provinces={provinces}
          />
          <section aria-labelledby="method-title" className={card}>
            <h2 id="method-title" className="text-ink text-lg font-semibold">
              Cómo se calcula
            </h2>
            <ul className="text-muted mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6">
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
                marcan como muestra reducida y no compiten por los puestos de
                más barata o más cara. Si no hay ninguna, no se muestra valor.
              </li>
              <li>
                Los precios se muestran con los tres decimales que publica
                MITECO; la fuente no acredita la unidad.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
