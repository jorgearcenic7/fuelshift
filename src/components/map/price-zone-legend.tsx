import { useState } from "react";

import { MIN_ZONE_STATIONS, type PriceZoneMap } from "@/domain/price-zones";
import { FUEL_LABELS, type FuelCode } from "@/domain/stations";

import {
  INSUFFICIENT_STYLE,
  PRICE_CLASS_STYLES,
  classIntervals,
  classSpread,
  compactIntervals,
  extremeZones,
  formatZonePrice,
  zoneLabels,
} from "./price-zone-layer";

const EXTREME_COUNT = 5;
const PRICE_CLASSES = [0, 1, 2] as const;
// A partir de `md` hay espacio para mostrar la leyenda completa sobre el mapa.
const EXPANDED_BY_DEFAULT_QUERY = "(min-width: 48rem)";

function Swatch({ fill, outline }: { fill: string; outline: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-[3px] border"
      style={{ backgroundColor: fill, borderColor: outline }}
    />
  );
}

function ZoneList({
  title,
  zones,
  labels,
}: {
  title: string;
  zones: PriceZoneMap["zones"];
  labels: Map<string, string>;
}) {
  return (
    <>
      <h3 className="text-ink mt-2 font-semibold">{title}</h3>
      <ol className="mt-0.5 space-y-1">
        {zones.map((zone) => (
          <li key={zone.id} className="flex items-start gap-2 leading-4">
            <span className="min-w-0 flex-1">{labels.get(zone.id)}</span>
            <span className="text-ink tabular-nums">
              {formatZonePrice(zone.medianPrice!)}
            </span>
            <span className="w-11 text-right tabular-nums">
              {zone.stationCount} est.
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

export function PriceZoneLegend({
  zoneMap,
  fuel,
  loading,
  loadingStatus,
  failedProvinces,
  stale,
  filtersActive,
}: {
  zoneMap: PriceZoneMap | null;
  fuel: FuelCode;
  loading: boolean;
  loadingStatus: string;
  failedProvinces: number;
  stale: boolean;
  filtersActive: boolean;
}) {
  // Solo se monta en el navegador, tras elegir la vista de zonas, así que el
  // estado inicial no puede discrepar del HTML estático.
  const [expanded, setExpanded] = useState(
    () => window.matchMedia(EXPANDED_BY_DEFAULT_QUERY).matches,
  );
  const scale = zoneMap?.scale ?? null;
  const intervals = scale ? classIntervals(scale) : null;
  const compact = scale ? compactIntervals(scale) : null;
  const summary =
    !loading && zoneMap && scale && intervals && compact
      ? { zoneMap, scale, intervals, compact, spread: classSpread(scale) }
      : null;
  const status = loading
    ? `Se calculará con todas las provincias cargadas. ${loadingStatus}`
    : summary
      ? null
      : `No hay zonas con al menos ${MIN_ZONE_STATIONS} estaciones con precio de ${FUEL_LABELS[fuel]}.`;
  const zoneCount = (priceClass: number | null) =>
    zoneMap?.zones.filter((zone) => zone.priceClass === priceClass).length ?? 0;

  return (
    <section
      aria-labelledby="zone-legend-title"
      className="border-line text-muted w-[18rem] max-w-full rounded-xl border bg-white/95 px-3 py-2 text-xs leading-5 shadow-[0_12px_30px_-14px_rgb(15_29_46/45%)] backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="zone-legend-title"
          className="text-ink text-[0.8125rem] font-semibold"
        >
          Precio mediano por zona
        </h2>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="zone-legend-details"
          onClick={() => setExpanded((current) => !current)}
          className="text-accent hover:text-accent-strong hover:bg-accent-soft -mr-1 rounded-md px-1.5 font-semibold"
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

      {/* Plegada: solo combustible, colores e intervalos. */}
      {summary && !expanded ? (
        <>
          <p className="leading-4">{FUEL_LABELS[fuel]} · colores relativos</p>
          <ul
            className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5"
            aria-label={`Escala de ${FUEL_LABELS[fuel]}`}
          >
            {PRICE_CLASSES.map((priceClass) => {
              const { label, fill, outline } = PRICE_CLASS_STYLES[priceClass];
              return (
                <li
                  key={priceClass}
                  className="flex items-center gap-1 tabular-nums"
                >
                  <Swatch fill={fill} outline={outline} />
                  <span className="sr-only">
                    {label}: {summary.intervals[priceClass]}
                  </span>
                  <span aria-hidden="true">{summary.compact[priceClass]}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <div id="zone-legend-details" hidden={!expanded}>
        <p>{FUEL_LABELS[fuel]} · sin unidad acreditada</p>
        {summary ? (
          <>
            <ul className="mt-1.5 space-y-0.5">
              {PRICE_CLASSES.map((priceClass) => {
                const { label, fill, outline } = PRICE_CLASS_STYLES[priceClass];
                return (
                  <li key={priceClass} className="flex items-center gap-2">
                    <Swatch fill={fill} outline={outline} />
                    <span className="text-ink w-[4.25rem] shrink-0 font-medium">
                      {label}
                    </span>
                    <span className="min-w-0 flex-1 tabular-nums">
                      {summary.intervals[priceClass]}
                    </span>
                    <span className="sr-only">, </span>
                    <span className="tabular-nums">
                      {zoneCount(priceClass)}
                    </span>
                    <span className="sr-only"> zonas</span>
                  </li>
                );
              })}
              <li className="flex items-center gap-2">
                <Swatch
                  fill={INSUFFICIENT_STYLE.fill}
                  outline={INSUFFICIENT_STYLE.outline}
                />
                <span className="min-w-0 flex-1">
                  {INSUFFICIENT_STYLE.label} (menos de {MIN_ZONE_STATIONS})
                </span>
                <span className="sr-only">, </span>
                <span className="tabular-nums">{zoneCount(null)}</span>
                <span className="sr-only"> zonas</span>
              </li>
            </ul>
            <p className="mt-1 leading-4">
              Verde y rojo son relativos (tercios de{" "}
              {summary.scale.zoneCount.toLocaleString("es-ES")} zonas)
              {summary.spread ? (
                <>
                  ; el tramo intermedio abarca solo{" "}
                  <span className="text-ink tabular-nums">
                    {summary.spread}
                  </span>
                </>
              ) : null}
              .
            </p>
            <p className="mt-0.5 leading-4">
              {filtersActive
                ? "Tus filtros siguen en la lista; aquí no se aplican."
                : "No aplica búsqueda, marca ni rango de precio."}
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

        {summary ? (
          <details className="mt-1.5">
            <summary className="text-accent hover:text-accent-strong cursor-pointer font-semibold">
              Cómo se calcula y zonas destacadas
            </summary>
            <p className="mt-1.5 leading-4">
              Cuadrículas fijas de unos 22 km con la mediana de las estaciones
              con precio de {FUEL_LABELS[fuel]}. Incluye las{" "}
              {summary.zoneMap.stationCount.toLocaleString("es-ES")} estaciones
              cargadas, sin aplicar búsqueda, marca ni rango de precio, para que
              la escala sea común a toda España; no cambia al mover el mapa y
              cada límite pertenece al tramo inferior. Entre clases contiguas la
              diferencia puede ser pequeña: consulta siempre los intervalos.
              Cada zona se nombra por su municipio con más estaciones y, si ese
              municipio se repite, por el centro de la cuadrícula.
            </p>
            <ZoneLists zoneMap={summary.zoneMap} />
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ZoneLists({ zoneMap }: { zoneMap: PriceZoneMap }) {
  const labels = zoneLabels(zoneMap.zones);
  const { cheapest, priciest } = extremeZones(zoneMap, EXTREME_COUNT);
  return (
    <>
      <ZoneList title="Zonas más baratas" zones={cheapest} labels={labels} />
      <ZoneList title="Zonas más caras" zones={priciest} labels={labels} />
    </>
  );
}
