"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ChipRadios } from "@/components/segmented";
import {
  fetchNationalHistory,
  fetchProvinceHistory,
  historyObservations,
  historyTimeline,
  type NationalHistory,
  type ProvinceHistory,
} from "@/data/price-history";
import {
  PRICE_UNIT_NAMES,
  priceUnit,
  type PriceUnit,
} from "@/domain/fuel-units";
import {
  buildHistorySeries,
  HISTORY_PERIODS,
  MIN_CHART_OBSERVATIONS,
  type HistoryPeriod,
  type HistorySeries,
} from "@/domain/price-history";
import { FUEL_LABELS, type FuelCode } from "@/domain/stations";
import {
  formatCount,
  formatLongDate,
  formatPrice,
  formatShortDate,
} from "@/lib/format";

// El ancho se mide en el navegador: el SVG se dibuja a escala 1:1 para que
// el texto mantenga su tamaño real en móvil y escritorio.
const CHART = {
  defaultWidth: 640,
  height: 320,
  left: 52,
  right: 10,
  top: 12,
  bottom: 26,
};

function HistoryChart({
  series,
  label,
  unit,
}: {
  series: HistorySeries;
  label: string;
  unit: PriceUnit;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(CHART.defaultWidth);
  // Día leído con el ratón, el dedo o las flechas. Sin selección se lee el
  // último día con dato.
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, Math.round(entry.contentRect.width))),
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const observed = series.points.filter((point) => point.mean !== null);
  const observedIndexes = series.points.flatMap((point, index) =>
    point.mean === null ? [] : [index],
  );
  const values = observed.map((point) => point.mean!);
  let low = Math.min(...values);
  let high = Math.max(...values);
  // Margen mínimo para que una serie casi plana no exagere variaciones.
  const padding = Math.max((high - low) * 0.15, 0.005);
  low -= padding;
  high += padding;
  const plotWidth = width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const x = (index: number) =>
    CHART.left +
    (series.points.length === 1
      ? plotWidth / 2
      : (index / (series.points.length - 1)) * plotWidth);
  const y = (value: number) =>
    CHART.top + (1 - (value - low) / (high - low)) * plotHeight;
  // Máximo y mínimo observados; si casi coinciden, una etiqueta basta para
  // que no se superpongan.
  const ticks =
    y(low + padding) - y(high - padding) < 18
      ? [high - padding]
      : [high - padding, (high + low) / 2, low + padding];

  // Tramos de días consecutivos con observación: los huecos no se unen.
  const segments: string[] = [];
  let current: string[] = [];
  series.points.forEach((point, index) => {
    if (point.mean === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(
      `${current.length === 0 ? "M" : "L"}${x(index)},${y(point.mean)}`,
    );
  });
  if (current.length > 1) segments.push(current.join(" "));

  const shownIndex = active ?? observedIndexes.at(-1)!;
  const shown = series.points[shownIndex];

  function nearestObserved(clientX: number, rect: DOMRect): number {
    const target = clientX - rect.left;
    return observedIndexes.reduce((best, index) =>
      Math.abs(x(index) - target) < Math.abs(x(best) - target) ? index : best,
    );
  }

  // Flechas, Inicio y Fin recorren los días con dato sin ratón.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const position = observedIndexes.indexOf(shownIndex);
    const next = {
      ArrowLeft: Math.max(0, position - 1),
      ArrowRight: Math.min(observedIndexes.length - 1, position + 1),
      Home: 0,
      End: observedIndexes.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(observedIndexes[next]);
  }

  return (
    <figure className="mt-5">
      <p
        aria-hidden="true"
        className="num mb-3 flex flex-wrap items-baseline gap-x-3"
      >
        <span className="text-ink text-[2rem] leading-none font-extrabold tracking-[-0.035em]">
          {formatPrice(shown.mean!)} {unit}
        </span>
        <span className="text-muted text-[0.875rem]">
          {formatLongDate(shown.date)} · {formatCount(shown.count!)} estaciones
        </span>
      </p>
      <p aria-hidden="true" className="text-muted mb-1 text-xs">
        {unit}
      </p>
      <div
        ref={containerRef}
        className="relative rounded-lg"
        tabIndex={0}
        role="group"
        aria-label={`${label}. Usa las flechas para recorrer los días con dato.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={CHART.height}
          viewBox={`0 0 ${width} ${CHART.height}`}
          className="block max-w-full touch-pan-y"
          role="img"
          aria-label={`${label}: ${observed.length} observaciones entre ${formatLongDate(series.startDate!)} y ${formatLongDate(series.endDate!)}. Los datos están en la tabla siguiente.`}
          onPointerMove={(event) =>
            setActive(
              nearestObserved(
                event.clientX,
                event.currentTarget.getBoundingClientRect(),
              ),
            )
          }
          onPointerDown={(event) =>
            setActive(
              nearestObserved(
                event.clientX,
                event.currentTarget.getBoundingClientRect(),
              ),
            )
          }
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setActive(null);
          }}
        >
          {ticks.map((value) => (
            <g key={value}>
              <line
                x1={CHART.left}
                x2={width - CHART.right}
                y1={y(value)}
                y2={y(value)}
                stroke="#e4e9ef"
              />
              <text
                x={CHART.left - 8}
                y={y(value) + 4}
                textAnchor="end"
                className="fill-[#55687d] text-xs tabular-nums"
              >
                {formatPrice(value)}
              </text>
            </g>
          ))}
          {segments.map((path) => (
            <path
              key={path}
              d={path}
              fill="none"
              stroke="#1f62b0"
              strokeWidth={2.25}
              strokeLinejoin="round"
            />
          ))}
          {series.points.map((point, index) =>
            point.mean === null ? null : (
              <circle
                key={point.date}
                cx={x(index)}
                cy={y(point.mean)}
                r={2.5}
                fill="#1f62b0"
              >
                <title>
                  {`${formatShortDate(point.date)}: ${formatPrice(point.mean)} ${unit}`}
                </title>
              </circle>
            ),
          )}
          {active !== null && shown.mean !== null ? (
            <g aria-hidden="true">
              <line
                x1={x(shownIndex)}
                x2={x(shownIndex)}
                y1={CHART.top}
                y2={CHART.height - CHART.bottom}
                stroke="#0f1d2e"
                strokeOpacity={0.25}
              />
              <circle
                cx={x(shownIndex)}
                cy={y(shown.mean)}
                r={5.5}
                fill="#1f62b0"
                stroke="#ffffff"
                strokeWidth={2.5}
              />
            </g>
          ) : null}
          {[0, series.points.length - 1].map((index) => (
            <text
              key={index}
              x={x(index)}
              y={CHART.height - 8}
              textAnchor={index === 0 ? "start" : "end"}
              className="fill-[#55687d] text-xs"
            >
              {formatShortDate(series.points[index].date)}
            </text>
          ))}
        </svg>
      </div>
      {/* Anuncia el día elegido con el teclado a los lectores de pantalla. */}
      <p className="sr-only" aria-live="polite">
        {active !== null
          ? `${formatLongDate(shown.date)}: ${formatPrice(shown.mean!)} ${PRICE_UNIT_NAMES[unit]}, ${formatCount(shown.count!)} estaciones.`
          : ""}
      </p>
      <figcaption className="sr-only">{label}</figcaption>
      {/* Una tabla ignora el ancho de sr-only: se oculta su contenedor. */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Precio medio ({PRICE_UNIT_NAMES[unit]})</th>
              <th scope="col">Estaciones</th>
            </tr>
          </thead>
          <tbody>
            {observed.map((point) => (
              <tr key={point.date}>
                <td>{formatLongDate(point.date)}</td>
                <td>{formatPrice(point.mean!)}</td>
                <td>{formatCount(point.count!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Estado de una descarga del histórico publicado. */
type Load<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "missing" }
  | { status: "error" };

async function load<T>(request: () => Promise<T | null>): Promise<Load<T>> {
  try {
    const value = await request();
    return value === null ? { status: "missing" } : { status: "ready", value };
  } catch {
    return { status: "error" };
  }
}

export function PriceHistoryPanel({
  fuel,
  provinces,
}: {
  fuel: FuelCode;
  provinces: { id: string; name: string }[];
}) {
  const [national, setNational] = useState<Load<NationalHistory>>({
    status: "loading",
  });
  useEffect(() => {
    let active = true;
    // El histórico se descarga aparte: si falla, las estadísticas actuales,
    // que vienen en el HTML, siguen intactas.
    void load(() => fetchNationalHistory()).then((result) => {
      if (active) setNational(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-labelledby="history-title">
      <h2
        id="history-title"
        className="text-ink text-[1.5rem] leading-tight font-extrabold tracking-[-0.025em] md:text-[1.875rem]"
      >
        Evolución del precio medio
      </h2>

      {national.status === "loading" ? (
        <p className="text-muted mt-3 text-[0.9375rem] leading-6" role="status">
          Cargando el histórico…
        </p>
      ) : national.status === "error" ? (
        <p
          className="mt-3 rounded-xl bg-amber-50 px-4 pt-3.5 pb-3 text-[0.9375rem] leading-6 text-amber-950"
          role="alert"
        >
          El histórico no se ha podido validar y no se muestra. Las estadísticas
          actuales no se ven afectadas.
        </p>
      ) : national.status === "missing" ||
        national.value.entries.length === 0 ? (
        <div className="mt-3 text-[0.9375rem] leading-6">
          <p className="text-ink font-medium">Todavía no hay histórico.</p>
          <p className="text-muted mt-1">
            FuelShift solo mostrará la evolución con observaciones reales, una
            por día, a partir de la fecha en que empiece a guardarlas. No se
            reconstruyen días pasados ni se rellenan huecos.
          </p>
        </div>
      ) : (
        <HistoryContent
          history={national.value}
          fuel={fuel}
          provinces={provinces}
        />
      )}
    </section>
  );
}

function HistoryContent({
  history,
  fuel,
  provinces,
}: {
  history: NationalHistory;
  fuel: FuelCode;
  provinces: { id: string; name: string }[];
}) {
  const [period, setPeriod] = useState<HistoryPeriod>(30);
  const [provinceId, setProvinceId] = useState("");
  // Cada provincia se descarga la primera vez que se elige.
  const [provinceLoads, setProvinceLoads] = useState<
    Record<string, Load<ProvinceHistory>>
  >({});
  const scope =
    provinces.find((province) => province.id === provinceId)?.name ?? "España";
  const label = `Precio medio de ${FUEL_LABELS[fuel]} en ${scope}`;
  const provinceLoad = provinceId ? provinceLoads[provinceId] : null;

  function selectProvince(id: string) {
    setProvinceId(id);
    if (!id || provinceLoads[id]) return;
    setProvinceLoads((current) => ({
      ...current,
      [id]: { status: "loading" },
    }));
    void load(() => fetchProvinceHistory(id)).then((result) =>
      setProvinceLoads((current) => ({ ...current, [id]: result })),
    );
  }

  const observations = !provinceLoad
    ? historyObservations(history, fuel)
    : provinceLoad.status === "ready"
      ? historyObservations(provinceLoad.value, fuel)
      : [];
  const series = buildHistorySeries(
    observations,
    historyTimeline(history),
    period,
  );

  return (
    <>
      <p className="text-muted mt-2 text-[0.9375rem]">
        Observaciones diarias reales desde el{" "}
        {formatLongDate(series.collectingSince!)}.
      </p>
      {history.discarded > 0 ? (
        <p className="text-muted mt-1 text-[0.8125rem] leading-5">
          {history.discarded === 1
            ? "Un registro diario no superó la validación y no se muestra."
            : `${history.discarded} registros diarios no superaron la validación y no se muestran.`}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-3">
        <ChipRadios
          name="history-period"
          legend="Periodo"
          options={HISTORY_PERIODS.map(
            (days) => [String(days), `${days} días`] as const,
          )}
          value={String(period)}
          onChange={(value) => setPeriod(Number(value) as HistoryPeriod)}
        />
        <div className="min-w-48 flex-1 sm:max-w-64">
          <label
            htmlFor="history-province"
            className="text-muted mb-1.5 block text-[0.75rem] font-bold"
          >
            Ámbito
          </label>
          <select
            id="history-province"
            className="control"
            value={provinceId}
            onChange={(event) => selectProvince(event.target.value)}
          >
            <option value="">España</option>
            {provinces.map((province) => (
              <option key={province.id} value={province.id}>
                {province.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {provinceLoad?.status === "loading" ? (
        <p className="text-muted mt-4 text-[0.9375rem] leading-6" role="status">
          Cargando el histórico de {scope}…
        </p>
      ) : provinceLoad?.status === "error" ? (
        <p
          className="mt-4 rounded-xl bg-amber-50 px-4 pt-3.5 pb-3 text-[0.9375rem] leading-6 text-amber-950"
          role="alert"
        >
          El histórico de {scope} no se ha podido validar y no se muestra. El
          nacional sigue disponible.
        </p>
      ) : series.chartable ? (
        <>
          <HistoryChart series={series} label={label} unit={priceUnit(fuel)} />
          {!series.complete ? (
            <p className="text-muted mt-3 text-[0.8125rem] leading-5">
              Periodo incompleto: {series.observedDays} de {series.periodDays}{" "}
              días con observación
              {series.startsAfterPeriod
                ? `, porque el histórico empieza el ${formatLongDate(series.collectingSince!)}`
                : ""}
              . Los días sin dato aparecen como huecos y no se unen.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-muted mt-4 text-[0.9375rem] leading-6" role="status">
          {series.observedDays === 0
            ? `No hay observaciones de ${FUEL_LABELS[fuel]} en ${scope} en los últimos ${period} días registrados.`
            : `Solo hay ${series.observedDays} observación en los últimos ${period} días. La evolución se mostrará con al menos ${MIN_CHART_OBSERVATIONS}.`}
        </p>
      )}
    </>
  );
}
