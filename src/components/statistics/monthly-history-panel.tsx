"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { PriceUnitLabel } from "@/components/price-unit";
import {
  fetchMonthlyManifest,
  fetchMonthlyHistory,
  MITECO_HISTORY_SOURCE,
  type MonthlyManifest,
  type MonthlyHistory,
} from "@/data/monthly-history";
import {
  buildChartGeometry,
  nearestPointIndex,
  selectMonthlyPeriod,
  MONTHLY_FUELS,
  MONTHLY_PERIODS,
  availablePeriods,
  type MonthlyFuel,
  type MonthlyObservation,
  type MonthlyPeriod,
} from "@/domain/monthly-history";
import {
  formatLongDate,
  formatMonthYear,
  formatPrice,
  formatRetrievedAt,
  formatSignedPercent,
} from "@/lib/format";

const FUEL_NAMES: Record<MonthlyFuel, string> = {
  gasoline_95_e5: "Gasolina 95",
  gasoline_98_e5: "Gasolina 98",
  diesel_a: "Gasóleo A",
};
const PERIOD_NAMES: Record<string, string> = {
  1: "1 año",
  5: "5 años",
  10: "10 años",
  15: "15 años",
  20: "20 años",
  all: "Todo",
};
const BOX = { height: 240, left: 46, right: 12, top: 14, bottom: 28 };
const LINE = "#1f62b0";
// Mismo estilo de botones segmentados que el histórico diario.
const segment =
  "text-muted hover:text-ink has-checked:text-accent-strong flex min-h-8 items-center justify-center rounded-lg px-3 text-xs font-medium has-checked:bg-white has-checked:font-semibold has-checked:shadow-[0_1px_3px_rgb(15_29_46/12%)] has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-[#f4a261]";

type Load =
  | { status: "loading" }
  | { status: "ready"; value: MonthlyManifest }
  | { status: "missing" }
  | { status: "error" };

export function MonthlyHistoryPanel() {
  const [state, setState] = useState<Load>({ status: "loading" });
  useEffect(() => {
    let active = true;
    fetchMonthlyManifest().then(
      (value) => {
        if (active)
          setState(value ? { status: "ready", value } : { status: "missing" });
      },
      () => {
        if (active) setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <section
      aria-labelledby="monthly-history-title"
      className="border-line bg-surface min-w-0 rounded-2xl border p-5 shadow-sm sm:p-6"
    >
      <h2 id="monthly-history-title" className="text-ink text-lg font-semibold">
        Evolución histórica de los carburantes
      </h2>
      <p className="text-muted mt-1 text-sm leading-6">
        Datos oficiales de MITECO desde 2007; medias calculadas por FuelShift.
        Una observación del día 1 de cada mes, independiente del histórico
        diario.
      </p>
      {state.status === "ready" ? (
        <MonthlyHistoryContent manifest={state.value} />
      ) : (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className="bg-canvas text-muted mt-3 rounded-xl p-4 text-sm leading-6"
        >
          {state.status === "loading"
            ? "Cargando el histórico mensual…"
            : state.status === "missing"
              ? "El histórico mensual todavía no está publicado."
              : "No se ha podido validar el histórico mensual. El resto de estadísticas sigue disponible."}
        </p>
      )}
    </section>
  );
}

function MonthlyHistoryContent({ manifest }: { manifest: MonthlyManifest }) {
  const [scope, setScope] = useState("ES");
  const [fuel, setFuel] = useState<MonthlyFuel>("gasoline_95_e5");
  const [period, setPeriod] = useState<MonthlyPeriod>("all");
  const [result, setResult] = useState<{
    key: string;
    value: MonthlyHistory | null;
  } | null>(null);
  const cache = useRef(new Map<string, MonthlyHistory>());
  const key = `${scope}/${fuel}`;
  useEffect(() => {
    let active = true;
    const saved = cache.current.get(key);
    const request = saved
      ? Promise.resolve(saved)
      : fetchMonthlyHistory(manifest, scope, fuel);
    request.then(
      (value) => {
        if (active) {
          cache.current.set(key, value);
          setResult({ key, value });
        }
      },
      () => {
        if (active) setResult({ key, value: null });
      },
    );
    return () => {
      active = false;
    };
  }, [manifest, scope, fuel, key]);
  const history = result?.key === key ? result.value : undefined;
  const available: MonthlyPeriod[] = history?.points.length
    ? availablePeriods(history.points[0].date, history.points.at(-1)!.date)
    : ["all"];
  const selected = available.includes(period) ? period : "all";
  const summary = history
    ? selectMonthlyPeriod(history.points, selected, history.lastDate)
    : null;
  const missing =
    history?.missingDates.filter(
      (day) => !summary || day >= summary.requestedStart,
    ) ?? [];
  const name = manifest.scopes.find((item) => item.id === scope)!.name;
  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label
          className="text-muted grid gap-1.5 text-xs font-medium"
          htmlFor="monthly-scope"
        >
          Ámbito
          <select
            id="monthly-scope"
            className="border-line text-ink bg-canvas min-h-10 max-w-full rounded-lg border px-3 text-sm"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
          >
            {manifest.scopes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="text-muted mb-1.5 text-xs font-medium">
            Combustible
          </legend>
          <div className="bg-canvas ring-line inline-grid grid-cols-3 gap-1 rounded-xl p-1 ring-1">
            {MONTHLY_FUELS.map((code) => (
              <label key={code} className={segment}>
                <input
                  type="radio"
                  className="sr-only"
                  name="monthly-fuel"
                  checked={fuel === code}
                  onChange={() => setFuel(code)}
                  value={code}
                />
                {FUEL_NAMES[code]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-muted mb-1.5 text-xs font-medium">
            Periodo
          </legend>
          <div className="bg-canvas ring-line inline-grid grid-cols-3 gap-1 rounded-xl p-1 ring-1 sm:grid-cols-6">
            {MONTHLY_PERIODS.map((value) => (
              <label
                key={value}
                className={`${segment} ${available.includes(value) ? "" : "opacity-40"}`}
                title={
                  available.includes(value)
                    ? undefined
                    : "Sin cobertura suficiente para este periodo"
                }
              >
                <input
                  type="radio"
                  name="monthly-period"
                  className="sr-only"
                  value={value}
                  checked={selected === value}
                  disabled={!available.includes(value)}
                  onChange={() => setPeriod(value)}
                />
                {PERIOD_NAMES[value]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {history === undefined ? (
        <p role="status" className="text-muted mt-4 text-sm">
          Cargando la serie seleccionada…
        </p>
      ) : history === null ? (
        <p role="alert" className="mt-4 text-sm">
          No se ha podido validar esta serie. Selecciona otro ámbito o
          combustible.
        </p>
      ) : summary ? (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-3 sm:gap-3">
            <Figure
              label="Precio inicial"
              value={formatPrice(summary.first.price)}
              detail={formatLongDate(summary.first.date)}
              unit
            />
            <Figure
              label="Precio final"
              value={formatPrice(summary.last.price)}
              detail={formatLongDate(summary.last.date)}
              unit
            />
            <Figure
              label="Variación"
              value={formatSignedPercent(summary.changePercent)}
              detail="Entre la primera y la última muestra"
            />
          </dl>
          <MonthlyChart
            key={`${key}-${selected}`}
            points={summary.points}
            label={`Precio medio de ${FUEL_NAMES[fuel]} en ${name}: instantáneas del día 1 de cada mes`}
          />
          <p className="text-muted mt-2 text-xs leading-5" role="status">
            {summary.points.length} observaciones · {missing.length} meses sin
            precio. Muestra inicial:{" "}
            {summary.first.count.toLocaleString("es-ES")} estaciones; final:{" "}
            {summary.last.count.toLocaleString("es-ES")}.
          </p>
          {missing.length ? (
            <details className="text-muted mt-2 text-xs">
              <summary className="cursor-pointer">Meses sin datos</summary>
              <p className="mt-1">{missing.map(formatMonthYear).join(", ")}</p>
            </details>
          ) : null}
        </>
      ) : (
        <p
          role="status"
          className="bg-canvas text-muted mt-4 rounded-xl p-4 text-sm"
        >
          No hay al menos dos observaciones para mostrar una evolución en este
          periodo.
        </p>
      )}
      <p className="text-muted mt-4 text-xs leading-5">
        Fuente:{" "}
        <a
          href={MITECO_HISTORY_SOURCE}
          className="text-accent-strong underline underline-offset-2"
          rel="noopener noreferrer"
        >
          MITECO · API oficial de carburantes
        </a>
        . Cobertura: {formatLongDate(manifest.firstDate)}–
        {formatLongDate(manifest.lastDate)}. Recuperado el{" "}
        {formatRetrievedAt(manifest.retrievedAt)}. Frecuencia mensual, día 1 a
        las 00:00 según la fuente.
      </p>
      <details className="text-muted mt-2 text-xs leading-5">
        <summary className="cursor-pointer font-medium">
          Metodología y cobertura
        </summary>
        <p className="mt-2">
          Media aritmética de los precios comunicados por estaciones con venta
          al público (Tipo Venta P), en €/L, con impuestos según el territorio.
          España incluye Península, Baleares, Canarias, Ceuta y Melilla. Cada
          estación tiene el mismo peso; la media nacional se calcula con
          estaciones, sin promediar medias provinciales. Se excluyen precios
          vacíos; los duplicados idénticos cuentan una sola vez. Gasolinas:
          campos 95 E5 y 98 E5 de la API, también en registros antiguos bajo la
          nomenclatura actual. No se combinan con E10 ni con productos premium.
          No se ajustan bonificaciones externas al precio comunicado.
        </p>
        <p className="mt-2">
          Es una fotografía mensual, no la media de todos los días del mes. La
          composición de estaciones cambia con el tiempo. Los meses sin precio
          se muestran como huecos; no se rellenan ni interpolan observaciones.
          Las líneas solo unen muestras de meses consecutivos. La variación
          compara las fechas efectivamente disponibles. Muestras nacionales
          recuperadas: {manifest.sampleCount}/{manifest.expectedCount}.
        </p>
        <a
          href={`/data/historico-miteco/sets/${manifest.generation}/provenance.json`}
          className="text-accent-strong underline underline-offset-2"
        >
          Procedencia y cobertura por muestra (JSON)
        </a>
      </details>
    </>
  );
}

function Figure({
  label,
  value,
  detail,
  unit = false,
}: {
  label: string;
  value: string;
  detail: string;
  unit?: boolean;
}) {
  return (
    <div className="bg-canvas rounded-xl p-3">
      <dt className="text-muted text-xs font-medium">{label}</dt>
      <dd className="text-ink mt-1 text-lg font-semibold tabular-nums sm:text-xl">
        {value}
        {unit ? (
          <PriceUnitLabel
            unit="€/L"
            className="text-muted text-xs font-medium"
          />
        ) : null}
      </dd>
      <dd className="text-muted mt-0.5 text-xs leading-4">{detail}</dd>
    </div>
  );
}

function MonthlyChart({
  points,
  label,
}: {
  points: MonthlyObservation[];
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  // El SVG se dibuja a escala 1:1 con el ancho real: el texto conserva su tamaño.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(180, Math.round(entry.contentRect.width))),
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const box = { ...BOX, width };
  const chart = buildChartGeometry(points, box);
  const first = points[0];
  const last = points.at(-1)!;
  const point = active === null ? null : points[active];

  function pointAt(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setActive(
      nearestPointIndex(points, chart.timeAt(event.clientX - rect.left)),
    );
  }

  // Flechas, Inicio y Fin recorren las muestras sin ratón.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 12 : 1;
    const current = active ?? points.length - 1;
    const next = {
      ArrowLeft: Math.max(0, current - step),
      ArrowRight: Math.min(points.length - 1, current + step),
      Home: 0,
      End: points.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  }

  const tooltipLeft = point
    ? Math.min(Math.max(chart.x(point.date), 70), width - 70)
    : 0;

  return (
    <figure className="mt-4">
      <p aria-hidden="true" className="text-muted mb-1 text-xs">
        €/L
      </p>
      <div
        ref={containerRef}
        className="relative rounded-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#f4a261]"
        tabIndex={0}
        role="group"
        aria-label={`${label}. Usa las flechas para recorrer las muestras; Mayúsculas + flecha avanza doce observaciones.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={BOX.height}
          viewBox={`0 0 ${width} ${BOX.height}`}
          className="block max-w-full touch-pan-y"
          role="img"
          aria-label={`${label}: ${points.length} muestras entre ${formatLongDate(first.date)} y ${formatLongDate(last.date)}, mínimo ${formatPrice(chart.minPrice)} y máximo ${formatPrice(chart.maxPrice)} euros por litro.`}
          onPointerMove={pointAt}
          onPointerDown={pointAt}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setActive(null);
          }}
        >
          {[...new Set([chart.maxPrice, chart.minPrice])].map((value) => (
            <g key={value}>
              <line
                x1={BOX.left}
                x2={width - BOX.right}
                y1={chart.y(value)}
                y2={chart.y(value)}
                stroke="#e3e9f0"
              />
              <text
                x={BOX.left - 8}
                y={chart.y(value) + 4}
                textAnchor="end"
                className="fill-[#5a6b7e] text-xs tabular-nums"
              >
                {formatPrice(value)}
              </text>
            </g>
          ))}
          {chart.paths.map((path) => (
            <path
              key={path}
              d={path}
              fill="none"
              stroke={LINE}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ))}
          {points.map((item) => (
            <circle
              key={item.date}
              cx={chart.x(item.date)}
              cy={chart.y(item.price)}
              r={2}
              fill={LINE}
            />
          ))}
          {point ? (
            <g aria-hidden="true">
              <line
                x1={chart.x(point.date)}
                x2={chart.x(point.date)}
                y1={BOX.top}
                y2={BOX.height - BOX.bottom}
                stroke="#9aa9ba"
                strokeDasharray="3 3"
              />
              <circle
                cx={chart.x(point.date)}
                cy={chart.y(point.price)}
                r={5}
                fill={LINE}
                stroke="#ffffff"
                strokeWidth={2}
              />
            </g>
          ) : null}
          {[first, last].map((item, index) => (
            <text
              key={item.date}
              x={chart.x(item.date)}
              y={BOX.height - 8}
              textAnchor={index === 0 ? "start" : "end"}
              className="fill-[#5a6b7e] text-xs"
            >
              {formatMonthYear(item.date)}
            </text>
          ))}
        </svg>
        {point ? (
          <div
            aria-hidden="true"
            className="border-line bg-surface pointer-events-none absolute top-1 -translate-x-1/2 rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md"
            style={{ left: tooltipLeft }}
          >
            <span className="text-muted block">
              Muestra del {formatLongDate(point.date)}
            </span>
            <span className="text-ink font-semibold tabular-nums">
              {formatPrice(point.price)} €/L
            </span>
            <span className="text-muted block">
              {point.count.toLocaleString("es-ES")} estaciones
            </span>
          </div>
        ) : null}
      </div>
      {/* Anuncia la muestra elegida con el teclado a los lectores de pantalla. */}
      <p className="sr-only" aria-live="polite">
        {point
          ? `Muestra del ${formatLongDate(point.date)}: ${formatPrice(point.price)} euros por litro.`
          : ""}
      </p>
      <figcaption className="text-muted mt-2 text-xs leading-5">
        {label}
      </figcaption>
    </figure>
  );
}
