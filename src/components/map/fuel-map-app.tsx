"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { PriceUnitLabel } from "@/components/price-unit";
import {
  loadMitecoManifest,
  loadMitecoStations,
  type MitecoManifest,
} from "@/data/miteco";
import { getBrandIdentity } from "@/domain/brands";
import { isStale } from "@/domain/freshness";
import { PRICE_UNIT_NAMES, priceUnit } from "@/domain/fuel-units";
import {
  buildFilteredHeatmap,
  buildPriceHeatmap,
} from "@/domain/price-heatmap";
import {
  FUEL_LABELS,
  PRIMARY_FUELS,
  filterAndSortStations,
  getBrands,
  normalizeSearch,
  rankByPrice,
  type Coordinates,
  type FuelCode,
  type MapBounds,
  type PriceRanking,
  type Station,
  type StationSort,
} from "@/domain/stations";
import { formatPrice, formatRetrievedAt } from "@/lib/format";

import { BrandMark } from "./brand-mark";
import {
  AlertIcon,
  CursorIcon,
  LocateIcon,
  SearchIcon,
  SlidersIcon,
} from "./icons";
import { MapAttribution } from "./map-attribution";
import type { MapView } from "./price-heatmap-layer";
import { PriceHeatmapLegend } from "./price-heatmap-legend";
import { StationDetail } from "./station-detail";
import { StationMap } from "./station-map";

const RESULT_LIMIT = 50;
const RANKING_SIZE = 5;

type RankingScope = "visible" | "all";
const RANKING_SCOPES: readonly [RankingScope, string][] = [
  ["visible", "Zona visible"],
  ["all", "Todos los filtrados"],
];
const RANKING_SCOPE_CONTEXT: Record<RankingScope, string> = {
  visible: "en la zona visible",
  all: "en los resultados filtrados",
};
const MAP_VIEWS: readonly [MapView, string][] = [
  ["stations", "Estaciones"],
  ["heat", "Mapa de calor"],
];
// Coincide con el punto de ruptura `xl` de Tailwind, donde el mapa y la
// lista se muestran a la vez.
const SIDE_BY_SIDE_QUERY = "(min-width: 80rem)";

const fieldLabel = "mb-1.5 block text-xs font-medium text-muted";
const noticeClass =
  "mt-4 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-5 text-amber-950";
const STATUS_STYLES = {
  error: { tone: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-500" },
  loading: {
    tone: "bg-amber-50 text-amber-900 ring-amber-200",
    dot: "animate-pulse bg-amber-500",
  },
  ready: {
    tone: "bg-positive-soft text-positive ring-emerald-200",
    dot: "bg-positive",
  },
} as const;

/** Municipio y, si es distinta, la localidad comunicada por MITECO. */
function placeLabel(station: Station): string {
  return station.locality &&
    normalizeSearch(station.locality) !== normalizeSearch(station.municipality)
    ? `${station.municipality} · ${station.locality}`
    : station.municipality;
}

function describeDataStatus({
  loading,
  loadError,
  loadedProvinces,
  manifest,
  stationCount,
}: {
  loading: boolean;
  loadError: string | null;
  loadedProvinces: number;
  manifest: MitecoManifest | null;
  stationCount: number;
}): string {
  if (loading) {
    const total = manifest ? ` de ${manifest.province_count}` : "";
    return `Cargando ${loadedProvinces}${total} provincias…`;
  }
  if (loadError) return loadError;
  return `${stationCount.toLocaleString("es-ES")} estaciones cargadas`;
}

function dataStatusStyle(
  loading: boolean,
  loadError: string | null,
): (typeof STATUS_STYLES)[keyof typeof STATUS_STYLES] {
  if (loadError) return STATUS_STYLES.error;
  if (loading) return STATUS_STYLES.loading;
  return STATUS_STYLES.ready;
}

function describeRanking({
  waitingForData,
  ranking,
  rankingScope,
  fuel,
  filtersActive,
}: {
  waitingForData: boolean;
  ranking: PriceRanking | null;
  rankingScope: RankingScope;
  fuel: FuelCode;
  filtersActive: boolean;
}): string {
  if (waitingForData) return "Cargando datos oficiales…";
  if (ranking === null) {
    return "La zona visible estará disponible cuando cargue el mapa.";
  }
  if (ranking.total === 0) {
    return rankingScope === "visible"
      ? `No hay estaciones con precio de ${FUEL_LABELS[fuel]} en la zona visible. Mueve o aleja el mapa.`
      : `No hay estaciones con precio de ${FUEL_LABELS[fuel]} para estos filtros.`;
  }
  return `Las ${ranking.entries.length} más baratas de ${ranking.total.toLocaleString("es-ES")} estaciones ${RANKING_SCOPE_CONTEXT[rankingScope]}${filtersActive ? ", con los filtros activos" : ""}.`;
}

function RankBadge({
  position,
  context,
}: {
  position: number;
  context?: string;
}) {
  return (
    <span
      className={`inline-flex h-6 min-w-8 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums ${position === 1 ? "bg-positive text-white" : "bg-accent-soft text-accent-strong"}`}
    >
      <span className="sr-only">Puesto </span>
      <span aria-hidden="true">#</span>
      {position}
      {context ? <span className="sr-only"> del ranking {context}</span> : null}
    </span>
  );
}

export function FuelMapApp() {
  const [manifest, setManifest] = useState<MitecoManifest | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [loadedProvinces, setLoadedProvinces] = useState(0);
  const [failedProvinces, setFailedProvinces] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fuel, setFuel] = useState<FuelCode>("gasoline_95_e5");
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState<StationSort>("price");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [rankingScope, setRankingScope] = useState<RankingScope>("visible");
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [mapView, setMapView] = useState<MapView>("stations");
  // Solo afecta a pantallas estrechas: en escritorio el panel siempre se ve.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const mapAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const nextManifest = await loadMitecoManifest(controller.signal);
        if (controller.signal.aborted) return;
        setManifest(nextManifest);
        const { failed } = await loadMitecoStations({
          manifest: nextManifest,
          signal: controller.signal,
          onProvince: (province, completed) => {
            setStations((current) => [...current, ...province.stations]);
            setLoadedProvinces(completed);
          },
        });
        if (!controller.signal.aborted) setFailedProvinces(failed);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar los datos.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const brands = useMemo(() => getBrands(stations, fuel), [stations, fuel]);
  const results = useMemo(
    () =>
      filterAndSortStations(
        stations,
        {
          fuel,
          search,
          brand,
          minPrice: minPrice === "" ? null : Number(minPrice),
          maxPrice: maxPrice === "" ? null : Number(maxPrice),
        },
        sort,
        userLocation,
      ),
    [stations, fuel, search, brand, minPrice, maxPrice, sort, userLocation],
  );
  const selectedStation = selectedId
    ? (stations.find((station) => station.id === selectedId) ?? null)
    : null;
  // El ranking parte de los resultados ya filtrados. "Zona visible" espera a
  // que el mapa comunique sus límites en lugar de sustituirlos por España.
  const ranking = useMemo(
    () =>
      rankingScope === "visible" && mapBounds === null
        ? null
        : rankByPrice(
            results,
            fuel,
            RANKING_SIZE,
            rankingScope === "visible" ? mapBounds : null,
          ),
    [results, fuel, rankingScope, mapBounds],
  );
  const rankPositions = useMemo(
    () =>
      new Map(
        ranking?.entries.map(({ station, position }) => [
          station.id,
          position,
        ]) ?? [],
      ),
    [ranking],
  );
  // Filtros del panel plegable; el número se muestra en su botón para que no
  // queden ocultos al cerrarlo.
  const advancedFilterCount = [brand, minPrice, maxPrice].filter(
    (value) => value !== "",
  ).length;
  const filtersActive = search.trim() !== "" || advancedFilterCount > 0;

  // Escala del mapa de calor: P5–P95 de la superficie nacional del combustible.
  // Solo depende de las estaciones cargadas y del combustible, así que no
  // cambia al filtrar ni al mover el mapa. Espera a la carga completa para que
  // no varíe mientras llegan provincias.
  const nationalHeatmap = useMemo(
    () =>
      mapView === "heat" && !loading && !loadError
        ? buildPriceHeatmap(stations, fuel)
        : null,
    [mapView, loading, loadError, stations, fuel],
  );
  // Las estaciones representadas son las de la lista (combustible y filtros).
  // El valor diferido evita que escribir en la búsqueda espere al recálculo.
  const deferredResults = useDeferredValue(results);
  const heatmap = useMemo(
    () =>
      nationalHeatmap
        ? buildFilteredHeatmap(nationalHeatmap, deferredResults, filtersActive)
        : null,
    [nationalHeatmap, deferredResults, filtersActive],
  );
  const rankingContext = describeRanking({
    waitingForData: loading && stations.length === 0,
    ranking,
    rankingScope,
    fuel,
    filtersActive,
  });
  const stale = manifest !== null && isStale(manifest.retrieved_at);
  const unit = priceUnit(fuel);

  function changeFuel(nextFuel: FuelCode) {
    setFuel(nextFuel);
    setBrand("");
    setSelectedId(null);
  }

  // En pantallas estrechas la lista queda debajo del mapa: al elegir un
  // resultado se lleva la vista al mapa y a la ficha.
  function selectFromList(stationId: string) {
    setSelectedId(stationId);
    if (window.matchMedia(SIDE_BY_SIDE_QUERY).matches) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    mapAreaRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    // El foco acompaña a la vista: sin esto, el siguiente Tab devolvería a la
    // lista y un lector de pantalla no anunciaría la ficha. Se espera a que
    // React pinte la ficha de la estación elegida.
    requestAnimationFrame(() =>
      document
        .getElementById("station-detail-title")
        ?.focus({ preventScroll: true }),
    );
  }

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Este navegador no ofrece geolocalización.");
      return;
    }
    setLocationStatus("Solicitando permiso de ubicación…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setSort("distance");
        setLocationStatus("Ubicación disponible solo durante esta visita.");
      },
      () =>
        setLocationStatus(
          "No se pudo obtener la ubicación. Puedes seguir ordenando por precio.",
        ),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  const dataStatus = describeDataStatus({
    loading,
    loadError,
    loadedProvinces,
    manifest,
    stationCount: stations.length,
  });
  const statusStyle = dataStatusStyle(loading, loadError);

  return (
    <main
      id="contenido"
      className="flex flex-col xl:relative xl:grid xl:h-[calc(100dvh-3.5rem)] xl:grid-cols-[25rem_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)_auto] xl:overflow-hidden"
    >
      {/* El orden del documento es el de lectura en cualquier pantalla:
          filtros, mapa, ranking y resultados, así que el teclado y los
          lectores de pantalla siguen el mismo orden que la vista. En
          escritorio, filtros y resultados se desplazan juntos en esta columna
          y el mapa se coloca a su derecha (véase el área del mapa). */}
      <div className="xl:border-line xl:col-start-1 xl:row-start-1 xl:flex xl:min-h-0 xl:flex-col xl:overflow-y-auto xl:border-r xl:bg-white">
        {/* Presentación, estado de los datos y filtros */}
        <section
          aria-labelledby="map-title"
          className="border-line bg-surface border-b px-4 pt-4 pb-4 sm:px-[max(1.5rem,calc((100%-48rem)/2))] xl:px-5 xl:pt-5 xl:pb-5"
        >
          <p className="text-accent text-[0.6875rem] font-semibold tracking-[0.14em] uppercase">
            Precios oficiales de carburantes
          </p>
          <h1
            id="map-title"
            className="text-ink mt-1 text-[1.375rem] leading-tight font-semibold tracking-[-0.03em] xl:text-[1.6rem]"
          >
            Gasolineras de España
          </h1>

          <div
            className="mt-2 space-y-1 xl:mt-3 xl:space-y-1.5"
            aria-live="polite"
          >
            <span
              className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyle.tone}`}
            >
              <span
                className={`size-1.5 rounded-full ${statusStyle.dot}`}
                aria-hidden="true"
              />
              {dataStatus}
            </span>
            {manifest ? (
              <p className="text-muted text-xs leading-5">
                Descarga: {formatRetrievedAt(manifest.retrieved_at)}
                <span aria-hidden="true"> · </span>
                <br className="sm:hidden" />
                MITECO: {manifest.source.reported_at.raw} (zona no indicada)
              </p>
            ) : null}
          </div>

          {stale ? (
            <div className={noticeClass} role="status">
              <AlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p>
                Estos datos se descargaron hace más de 48 horas. Comprueba su
                antigüedad antes de tomar una decisión.
              </p>
            </div>
          ) : null}
          {failedProvinces.length > 0 ? (
            <div className={noticeClass} role="alert">
              <AlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p>
                No se pudieron cargar {failedProvinces.length} provincias. Los
                resultados visibles están incompletos.
              </p>
            </div>
          ) : null}

          <div className="border-line mt-4 border-t pt-3 xl:mt-5 xl:pt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-ink text-sm font-semibold">
                Buscar y filtrar
              </h2>
              <button
                type="button"
                className="text-accent hover:text-accent-strong hover:bg-accent-soft rounded-md px-1.5 py-0.5 text-xs font-semibold"
                onClick={() => {
                  setSearch("");
                  setBrand("");
                  setMinPrice("");
                  setMaxPrice("");
                }}
              >
                Limpiar filtros
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 xl:gap-y-3.5">
              <div className="col-span-2 flex gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="station-search" className="sr-only">
                    Municipio, marca o dirección
                  </label>
                  <div className="relative">
                    <SearchIcon className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <input
                      id="station-search"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="control h-11 pl-9"
                      placeholder="Municipio, marca o dirección"
                      autoComplete="off"
                    />
                  </div>
                </div>
                {/* Pantallas estrechas: el resto de filtros se pliega para que
                    el mapa quede a la vista. En escritorio no hace falta. */}
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls="advanced-filters"
                  onClick={() => setFiltersOpen((open) => !open)}
                  className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[0.625rem] border px-3 text-sm font-semibold transition-colors xl:hidden ${filtersOpen ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-ink hover:border-accent hover:text-accent bg-white"}`}
                >
                  <SlidersIcon className="size-4" />
                  Filtros
                  {advancedFilterCount > 0 ? (
                    <>
                      <span className="sr-only">
                        , {advancedFilterCount} activos
                      </span>
                      <span
                        aria-hidden="true"
                        className="bg-accent inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[0.6875rem] font-bold text-white tabular-nums"
                      >
                        {advancedFilterCount}
                      </span>
                    </>
                  ) : null}
                </button>
              </div>

              <fieldset className="col-span-2">
                {/* Las opciones se explican solas; la leyenda sigue disponible
                    para lectores de pantalla y en escritorio. */}
                <legend className={`${fieldLabel} max-xl:sr-only`}>
                  Combustible
                </legend>
                <div className="bg-canvas ring-line grid grid-cols-3 gap-1 rounded-xl p-1 ring-1">
                  {PRIMARY_FUELS.map((code) => (
                    <label
                      key={code}
                      className="text-muted hover:text-ink has-checked:text-accent-strong flex min-h-9 items-center justify-center rounded-lg px-1.5 py-1.5 text-center text-[0.8125rem] leading-tight font-medium transition-colors has-checked:bg-white has-checked:font-semibold has-checked:shadow-[0_1px_3px_rgb(15_29_46/12%)] has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-[#f4a261]"
                    >
                      <input
                        type="radio"
                        name="fuel"
                        value={code}
                        checked={fuel === code}
                        onChange={() => changeFuel(code)}
                        className="sr-only"
                      />
                      {FUEL_LABELS[code]}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Cerrado solo se oculta: los valores se conservan. */}
              <div
                id="advanced-filters"
                className={`col-span-2 grid grid-cols-2 gap-x-3 gap-y-3.5 ${filtersOpen ? "" : "max-xl:hidden"}`}
              >
                <div>
                  <label htmlFor="brand" className={fieldLabel}>
                    Marca
                  </label>
                  <select
                    id="brand"
                    value={brand}
                    onChange={(event) => setBrand(event.target.value)}
                    className="control"
                  >
                    <option value="">Todas</option>
                    {brands.map((item) => (
                      <option value={item} key={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sort" className={fieldLabel}>
                    Ordenar por
                  </label>
                  <select
                    id="sort"
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as StationSort)
                    }
                    className="control"
                  >
                    <option value="price">Precio más bajo</option>
                    <option value="distance" disabled={!userLocation}>
                      Distancia
                    </option>
                  </select>
                </div>

                <fieldset className="col-span-2">
                  <legend className={fieldLabel}>
                    Rango de precio
                    <span aria-hidden="true" className="font-normal">
                      {" "}
                      ({unit})
                    </span>
                    <span className="sr-only">
                      {" "}
                      en {PRICE_UNIT_NAMES[unit]}
                    </span>
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="min-price" className="sr-only">
                        Precio mínimo
                      </label>
                      <input
                        id="min-price"
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        value={minPrice}
                        onChange={(event) => setMinPrice(event.target.value)}
                        className="control"
                        placeholder="Mínimo"
                      />
                    </div>
                    <div>
                      <label htmlFor="max-price" className="sr-only">
                        Precio máximo
                      </label>
                      <input
                        id="max-price"
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        value={maxPrice}
                        onChange={(event) => setMaxPrice(event.target.value)}
                        className="control"
                        placeholder="Máximo"
                      />
                    </div>
                  </div>
                </fieldset>

                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={requestLocation}
                    aria-pressed={userLocation !== null}
                    className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-[0.625rem] border text-sm font-semibold transition-colors ${userLocation ? "border-positive/30 bg-positive-soft text-positive" : "border-line text-ink hover:border-accent hover:text-accent bg-white"}`}
                  >
                    <LocateIcon className="size-4" />
                    {userLocation ? "Ubicación activada" : "Usar mi ubicación"}
                  </button>
                  <p
                    className="text-muted mt-1.5 min-h-4 text-xs leading-4"
                    role="status"
                    aria-live="polite"
                  >
                    {locationStatus ??
                      "Solo se solicitará permiso al pulsar el botón."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Mapa y ficha de estación. En pantallas estrechas ocupa su sitio en
            el flujo, justo tras los filtros. En escritorio se coloca sobre la
            segunda columna de `main` (su bloque contenedor; `left` repite el
            ancho de la primera columna), así que ni la recorta ni la desplaza
            el scroll de esta columna. */}
        <div
          ref={mapAreaRef}
          className="relative scroll-mt-2 xl:absolute xl:inset-y-0 xl:right-0 xl:left-[25rem]"
        >
          <div className="relative h-[62svh] min-h-[22rem] xl:absolute xl:inset-0 xl:h-auto xl:min-h-0">
            <StationMap
              stations={results}
              fuel={fuel}
              selectedId={selectedId}
              userLocation={userLocation}
              onSelect={setSelectedId}
              onBoundsChange={setMapBounds}
              view={mapView}
              heatmap={heatmap}
            />
            <fieldset className="absolute top-3 left-3 z-10">
              <legend className="sr-only">Vista del mapa</legend>
              <div className="bg-canvas/95 ring-line grid grid-cols-2 gap-1 rounded-xl p-1 shadow-[0_6px_20px_-8px_rgb(15_29_46/40%)] ring-1 backdrop-blur">
                {MAP_VIEWS.map(([value, label]) => (
                  <label
                    key={value}
                    className="text-muted hover:text-ink has-checked:text-accent-strong flex min-h-8 items-center justify-center rounded-lg px-3 py-1 text-center text-xs font-medium whitespace-nowrap transition-colors has-checked:bg-white has-checked:font-semibold has-checked:shadow-[0_1px_3px_rgb(15_29_46/12%)] has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-[#f4a261]"
                  >
                    <input
                      type="radio"
                      name="map-view"
                      value={value}
                      checked={mapView === value}
                      onChange={() => setMapView(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {mapView === "heat" && !loadError ? (
              <div className="absolute bottom-9 left-3 z-10 max-w-[calc(100%-4.5rem)]">
                <PriceHeatmapLegend
                  heatmap={heatmap}
                  fuel={fuel}
                  loading={loading}
                  loadingStatus={dataStatus}
                  failedProvinces={failedProvinces.length}
                  stale={stale}
                  filtersActive={filtersActive}
                />
              </div>
            ) : null}
            {loading && !loadError ? (
              <div
                className="text-ink pointer-events-none absolute top-[3.75rem] left-3 z-10 inline-flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-xs font-medium shadow-[0_6px_20px_-8px_rgb(15_29_46/40%)] backdrop-blur"
                aria-hidden="true"
              >
                <span className="border-accent size-3 animate-spin rounded-full border-2 border-t-transparent" />
                {dataStatus}
              </div>
            ) : null}
            {loadError ? (
              <div className="absolute inset-0 z-20 grid place-items-center bg-white/40 p-4 backdrop-blur-[2px]">
                <div
                  className="border-line max-w-sm rounded-2xl border bg-white p-5 text-sm shadow-[0_20px_50px_-20px_rgb(15_29_46/45%)]"
                  role="alert"
                >
                  <span className="grid size-9 place-items-center rounded-xl bg-rose-50 text-rose-600">
                    <AlertIcon className="size-5" />
                  </span>
                  <strong className="text-ink mt-3 block text-base font-semibold">
                    No hay datos oficiales disponibles
                  </strong>
                  <span className="text-muted mt-1 block leading-6">
                    {loadError} Prepara una copia local validada para explorar
                    el mapa.
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <aside
            aria-labelledby="station-detail-title"
            className={`z-10 mx-3 my-3 sm:mx-auto sm:w-[calc(100%-3rem)] sm:max-w-3xl xl:absolute xl:top-4 xl:right-4 xl:m-0 xl:w-[23rem] ${selectedStation ? "overflow-hidden xl:max-h-[calc(100%-2rem)] xl:overflow-y-auto" : ""} border-line rounded-2xl border bg-white shadow-[0_24px_60px_-28px_rgb(15_29_46/50%)]`}
          >
            {selectedStation ? (
              <StationDetail
                station={selectedStation}
                fuel={fuel}
                userLocation={userLocation}
                rankPosition={rankPositions.get(selectedStation.id) ?? null}
                rankingContext={RANKING_SCOPE_CONTEXT[rankingScope]}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <div className="flex items-start gap-3 p-4">
                <span className="bg-accent-soft text-accent grid size-9 shrink-0 place-items-center rounded-xl">
                  <CursorIcon className="size-4" />
                </span>
                <div>
                  <h2
                    id="station-detail-title"
                    className="text-ink text-sm font-semibold"
                  >
                    Selecciona una estación
                  </h2>
                  <p className="text-muted mt-0.5 text-xs leading-5">
                    Pulsa un marcador o un resultado para consultar su
                    dirección, horario y todos los precios comunicados.
                  </p>
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* Ranking por precio */}
        <section
          aria-labelledby="ranking-title"
          className="border-line bg-surface border-b px-4 py-4 sm:px-[max(1.5rem,calc((100%-48rem)/2))] xl:px-5"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="ranking-title" className="text-ink text-sm font-semibold">
              Ranking por precio
            </h2>
            <span className="text-muted text-xs">
              Top {RANKING_SIZE} · {FUEL_LABELS[fuel]} · {unit}
            </span>
          </div>
          <fieldset className="mt-3">
            <legend className="sr-only">Ámbito del ranking</legend>
            <div className="bg-canvas ring-line grid grid-cols-2 gap-1 rounded-xl p-1 ring-1">
              {RANKING_SCOPES.map(([value, label]) => (
                <label
                  key={value}
                  className="text-muted hover:text-ink has-checked:text-accent-strong flex min-h-8 items-center justify-center rounded-lg px-2 py-1 text-center text-xs font-medium transition-colors has-checked:bg-white has-checked:font-semibold has-checked:shadow-[0_1px_3px_rgb(15_29_46/12%)] has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-[#f4a261]"
                >
                  <input
                    type="radio"
                    name="ranking-scope"
                    value={value}
                    checked={rankingScope === value}
                    onChange={() => setRankingScope(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-muted mt-2.5 text-xs leading-5" aria-live="polite">
            {rankingContext}
          </p>
          {ranking && ranking.entries.length > 0 ? (
            <ol className="mt-2 space-y-1" aria-label="Estaciones más baratas">
              {ranking.entries.map(({ station, price, position }) => {
                const selected = selectedId === station.id;
                return (
                  <li key={`${station.provinceId}-${station.id}`}>
                    <button
                      type="button"
                      onClick={() => selectFromList(station.id)}
                      aria-pressed={selected}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${selected ? "bg-accent-soft ring-accent/35 ring-1" : "hover:bg-canvas"}`}
                    >
                      <RankBadge position={position} />
                      <BrandMark identity={getBrandIdentity(station.brand)} />
                      <span className="min-w-0 flex-1">
                        <span className="text-ink block truncate text-sm font-semibold">
                          {station.brand ?? "Sin rótulo"}
                        </span>
                        <span className="text-muted block truncate text-xs">
                          {placeLabel(station)}
                        </span>
                      </span>
                      <span className="text-ink shrink-0 text-[0.9375rem] font-semibold tabular-nums">
                        {formatPrice(price)}
                        <PriceUnitLabel unit={unit} visuallyHidden />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </section>

        {/* Lista de resultados */}
        <section
          aria-labelledby="results-title"
          className="border-line bg-surface flex flex-col border-b xl:flex-1 xl:border-b-0"
        >
          <div className="border-line bg-surface/95 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur sm:px-[max(1.5rem,calc((100%-48rem)/2))] xl:sticky xl:top-0 xl:z-10 xl:px-5">
            <h2 id="results-title" className="text-ink text-sm font-semibold">
              Resultados
              <small className="text-muted ml-1.5 text-xs font-normal">
                · precios en {unit}
              </small>
            </h2>
            <span className="bg-canvas text-muted ring-line rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1">
              {results.length.toLocaleString("es-ES")}
            </span>
          </div>
          <div
            className="space-y-1 px-2 py-2 sm:px-[max(1rem,calc((100%-49rem)/2))] xl:px-3"
            aria-label="Lista de estaciones"
          >
            {loading && results.length === 0
              ? Array.from({ length: 5 }, (_, index) => (
                  <div
                    key={index}
                    className="flex animate-pulse items-center gap-3 rounded-xl px-3 py-3"
                    aria-hidden="true"
                  >
                    <div className="flex-1 space-y-2">
                      <div className="bg-line h-3 w-2/5 rounded" />
                      <div className="bg-line/70 h-2.5 w-3/5 rounded" />
                    </div>
                    <div className="bg-line h-4 w-12 rounded" />
                  </div>
                ))
              : null}
            {results.slice(0, RESULT_LIMIT).map((station) => {
              const selected = selectedId === station.id;
              return (
                <button
                  type="button"
                  key={`${station.provinceId}-${station.id}`}
                  onClick={() => selectFromList(station.id)}
                  aria-pressed={selected}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${selected ? "bg-accent-soft ring-accent/35 ring-1" : "hover:bg-canvas"}`}
                >
                  <BrandMark identity={getBrandIdentity(station.brand)} />
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block truncate text-sm font-semibold">
                      {station.brand ?? "Sin rótulo"}
                    </span>
                    <span className="text-muted mt-0.5 block truncate text-xs">
                      {station.municipality}
                      {station.distanceKm !== null
                        ? ` · ${station.distanceKm.toFixed(1)} km`
                        : ""}
                    </span>
                  </span>
                  {rankPositions.has(station.id) ? (
                    <RankBadge
                      position={rankPositions.get(station.id)!}
                      context={RANKING_SCOPE_CONTEXT[rankingScope]}
                    />
                  ) : null}
                  <span
                    className={`shrink-0 text-[0.9375rem] font-semibold tabular-nums ${selected ? "text-accent-strong" : "text-ink"}`}
                  >
                    {formatPrice(Number(station.fuels[fuel]))}
                    <PriceUnitLabel unit={unit} visuallyHidden />
                  </span>
                </button>
              );
            })}
            {!loading && results.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <SearchIcon className="text-muted mx-auto size-5" />
                <p className="text-ink mt-2 text-sm font-medium">
                  No hay estaciones que cumplan estos filtros.
                </p>
                <p className="text-muted mt-1 text-xs">
                  Prueba otro combustible o amplía el rango de precio.
                </p>
              </div>
            ) : null}
            {results.length > RESULT_LIMIT ? (
              <p className="text-muted px-3 pt-2 pb-1 text-xs leading-5">
                Se muestran las primeras {RESULT_LIMIT}; afina la búsqueda para
                reducir la lista.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <MapAttribution manifest={manifest} />
    </main>
  );
}
