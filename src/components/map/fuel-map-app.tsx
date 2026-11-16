"use client";

// Pantalla principal del mapa. Carga el manifiesto y las provincias de MITECO,
// y coordina buscador, filtros, lista de resultados, ranking, mapa de calor y
// ficha de la estación seleccionada.

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import { PriceUnitLabel } from "@/components/price-unit";
import { Segmented } from "@/components/segmented";
import {
  loadMitecoManifest,
  loadMitecoStations,
  type MitecoManifest,
} from "@/data/miteco";
import { getBrandIdentity } from "@/domain/brands";
import { isStale } from "@/domain/freshness";
import { summarizePrices } from "@/domain/fuel-statistics";
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
  getStationPrice,
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
import { AlertIcon, LocateIcon, SearchIcon, SlidersIcon } from "./icons";
import { MapAttribution } from "./map-attribution";
import { MobileMapLegend } from "./mobile-map-legend";
import type { MapView } from "./price-heatmap-layer";
import { PriceHeatmapLegend } from "./price-heatmap-legend";
import { StationColorLegend } from "./station-color-legend";
import { StationDetail } from "./station-detail";
import { StationMap } from "./station-map";

/** Estaciones de la lista por tanda; «Mostrar más estaciones» añade otra. */
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
const FUEL_OPTIONS: readonly [FuelCode, string][] = PRIMARY_FUELS.map(
  (code) => [code, FUEL_LABELS[code]],
);

const fieldLabel = "mb-1.5 block text-[0.75rem] font-bold text-muted";
const noticeClass =
  "flex gap-2.5 rounded-xl bg-amber-50 px-3.5 pt-3 pb-2.5 text-[0.875rem] leading-5 text-amber-950";
const STATUS_STYLES = {
  error: { tone: "bg-rose-50 text-rose-800", dot: "bg-rose-500" },
  loading: {
    tone: "bg-amber-50 text-amber-900",
    dot: "animate-pulse bg-amber-500",
  },
  ready: {
    tone: "bg-positive-soft text-positive-strong",
    dot: "bg-positive",
  },
} as const;

/** Municipio y, si es distinta, la localidad comunicada por MITECO. */
// «Municipio · Localidad» solo cuando la localidad aporta algo distinto.
function placeLabel(station: Station): string {
  return station.locality &&
    normalizeSearch(station.locality) !== normalizeSearch(station.municipality)
    ? `${station.municipality} · ${station.locality}`
    : station.municipality;
}

// Texto de estado de la carga que se anuncia también a lectores de pantalla.
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
      className={`num inline-flex h-[1.375rem] min-w-[1.875rem] shrink-0 items-center justify-center rounded-[0.4375rem] px-1.5 pt-0.5 text-[0.75rem] font-extrabold ${position === 1 ? "bg-positive text-white" : "bg-accent-soft text-accent-strong"}`}
    >
      <span className="sr-only">Puesto </span>
      <span aria-hidden="true">#</span>
      {position}
      {context ? <span className="sr-only"> del ranking {context}</span> : null}
    </span>
  );
}

/** Solo el ratón resalta: en táctil, el «hover» quedaría pegado tras tocar. */
function mouseOnly(handler: () => void) {
  return (event: PointerEvent) => {
    if (event.pointerType === "mouse") handler();
  };
}

const ChevronRight = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="row-go text-muted size-3.5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
);

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
  // Última ficha abierta: se sigue pintando mientras sale, para que la ficha
  // vuelva por el mismo camino por el que entró.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Adónde llevar el foco tras el próximo cambio de vista del panel.
  const focusRequest = useRef<
    { to: "detail" } | { to: "row"; stationId: string } | null
  >(null);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [rankingScope, setRankingScope] = useState<RankingScope>("visible");
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [mapView, setMapView] = useState<MapView>("stations");
  // Solo afecta a móvil: en escritorio los filtros siempre se ven.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Hoja inferior de móvil: asomada (el mapa a la vista) o abierta.
  const [sheetExpanded, setSheetExpanded] = useState(false);
  // Tamaño de la lista. Vuelve a la primera tanda al cambiar la búsqueda, los
  // filtros, el combustible o el orden.
  const [listSize, setListSize] = useState({ key: "", count: RESULT_LIMIT });

  // Carga única al montar: primero el manifiesto y después las provincias, que
  // se van añadiendo al mapa según llegan. Al desmontar se cancela todo.
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
  const detailStation = detailId
    ? (stations.find((station) => station.id === detailId) ?? null)
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
  // Se calcula tras la carga, una vez por combustible: la usan el mapa de
  // calor, el color de cada estación y la ficha. Fuera de la vista de calor va
  // en un render diferido, para no retrasar el primer pintado ni el cambio de
  // combustible; en la vista de calor es inmediata, como siempre.
  const dataReady = !loading && !loadError;
  const deferredFuel = useDeferredValue(fuel);
  const deferredReady = useDeferredValue(dataReady);
  const scaleFuel = mapView === "heat" ? fuel : deferredFuel;
  const scaleReady = mapView === "heat" ? dataReady : deferredReady;
  const computedHeatmap = useMemo(
    () =>
      scaleReady && dataReady ? buildPriceHeatmap(stations, scaleFuel) : null,
    [scaleReady, dataReady, stations, scaleFuel],
  );
  // Mientras se recalcula tras cambiar de combustible no se usa la anterior.
  const nationalHeatmap =
    computedHeatmap?.fuel === fuel ? computedHeatmap : null;
  // Media nacional del combustible, solo con la carga completa: con
  // provincias caídas no sería la media de España.
  const nationalMean = useMemo(() => {
    if (loading || loadError || failedProvinces.length > 0) return null;
    const prices = stations.flatMap((station) => {
      const price = getStationPrice(station, fuel);
      return price !== null && price > 0 ? [price] : [];
    });
    return summarizePrices(prices)?.mean ?? null;
  }, [loading, loadError, failedProvinces, stations, fuel]);
  // Las estaciones representadas son las de la lista (combustible y filtros).
  // El valor diferido evita que escribir en la búsqueda espere al recálculo.
  const deferredResults = useDeferredValue(results);
  const heatmap = useMemo(
    () =>
      nationalHeatmap && mapView === "heat"
        ? buildFilteredHeatmap(nationalHeatmap, deferredResults, filtersActive)
        : null,
    [nationalHeatmap, mapView, deferredResults, filtersActive],
  );
  const listKey = [fuel, search, brand, minPrice, maxPrice, sort].join("|");
  const visibleCount = listSize.key === listKey ? listSize.count : RESULT_LIMIT;
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

  // Abre la ficha desde la lista, el ranking o el mapa. El foco acompaña a la
  // vista: sin esto, el siguiente Tab volvería a la lista y un lector de
  // pantalla no anunciaría la ficha.
  function selectStation(stationId: string) {
    if (stationId === selectedId) {
      document.getElementById("station-detail-title")?.focus({
        preventScroll: true,
      });
      return;
    }
    focusRequest.current = { to: "detail" };
    setSelectedId(stationId);
    setDetailId(stationId);
  }

  // Vuelve a la lista y devuelve el foco a la fila de la estación.
  function closeDetail() {
    if (!selectedId) return;
    focusRequest.current = { to: "row", stationId: selectedId };
    setSelectedId(null);
  }

  // El foco se mueve justo después de pintar la vista nueva, sin esperar a un
  // fotograma: la ficha al abrirla y la fila de origen al volver.
  useEffect(() => {
    const request = focusRequest.current;
    if (request === null) return;
    focusRequest.current = null;
    if (request.to === "detail") {
      document
        .getElementById("station-detail-title")
        ?.focus({ preventScroll: true });
    } else {
      document
        .querySelector<HTMLElement>(`[data-station-row="${request.stationId}"]`)
        ?.focus();
    }
  }, [selectedId]);

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
  const showDetail = selectedStation !== null;

  return (
    <main
      id="contenido"
      data-sheet-expanded={sheetExpanded}
      className="map-workspace relative h-[calc(100dvh-var(--header-h)-var(--tabbar-h)-env(safe-area-inset-bottom))] overflow-hidden md:grid md:h-[calc(100dvh-var(--header-h))]"
    >
      {/* Panel: en escritorio, columna fija junto al mapa; en móvil, hoja
          inferior sobre el mapa. Primero en el documento: el orden de lectura
          es buscar → resultados → ficha; el mapa es una región aparte. */}
      <aside
        aria-label="Buscar y filtrar gasolineras"
        data-expanded={sheetExpanded}
        onFocusCapture={(event) => {
          // El contenido de la hoja asomada puede quedar recortado. Al entrar
          // en él con teclado (o al tocar la búsqueda), se muestra completo.
          if (
            window.matchMedia("(max-width: 47.999rem)").matches &&
            !event.target.closest("[data-sheet-toggle]")
          ) {
            setSheetExpanded(true);
          }
        }}
        className="map-sheet border-line bg-side absolute inset-x-0 bottom-0 z-20 flex h-[calc(100%-3.5rem)] flex-col overflow-hidden rounded-t-[1.375rem] shadow-[0_-12px_30px_-16px_rgb(15_29_46/40%)] md:static md:col-start-1 md:row-start-1 md:h-full md:rounded-none md:border-r md:shadow-none"
      >
        {/* Asa de la hoja (solo móvil). */}
        <button
          type="button"
          onClick={() => setSheetExpanded((open) => !open)}
          aria-expanded={sheetExpanded}
          data-sheet-toggle
          className="group relative z-10 -mb-4 flex h-11 w-full shrink-0 items-start justify-center pt-2 md:hidden"
        >
          <span
            aria-hidden="true"
            className="h-1 w-10 rounded-full bg-[rgb(15_29_46/20%)] transition-colors group-active:bg-[rgb(15_29_46/35%)]"
          />
          <span className="sr-only">
            {sheetExpanded
              ? "Reducir el panel para ver el mapa"
              : "Ampliar el panel de resultados"}
          </span>
        </button>

        <div className="relative min-h-0 flex-1">
          {/* Vista 1: lista. Sale hacia la izquierda al abrir una ficha. */}
          <section
            aria-labelledby="map-title"
            className="panel-view"
            data-state={showDetail ? "hidden-left" : "shown"}
            inert={showDetail}
          >
            <div className="panel-scroll">
              {/* Presentación y estado de los datos */}
              <div className="map-intro flex flex-col gap-2.5 px-5 pt-2 pb-4 md:pt-5">
                <div>
                  <h1
                    id="map-title"
                    className="text-ink text-[1.375rem] leading-[1.1] font-extrabold tracking-[-0.025em] md:text-[1.5rem]"
                  >
                    Gasolineras de España
                  </h1>
                  <p className="text-muted mt-1 text-[0.875rem]">
                    Precios oficiales de carburantes
                  </p>
                </div>
                <div className="flex flex-col gap-1.5" aria-live="polite">
                  <span
                    className={`num optical inline-flex items-center gap-2 self-start rounded-full px-2.5 py-1 text-[0.8125rem] font-extrabold ${statusStyle.tone}`}
                  >
                    <span
                      className={`-mt-0.5 size-1.5 rounded-full ${statusStyle.dot}`}
                      aria-hidden="true"
                    />
                    {dataStatus}
                  </span>
                  <details className="dataset-details">
                    <summary>Origen y antigüedad del dato</summary>
                    {manifest ? (
                      <p className="num text-muted text-[0.8125rem] leading-[1.15rem]">
                        Descarga: {formatRetrievedAt(manifest.retrieved_at)}
                        <span aria-hidden="true"> · </span>
                        MITECO: {manifest.source.reported_at.raw} (zona no
                        indicada)
                      </p>
                    ) : null}
                  </details>
                </div>

                {stale ? (
                  <div className={noticeClass} role="status">
                    <AlertIcon className="mt-px size-4 shrink-0 text-amber-600" />
                    <p>
                      Estos datos se descargaron hace más de 48 horas. Comprueba
                      su antigüedad antes de tomar una decisión.
                    </p>
                  </div>
                ) : null}
                {failedProvinces.length > 0 ? (
                  <div className={noticeClass} role="alert">
                    <AlertIcon className="mt-px size-4 shrink-0 text-amber-600" />
                    <p>
                      No se pudieron cargar {failedProvinces.length} provincias.
                      Los resultados visibles están incompletos.
                    </p>
                  </div>
                ) : null}
              </div>

              {/* Buscar y filtrar */}
              <section
                aria-labelledby="filters-title"
                className="map-filters flex flex-col gap-3 px-5 pt-2 pb-5 shadow-[inset_0_1px_0_var(--line-soft)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <h2
                    id="filters-title"
                    className="text-ink optical text-[0.9375rem] font-extrabold tracking-[-0.01em] whitespace-nowrap max-[359px]:sr-only"
                  >
                    Buscar y filtrar
                  </h2>
                  <div className="flex items-center gap-3">
                    {/* Móvil: el resto de filtros se pliega para que el mapa
                        quede a la vista. En escritorio no hace falta. El
                        área táctil se amplía hasta 44 px de alto. */}
                    <button
                      type="button"
                      aria-expanded={filtersOpen}
                      aria-controls="advanced-filters"
                      onClick={() => setFiltersOpen((open) => !open)}
                      className={`filter-toggle press relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-extrabold transition-colors duration-150 ${filtersOpen ? "border-ink bg-ink text-white" : "text-ink-2 border-[rgb(15_29_46/14%)] bg-white"}`}
                    >
                      <SlidersIcon className="size-3.5" />
                      <span className="optical">Filtros</span>
                      {advancedFilterCount > 0 ? (
                        <>
                          <span className="sr-only">
                            , {advancedFilterCount} activos
                          </span>
                          <span
                            aria-hidden="true"
                            className="bg-accent num inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1.5 pt-px text-[0.6875rem] font-extrabold text-white"
                          >
                            {advancedFilterCount}
                          </span>
                        </>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="link-action press"
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
                </div>

                <div className="relative">
                  <label htmlFor="station-search" className="sr-only">
                    Municipio, marca o dirección
                  </label>
                  <SearchIcon className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2" />
                  <input
                    id="station-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="control pl-10"
                    placeholder="Municipio, marca o dirección"
                    autoComplete="off"
                  />
                </div>

                <Segmented
                  name="fuel"
                  legend="Combustible"
                  options={FUEL_OPTIONS}
                  value={fuel}
                  onChange={changeFuel}
                />

                {/* Cerrado solo se oculta: los valores se conservan. */}
                <div
                  id="advanced-filters"
                  className={`grid grid-cols-2 gap-x-3 gap-y-4 ${filtersOpen ? "" : "hidden"}`}
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
                      <span aria-hidden="true" className="font-medium">
                        {" "}
                        ({unit})
                      </span>
                      <span className="sr-only">
                        {" "}
                        en {PRICE_UNIT_NAMES[unit]}
                      </span>
                    </legend>
                    <div className="grid grid-cols-2 gap-2.5">
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
                          className="control num"
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
                          className="control num"
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
                      className={`btn w-full ${userLocation ? "bg-positive-soft text-positive-strong" : "btn-soft"}`}
                    >
                      <LocateIcon className="size-4" />
                      <span className="optical">
                        {userLocation
                          ? "Ubicación activada"
                          : "Usar mi ubicación"}
                      </span>
                    </button>
                    <p
                      className={`mt-1.5 min-h-4 text-[0.75rem] leading-4 ${userLocation ? "text-positive-strong font-bold" : "text-muted"}`}
                      role="status"
                      aria-live="polite"
                    >
                      {locationStatus ??
                        "Solo se solicitará permiso al pulsar el botón."}
                    </p>
                  </div>
                </div>
              </section>

              {/* Ranking por precio */}
              <section
                aria-labelledby="ranking-title"
                className="map-ranking flex flex-col gap-3 px-5 pt-4 pb-5 shadow-[inset_0_1px_0_var(--line-soft)]"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h2
                    id="ranking-title"
                    className="text-ink text-[0.9375rem] font-extrabold tracking-[-0.01em]"
                  >
                    Ranking por precio
                  </h2>
                  <span className="text-muted text-[0.75rem]">
                    Top {RANKING_SIZE} · {FUEL_LABELS[fuel]} · {unit}
                  </span>
                </div>
                <Segmented
                  name="ranking-scope"
                  legend="Ámbito del ranking"
                  options={RANKING_SCOPES}
                  value={rankingScope}
                  onChange={setRankingScope}
                  className="seg-sm"
                />
                <p
                  className="num text-muted text-[0.8125rem] leading-[1.15rem]"
                  aria-live="polite"
                >
                  {rankingContext}
                </p>
                {ranking && ranking.entries.length > 0 ? (
                  <ol className="-mx-2.5" aria-label="Estaciones más baratas">
                    {ranking.entries.map(({ station, price, position }) => {
                      const selected = selectedId === station.id;
                      return (
                        <li key={`${station.provinceId}-${station.id}`}>
                          <button
                            type="button"
                            onClick={() => selectStation(station.id)}
                            onPointerEnter={mouseOnly(() =>
                              setHoveredId(station.id),
                            )}
                            onPointerLeave={mouseOnly(() => setHoveredId(null))}
                            aria-pressed={selected}
                            data-hot={hoveredId === station.id}
                            className={`station-row grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ${selected ? "bg-accent-soft" : ""}`}
                          >
                            <RankBadge position={position} />
                            <BrandMark
                              identity={getBrandIdentity(station.brand)}
                            />
                            <span className="min-w-0">
                              <span className="text-ink optical block truncate text-[0.9375rem] leading-tight font-bold">
                                {station.brand ?? "Sin rótulo"}
                              </span>
                              <span className="text-muted mt-0.5 block truncate text-[0.8125rem]">
                                {placeLabel(station)}
                              </span>
                            </span>
                            <span className="num text-positive optical text-[1.25rem] leading-none font-extrabold tracking-[-0.025em]">
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
                className="flex flex-col gap-2 pt-4 pb-3 shadow-[inset_0_1px_0_var(--line-soft)]"
              >
                <div className="flex items-baseline justify-between gap-3 px-5">
                  <h2
                    id="results-title"
                    className="text-ink text-[0.9375rem] font-extrabold tracking-[-0.01em]"
                  >
                    Resultados
                    <small className="text-muted ml-1.5 text-[0.75rem] font-medium tracking-normal">
                      · precios en {unit}
                    </small>
                  </h2>
                  <span className="num text-muted text-[0.75rem] font-bold">
                    {results.length.toLocaleString("es-ES")}
                  </span>
                </div>
                <p className="text-muted px-5 text-[0.8125rem] leading-[1.15rem]">
                  <strong className="text-ink-2 font-bold">
                    Selecciona una estación.
                  </strong>{" "}
                  Pulsa un marcador o un resultado para consultar su dirección,
                  horario y todos los precios comunicados.
                </p>
                <div className="px-2.5" aria-label="Lista de estaciones">
                  {loading && results.length === 0
                    ? Array.from({ length: 5 }, (_, index) => (
                        <div
                          key={index}
                          className="flex animate-pulse items-center gap-3 rounded-xl px-2.5 py-3"
                          aria-hidden="true"
                        >
                          <div className="bg-mist size-9 rounded-[0.625rem]" />
                          <div className="flex-1 space-y-2">
                            <div className="bg-mist h-3 w-2/5 rounded" />
                            <div className="bg-mist h-2.5 w-3/5 rounded" />
                          </div>
                          <div className="bg-mist h-4 w-12 rounded" />
                        </div>
                      ))
                    : null}
                  {results.slice(0, visibleCount).map((station) => {
                    const selected = selectedId === station.id;
                    return (
                      <button
                        type="button"
                        key={`${station.provinceId}-${station.id}`}
                        data-station-row={station.id}
                        onClick={() => selectStation(station.id)}
                        onPointerEnter={mouseOnly(() =>
                          setHoveredId(station.id),
                        )}
                        onPointerLeave={mouseOnly(() => setHoveredId(null))}
                        aria-pressed={selected}
                        data-hot={hoveredId === station.id}
                        className={`station-row grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ${selected ? "bg-accent-soft" : ""}`}
                      >
                        <BrandMark identity={getBrandIdentity(station.brand)} />
                        <span className="min-w-0">
                          <span className="text-ink optical block truncate text-[0.9375rem] leading-tight font-bold">
                            {station.brand ?? "Sin rótulo"}
                          </span>
                          <span className="text-muted mt-0.5 block truncate text-[0.8125rem]">
                            {station.municipality}
                            {station.distanceKm !== null ? (
                              <span className="num text-accent-strong font-bold">
                                {` · ${station.distanceKm.toFixed(1)} km`}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        {rankPositions.has(station.id) ? (
                          <RankBadge
                            position={rankPositions.get(station.id)!}
                            context={RANKING_SCOPE_CONTEXT[rankingScope]}
                          />
                        ) : (
                          <span aria-hidden="true" />
                        )}
                        <span
                          className={`num optical text-[1.25rem] leading-none font-extrabold tracking-[-0.025em] ${selected ? "text-accent-strong" : "text-ink"}`}
                        >
                          {formatPrice(Number(station.fuels[fuel]))}
                          <PriceUnitLabel unit={unit} visuallyHidden />
                        </span>
                        <ChevronRight />
                      </button>
                    );
                  })}
                  {!loading && results.length === 0 ? (
                    <div className="px-3 py-8 text-center">
                      <SearchIcon className="text-muted mx-auto size-5" />
                      <p className="text-ink mt-2 text-[0.9375rem] font-bold">
                        No hay estaciones que cumplan estos filtros.
                      </p>
                      <p className="text-muted mt-1 text-[0.8125rem]">
                        Prueba otro combustible o amplía el rango de precio.
                      </p>
                    </div>
                  ) : null}
                  {results.length > visibleCount ? (
                    <div className="flex flex-col items-center gap-2 px-2.5 pt-3 pb-1">
                      <p className="num text-muted self-stretch text-[0.8125rem] leading-[1.15rem]">
                        Se muestran las primeras{" "}
                        {visibleCount.toLocaleString("es-ES")}; afina la
                        búsqueda para reducir la lista.
                      </p>
                      <button
                        type="button"
                        className="btn btn-soft"
                        onClick={() =>
                          setListSize({
                            key: listKey,
                            count: visibleCount + RESULT_LIMIT,
                          })
                        }
                      >
                        <span className="optical">Mostrar más estaciones</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>

              <MapAttribution manifest={manifest} />
            </div>
          </section>

          {/* Vista 2: ficha. Entra desde la derecha y sale por el mismo lado. */}
          <section
            aria-label="Ficha de la estación"
            className="panel-view"
            data-state={showDetail ? "shown" : "hidden-right"}
            inert={!showDetail}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeDetail();
            }}
          >
            <div className="panel-scroll">
              {detailStation ? (
                <StationDetail
                  station={detailStation}
                  fuel={fuel}
                  userLocation={userLocation}
                  rankPosition={rankPositions.get(detailStation.id) ?? null}
                  rankingContext={RANKING_SCOPE_CONTEXT[rankingScope]}
                  nationalMean={nationalMean}
                  nationalScale={nationalHeatmap?.scale ?? null}
                  onClose={closeDetail}
                />
              ) : null}
              <MapAttribution manifest={manifest} />
            </div>
          </section>
        </div>
      </aside>

      {/* Mapa. En móvil queda por encima de la hoja asomada. */}
      <div className="map-viewport absolute inset-x-0 top-0 md:relative md:inset-auto md:col-start-2 md:row-start-1 md:h-full">
        <StationMap
          stations={results}
          fuel={fuel}
          selectedId={selectedId}
          hoveredId={hoveredId}
          userLocation={userLocation}
          onSelect={selectStation}
          onHoverChange={setHoveredId}
          onBoundsChange={setMapBounds}
          view={mapView}
          heatmap={heatmap}
          colorScale={nationalHeatmap?.scale ?? null}
        />
        <div className="glass absolute top-3 left-3 z-10 w-[14.5rem] p-[3px]">
          <Segmented
            name="map-view"
            legend="Vista del mapa"
            options={MAP_VIEWS}
            value={mapView}
            onChange={setMapView}
            className="seg-sm seg-dark bg-transparent"
          />
        </div>
        {mapView === "stations" &&
        nationalHeatmap?.scale &&
        nationalHeatmap.scale.high - nationalHeatmap.scale.low > 1e-9 ? (
          <div className="map-legend-position absolute z-10">
            <MobileMapLegend
              key="stations"
              fuel={fuel}
              sheetExpanded={sheetExpanded}
            >
              {(expanded, onExpandedChange) => (
                <StationColorLegend
                  scale={nationalHeatmap.scale!}
                  fuel={fuel}
                  expanded={expanded}
                  onExpandedChange={onExpandedChange}
                />
              )}
            </MobileMapLegend>
          </div>
        ) : null}
        {mapView === "heat" && !loadError ? (
          <div className="map-legend-position absolute z-10">
            <MobileMapLegend
              key="heat"
              fuel={fuel}
              sheetExpanded={sheetExpanded}
            >
              {(expanded, onExpandedChange) => (
                <PriceHeatmapLegend
                  heatmap={heatmap}
                  fuel={fuel}
                  loading={loading}
                  loadingStatus={dataStatus}
                  failedProvinces={failedProvinces.length}
                  stale={stale}
                  filtersActive={filtersActive}
                  expanded={expanded}
                  onExpandedChange={onExpandedChange}
                />
              )}
            </MobileMapLegend>
          </div>
        ) : null}
        {loading && !loadError ? (
          <div
            className="glass text-ink num pointer-events-none absolute top-[4.25rem] left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-3.5 pt-2 pb-1.5 text-[0.8125rem] font-bold whitespace-nowrap md:left-3 md:translate-x-0"
            aria-hidden="true"
          >
            <span className="border-accent -mt-0.5 size-3 animate-spin rounded-full border-2 border-t-transparent" />
            {dataStatus}
          </div>
        ) : null}
        {loadError ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-white/40 p-4 backdrop-blur-[2px]">
            <div className="glass max-w-sm p-5 text-[0.9375rem]" role="alert">
              <span className="grid size-9 place-items-center rounded-xl bg-rose-50 text-rose-600">
                <AlertIcon className="size-5" />
              </span>
              <strong className="text-ink mt-3 block text-[1.0625rem] font-extrabold">
                No hay datos oficiales disponibles
              </strong>
              <span className="text-muted mt-1 block leading-6">
                {loadError} Prepara una copia local validada para explorar el
                mapa.
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
