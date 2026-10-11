"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  loadMitecoManifest,
  loadMitecoStations,
  type MitecoManifest,
} from "@/data/miteco";
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
  type Station,
  type StationSort,
} from "@/domain/stations";
import { getBrandIdentity } from "@/domain/brands";

import { BrandMark } from "./brand-mark";

import {
  AlertIcon,
  ClockIcon,
  CloseIcon,
  CursorIcon,
  LocateIcon,
  PinIcon,
  RouteIcon,
  SearchIcon,
} from "./icons";
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
// Coincide con el punto de ruptura `xl` de Tailwind, donde el mapa y la
// lista se muestran a la vez.
const SIDE_BY_SIDE_QUERY = "(min-width: 80rem)";

const fieldLabel = "mb-1.5 block text-xs font-medium text-muted";
const noticeClass =
  "mt-4 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm leading-5 text-amber-950";

function formatPrice(rawPrice: string): string {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number(rawPrice));
}

function formatRetrievedAt(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
}

function isStale(retrievedAt: string): boolean {
  const age = Date.now() - new Date(retrievedAt).getTime();
  return Number.isFinite(age) && age > 48 * 60 * 60 * 1000;
}

/** Municipio y, si es distinta, la localidad comunicada por MITECO. */
function placeLabel(station: Station): string {
  return station.locality &&
    normalizeSearch(station.locality) !== normalizeSearch(station.municipality)
    ? `${station.municipality} · ${station.locality}`
    : station.municipality;
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

function directionsUrl(
  station: Station,
  userLocation: Coordinates | null,
): string {
  const destination = `${station.location.latitude},${station.location.longitude}`;
  const origin = userLocation
    ? `${userLocation.latitude},${userLocation.longitude}`
    : "";
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(origin)}%3B${encodeURIComponent(destination)}`;
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
  const filtersActive =
    search.trim() !== "" || brand !== "" || minPrice !== "" || maxPrice !== "";
  const rankingContext =
    loading && stations.length === 0
      ? "Cargando datos oficiales…"
      : ranking === null
        ? "La zona visible estará disponible cuando cargue el mapa."
        : ranking.total === 0
          ? rankingScope === "visible"
            ? `No hay estaciones con precio de ${FUEL_LABELS[fuel]} en la zona visible. Mueve o aleja el mapa.`
            : `No hay estaciones con precio de ${FUEL_LABELS[fuel]} para estos filtros.`
          : `Las ${ranking.entries.length} más baratas de ${ranking.total.toLocaleString("es-ES")} estaciones ${RANKING_SCOPE_CONTEXT[rankingScope]}${filtersActive ? ", con los filtros activos" : ""}.`;

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

  const dataStatus = loading
    ? `Cargando ${loadedProvinces}${manifest ? ` de ${manifest.province_count}` : ""} provincias…`
    : loadError
      ? loadError
      : `${stations.length.toLocaleString("es-ES")} estaciones cargadas`;
  const statusTone = loadError
    ? "bg-rose-50 text-rose-800 ring-rose-200"
    : loading
      ? "bg-amber-50 text-amber-900 ring-amber-200"
      : "bg-positive-soft text-positive ring-emerald-200";
  const statusDot = loadError
    ? "bg-rose-500"
    : loading
      ? "animate-pulse bg-amber-500"
      : "bg-positive";

  return (
    <main
      id="contenido"
      className="flex flex-col xl:grid xl:h-[calc(100dvh-3.5rem)] xl:grid-cols-[25rem_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)_auto] xl:overflow-hidden"
    >
      {/* Columna lateral: en escritorio filtros y resultados se desplazan
          juntos; en pantallas estrechas `contents` deja que el mapa se
          intercale entre ambos. */}
      <div className="xl:border-line contents xl:col-start-1 xl:row-start-1 xl:flex xl:min-h-0 xl:flex-col xl:overflow-y-auto xl:border-r xl:bg-white">
        {/* Presentación, estado de los datos y filtros */}
        <section
          aria-labelledby="map-title"
          className="border-line bg-surface order-1 border-b px-4 pt-5 pb-5 sm:px-[max(1.5rem,calc((100%-48rem)/2))] xl:px-5"
        >
          <p className="text-accent text-[0.6875rem] font-semibold tracking-[0.14em] uppercase">
            Precios oficiales de carburantes
          </p>
          <h1
            id="map-title"
            className="text-ink mt-1 text-[1.6rem] leading-tight font-semibold tracking-[-0.03em]"
          >
            Gasolineras de España
          </h1>

          <div className="mt-3 space-y-1.5" aria-live="polite">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusTone}`}
            >
              <span
                className={`size-1.5 rounded-full ${statusDot}`}
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

          {manifest && isStale(manifest.retrieved_at) ? (
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

          <div className="border-line mt-5 border-t pt-4">
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

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3.5">
              <div className="col-span-2">
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

              <fieldset className="col-span-2">
                <legend className={fieldLabel}>Combustible</legend>
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
                  Rango de precio{" "}
                  <span className="font-normal">(unidad no acreditada)</span>
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
        </section>

        {/* Ranking por precio */}
        <section
          aria-labelledby="ranking-title"
          className="border-line bg-surface order-3 border-b px-4 py-4 sm:px-[max(1.5rem,calc((100%-48rem)/2))] xl:px-5"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="ranking-title" className="text-ink text-sm font-semibold">
              Ranking por precio
            </h2>
            <span className="text-muted text-xs">
              Top {RANKING_SIZE} · {FUEL_LABELS[fuel]}
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
              {ranking.entries.map(({ station, position }) => {
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
                        {formatPrice(station.fuels[fuel]!)}
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
          className="border-line bg-surface order-4 flex flex-col border-b xl:flex-1 xl:border-b-0"
        >
          <div className="border-line bg-surface/95 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur sm:px-[max(1.5rem,calc((100%-48rem)/2))] xl:sticky xl:top-0 xl:z-10 xl:px-5">
            <h2 id="results-title" className="text-ink text-sm font-semibold">
              Resultados
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
                    {formatPrice(station.fuels[fuel]!)}
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

      {/* Atribución de datos y cartografía */}
      <footer className="border-line bg-surface text-muted order-5 space-y-1 px-4 py-4 text-[0.6875rem] leading-5 sm:px-[max(1.5rem,calc((100%-48rem)/2))] xl:col-start-1 xl:row-start-2 xl:border-t xl:border-r xl:px-5 xl:py-3">
        <p>
          Datos:{" "}
          {manifest ? (
            <a
              className="hover:text-ink font-medium underline underline-offset-2"
              href={manifest.source.catalog}
              target="_blank"
              rel="noreferrer"
            >
              {manifest.source.attribution}
            </a>
          ) : (
            "MITECO"
          )}
          {" · "}
          <a
            className="hover:text-ink font-medium underline underline-offset-2"
            href={
              manifest?.source.license.url ??
              "https://creativecommons.org/licenses/by/4.0/"
            }
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0
          </a>
          . Transformados y validados por FuelShift.
        </p>
        <p>
          Cartografía:{" "}
          <a
            className="hover:text-ink font-medium underline underline-offset-2"
            href="https://openfreemap.org/"
            target="_blank"
            rel="noreferrer"
          >
            OpenFreeMap
          </a>{" "}
          · OpenMapTiles ·{" "}
          <a
            className="hover:text-ink font-medium underline underline-offset-2"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap
          </a>
        </p>
      </footer>

      {/* Mapa y ficha de estación */}
      <div
        ref={mapAreaRef}
        className="relative order-2 scroll-mt-2 xl:col-start-2 xl:row-span-2 xl:row-start-1"
      >
        <div className="relative h-[62svh] min-h-[22rem] xl:absolute xl:inset-0 xl:h-auto xl:min-h-0">
          <StationMap
            stations={results}
            fuel={fuel}
            selectedId={selectedId}
            userLocation={userLocation}
            onSelect={setSelectedId}
            onBoundsChange={setMapBounds}
          />
          {loading && !loadError ? (
            <div
              className="text-ink pointer-events-none absolute top-4 left-4 z-10 inline-flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-xs font-medium shadow-[0_6px_20px_-8px_rgb(15_29_46/40%)] backdrop-blur"
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
                  {loadError} Prepara una copia local validada para explorar el
                  mapa.
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
                  Pulsa un marcador o un resultado para consultar su dirección,
                  horario y todos los precios comunicados.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function StationDetail({
  station,
  fuel,
  userLocation,
  rankPosition,
  rankingContext,
  onClose,
}: {
  station: Station;
  fuel: FuelCode;
  userLocation: Coordinates | null;
  rankPosition: number | null;
  rankingContext: string;
  onClose: () => void;
}) {
  const selectedPrice = getStationPrice(station, fuel);
  const availablePrices = Object.entries(station.fuels) as [FuelCode, string][];
  const identity = getBrandIdentity(station.brand);

  return (
    <div>
      {/* El color de marca se usa solo como acento. */}
      <div
        className="h-1.5"
        style={{ backgroundColor: identity.color }}
        aria-hidden="true"
      />
      <div className="p-5">
        <div className="flex items-start gap-3">
          <BrandMark identity={identity} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-muted text-[0.6875rem] font-semibold tracking-[0.12em] uppercase">
              {station.provinceName}
            </p>
            <h2
              id="station-detail-title"
              className="text-ink mt-0.5 text-xl leading-tight font-semibold tracking-[-0.02em]"
            >
              {station.brand ?? "Sin rótulo"}
            </h2>
            <p className="text-muted mt-1 text-xs">
              {identity.known ? `${identity.name} · ` : ""}Estación MITECO{" "}
              {station.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:bg-canvas hover:text-ink -mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg transition-colors"
            aria-label="Cerrar ficha de la estación"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        {selectedPrice !== null ? (
          <div
            className="border-line bg-canvas/70 mt-4 rounded-xl border border-l-4 px-4 py-4"
            style={{ borderLeftColor: identity.color }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink text-sm font-medium">
                {FUEL_LABELS[fuel]}
              </p>
              {rankPosition !== null ? (
                <span className="bg-positive-soft text-positive rounded-full px-2 py-0.5 text-xs font-semibold">
                  #{rankPosition} {rankingContext}
                </span>
              ) : null}
            </div>
            <p className="text-ink mt-1.5 text-[2.75rem] leading-none font-bold tracking-[-0.035em] tabular-nums">
              {formatPrice(station.fuels[fuel]!)}
            </p>
            <p className="text-muted mt-2.5 text-[0.6875rem] leading-4">
              Precio comunicado · unidad no acreditada por el contrato REST
            </p>
          </div>
        ) : null}

        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex gap-3">
            <dt className="text-muted mt-0.5">
              <PinIcon className="size-4" />
              <span className="sr-only">Dirección</span>
            </dt>
            <dd className="text-ink leading-5">
              {station.address}
              <span className="text-muted block text-xs">
                {station.postal_code ? `${station.postal_code} · ` : ""}
                {station.municipality}
                {station.locality && station.locality !== station.municipality
                  ? ` · ${station.locality}`
                  : ""}
              </span>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-muted mt-0.5">
              <ClockIcon className="size-4" />
              <span className="sr-only">Horario comunicado</span>
            </dt>
            <dd className="text-ink leading-5">
              {station.opening_hours ?? "Horario no comunicado"}
            </dd>
          </div>
        </dl>

        <a
          href={directionsUrl(station, userLocation)}
          target="_blank"
          rel="noreferrer"
          className="bg-accent hover:bg-accent-strong mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[0.625rem] px-4 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgb(31_98_176/70%)] transition-colors"
        >
          <RouteIcon className="size-4" />
          Obtener indicaciones
          <span className="sr-only">(se abre en una pestaña nueva)</span>
        </a>

        <section
          className="border-line mt-5 border-t pt-4"
          aria-labelledby="available-prices-title"
        >
          <h3
            id="available-prices-title"
            className="text-muted text-xs font-semibold tracking-[0.08em] uppercase"
          >
            Precios disponibles
          </h3>
          <ul className="mt-2">
            {availablePrices.map(([code, price]) => {
              const current = code === fuel;
              return (
                <li
                  className={`flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm ${current ? "bg-canvas" : ""}`}
                  key={code}
                >
                  <span
                    className={current ? "text-ink font-medium" : "text-muted"}
                  >
                    {FUEL_LABELS[code]}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${current ? "text-accent-strong" : "text-ink"}`}
                  >
                    {formatPrice(price)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-muted mt-3 text-[0.6875rem] leading-4">
            MITECO comunica una fecha global del conjunto, no una fecha
            individual para esta estación o cada precio.
          </p>
        </section>
      </div>
    </div>
  );
}
