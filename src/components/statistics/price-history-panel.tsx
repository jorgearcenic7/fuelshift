"use client";

import { useEffect, useRef, useState } from "react";

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
  defaultWidth: 440,
  height: 200,
  left: 46,
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
      : [high - padding, low + padding];

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

  return (
    <figure className="mt-4" ref={containerRef}>
      <p aria-hidden="true" className="text-muted mb-1 text-xs">
        {unit}
      </p>
      <svg
        width={width}
        height={CHART.height}
        viewBox={`0 0 ${width} ${CHART.height}`}
        className="block max-w-full"
        role="img"
        aria-label={`${label}: ${observed.length} observaciones entre ${formatLongDate(series.startDate!)} y ${formatLongDate(series.endDate!)}. Los datos están en la tabla siguiente.`}
      >
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={CHART.left}
              x2={width - CHART.right}
              y1={y(value)}
              y2={y(value)}
              stroke="#e3e9f0"
            />
            <text
              x={CHART.left - 8}
              y={y(value) + 4}
              textAnchor="end"
              className="fill-[#5a6b7e] text-xs tabular-nums"
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
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {series.points.map((point, index) =>
          point.mean === null ? null : (
            <circle
              key={point.date}
              cx={x(index)}
              cy={y(point.mean)}
              r={4}
              fill="#1f62b0"
              stroke="#ffffff"
              strokeWidth={2}
            >
              <title>
                {`${formatShortDate(point.date)}: ${formatPrice(point.mean)} ${unit}`}
              </title>
            </circle>
          ),
        )}
        {[0, series.points.length - 1].map((index) => (
          <text
            key={index}
            x={x(index)}
            y={CHART.height - 8}
            textAnchor={index === 0 ? "start" : "end"}
            className="fill-[#5a6b7e] text-xs"
          >
            {formatShortDate(series.points[index].date)}
          </text>
        ))}
      </svg>
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
    <section
      aria-labelledby="history-title"
      className="border-line bg-surface rounded-2xl border p-5 shadow-sm sm:p-6"
    >
      <h2 id="history-title" className="text-ink text-lg font-semibold">
        Evolución del precio medio
      </h2>

      {national.status === "loading" ? (
        <p
          className="bg-canvas text-muted mt-3 rounded-xl p-4 text-sm leading-6"
          role="status"
        >
          Cargando el histórico…
        </p>
      ) : national.status === "error" ? (
        <p
          className="mt-3 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950"
          role="alert"
        >
          El histórico no se ha podido validar y no se muestra. Las estadísticas
          actuales no se ven afectadas.
        </p>
      ) : national.status === "missing" ||
        national.value.entries.length === 0 ? (
        <div className="bg-canvas mt-3 rounded-xl p-4 text-sm leading-6">
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
      <p className="text-muted mt-1 text-sm">
        Observaciones diarias reales desde el{" "}
        {formatLongDate(series.collectingSince!)}.
      </p>
      {history.discarded > 0 ? (
        <p className="text-muted mt-1 text-xs leading-5">
          {history.discarded === 1
            ? "Un registro diario no superó la validación y no se muestra."
            : `${history.discarded} registros diarios no superaron la validación y no se muestran.`}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <fieldset>
          <legend className="text-muted mb-1.5 text-xs font-medium">
            Periodo
          </legend>
          <div className="bg-canvas ring-line inline-grid grid-cols-3 gap-1 rounded-xl p-1 ring-1">
            {HISTORY_PERIODS.map((days) => (
              <label
                key={days}
                className="text-muted hover:text-ink has-checked:text-accent-strong flex min-h-8 items-center justify-center rounded-lg px-3 text-xs font-medium has-checked:bg-white has-checked:font-semibold has-checked:shadow-[0_1px_3px_rgb(15_29_46/12%)] has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-[#f4a261]"
              >
                <input
                  type="radio"
                  name="history-period"
                  value={days}
                  checked={period === days}
                  onChange={() => setPeriod(days)}
                  className="sr-only"
                />
                {days} días
              </label>
            ))}
          </div>
        </fieldset>
        <div className="min-w-48 flex-1 sm:max-w-64">
          <label
            htmlFor="history-province"
            className="text-muted mb-1.5 block text-xs font-medium"
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
        <p
          className="bg-canvas text-muted mt-4 rounded-xl p-4 text-sm leading-6"
          role="status"
        >
          Cargando el histórico de {scope}…
        </p>
      ) : provinceLoad?.status === "error" ? (
        <p
          className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950"
          role="alert"
        >
          El histórico de {scope} no se ha podido validar y no se muestra. El
          nacional sigue disponible.
        </p>
      ) : series.chartable ? (
        <>
          <HistoryChart series={series} label={label} unit={priceUnit(fuel)} />
          {!series.complete ? (
            <p className="text-muted mt-2 text-xs leading-5">
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
        <p
          className="bg-canvas text-muted mt-4 rounded-xl p-4 text-sm leading-6"
          role="status"
        >
          {series.observedDays === 0
            ? `No hay observaciones de ${FUEL_LABELS[fuel]} en ${scope} en los últimos ${period} días registrados.`
            : `Solo hay ${series.observedDays} observación en los últimos ${period} días. La evolución se mostrará con al menos ${MIN_CHART_OBSERVATIONS}.`}
        </p>
      )}
    </>
  );
}
