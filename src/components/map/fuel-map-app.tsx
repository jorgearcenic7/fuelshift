"use client";

import { useEffect, useMemo, useState } from "react";

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
  type Coordinates,
  type FuelCode,
  type Station,
  type StationSort,
} from "@/domain/stations";

import { StationMap } from "./station-map";

const RESULT_LIMIT = 50;

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

  function changeFuel(nextFuel: FuelCode) {
    setFuel(nextFuel);
    setBrand("");
    setSelectedId(null);
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

  return (
    <main
      id="contenido"
      className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 lg:px-7 lg:py-6"
    >
      <section aria-labelledby="map-title">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-accent text-xs font-bold tracking-[0.16em] uppercase">
              Precios oficiales de carburantes
            </p>
            <h1
              id="map-title"
              className="text-ink mt-1 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl"
            >
              Gasolineras de España
            </h1>
          </div>
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600"
            aria-live="polite"
          >
            <span className="inline-flex items-center gap-2">
              <span
                className={`size-2 rounded-full ${loadError ? "bg-rose-500" : loading ? "animate-pulse bg-amber-500" : "bg-emerald-500"}`}
                aria-hidden="true"
              />
              {dataStatus}
            </span>
            {manifest ? (
              <>
                <span>
                  Descarga: {formatRetrievedAt(manifest.retrieved_at)}
                </span>
                <span>
                  MITECO: {manifest.source.reported_at.raw} (zona no indicada)
                </span>
              </>
            ) : null}
          </div>
        </div>

        {manifest && isStale(manifest.retrieved_at) ? (
          <div
            className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
          >
            Estos datos se descargaron hace más de 48 horas. Comprueba su
            antigüedad antes de tomar una decisión.
          </div>
        ) : null}
        {failedProvinces.length > 0 ? (
          <div
            className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="alert"
          >
            No se pudieron cargar {failedProvinces.length} provincias. Los
            resultados visibles están incompletos.
          </div>
        ) : null}

        <div className="border-line bg-surface grid min-h-[calc(100vh-12rem)] overflow-hidden rounded-2xl border shadow-[0_18px_50px_-34px_rgba(15,43,70,0.45)] xl:grid-cols-[19rem_minmax(28rem,1fr)_21rem]">
          <aside
            className="border-line border-b bg-slate-50/80 p-4 xl:border-r xl:border-b-0"
            aria-labelledby="filters-title"
          >
            <div className="flex items-center justify-between">
              <h2 id="filters-title" className="font-semibold text-slate-900">
                Buscar y filtrar
              </h2>
              <button
                type="button"
                className="text-accent rounded px-1 text-xs font-semibold hover:underline"
                onClick={() => {
                  setSearch("");
                  setBrand("");
                  setMinPrice("");
                  setMaxPrice("");
                }}
              >
                Limpiar
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="fuel"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Combustible
                </label>
                <select
                  id="fuel"
                  value={fuel}
                  onChange={(event) =>
                    changeFuel(event.target.value as FuelCode)
                  }
                  className="control"
                >
                  {PRIMARY_FUELS.map((code) => (
                    <option value={code} key={code}>
                      {FUEL_LABELS[code]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="station-search"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Municipio, marca o dirección
                </label>
                <input
                  id="station-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="control"
                  placeholder="Ej. Toledo, Repsol…"
                  autoComplete="off"
                />
              </div>
              <div>
                <label
                  htmlFor="brand"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Marca
                </label>
                <select
                  id="brand"
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  className="control"
                >
                  <option value="">Todas las marcas</option>
                  {brands.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-slate-700">
                  Rango de precio{" "}
                  <span className="font-normal text-slate-500">
                    (unidad no acreditada)
                  </span>
                </legend>
                <div className="grid grid-cols-2 gap-2">
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
              <div>
                <label
                  htmlFor="sort"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
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
              <button
                type="button"
                onClick={requestLocation}
                className="border-line bg-surface text-ink hover:border-accent w-full rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors"
              >
                {userLocation ? "Ubicación activada" : "Usar mi ubicación"}
              </button>
              <p
                className="min-h-5 text-xs leading-5 text-slate-500"
                role="status"
                aria-live="polite"
              >
                {locationStatus ??
                  "Solo se solicitará permiso al pulsar el botón."}
              </p>
            </div>

            <div className="border-line mt-5 border-t pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Resultados
                </h3>
                <span className="text-xs text-slate-500 tabular-nums">
                  {results.length.toLocaleString("es-ES")}
                </span>
              </div>
              <div
                className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1 xl:max-h-[calc(100vh-39rem)]"
                aria-label="Lista de estaciones"
              >
                {results.slice(0, RESULT_LIMIT).map((station) => (
                  <button
                    type="button"
                    key={`${station.provinceId}-${station.id}`}
                    onClick={() => setSelectedId(station.id)}
                    aria-pressed={selectedId === station.id}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedId === station.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">
                          {station.brand ?? "Sin rótulo"}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {station.municipality}
                        </span>
                      </span>
                      <span className="text-accent shrink-0 text-sm font-bold tabular-nums">
                        {formatPrice(station.fuels[fuel]!)}
                      </span>
                    </span>
                    {station.distanceKm !== null ? (
                      <span className="mt-1 block text-xs text-slate-500">
                        {station.distanceKm.toFixed(1)} km
                      </span>
                    ) : null}
                  </button>
                ))}
                {!loading && results.length === 0 ? (
                  <p className="rounded-lg bg-white p-3 text-sm text-slate-600">
                    No hay estaciones que cumplan estos filtros.
                  </p>
                ) : null}
              </div>
              {results.length > RESULT_LIMIT ? (
                <p className="mt-2 text-xs text-slate-500">
                  Se muestran las primeras {RESULT_LIMIT}; afina la búsqueda
                  para reducir la lista.
                </p>
              ) : null}
            </div>
          </aside>

          <div className="relative min-h-[32rem] xl:min-h-0">
            <StationMap
              stations={results}
              fuel={fuel}
              selectedId={selectedId}
              userLocation={userLocation}
              onSelect={setSelectedId}
            />
            {loadError ? (
              <div
                className="absolute inset-x-4 top-4 z-20 rounded-xl border border-slate-300 bg-white/95 p-4 text-sm text-slate-700 shadow-lg"
                role="alert"
              >
                <strong className="block text-slate-900">
                  No hay datos oficiales disponibles
                </strong>
                <span className="mt-1 block">
                  {loadError} Prepara una copia local validada para explorar el
                  mapa.
                </span>
              </div>
            ) : null}
          </div>

          <aside
            className="border-line border-t bg-white p-5 xl:border-t-0 xl:border-l"
            aria-labelledby="station-detail-title"
          >
            {selectedStation ? (
              <StationDetail
                station={selectedStation}
                fuel={fuel}
                userLocation={userLocation}
              />
            ) : (
              <div className="flex h-full min-h-48 flex-col justify-center">
                <span
                  className="bg-accent-soft text-accent grid size-10 place-items-center rounded-xl text-lg"
                  aria-hidden="true"
                >
                  ⌖
                </span>
                <h2
                  id="station-detail-title"
                  className="mt-4 text-lg font-semibold text-slate-900"
                >
                  Selecciona una estación
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Pulsa un marcador o un resultado para consultar su dirección,
                  horario y todos los precios comunicados.
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>

      <footer className="flex flex-col gap-3 px-2 py-5 text-xs leading-5 text-slate-600 sm:flex-row sm:justify-between">
        <p>
          Datos:{" "}
          {manifest ? (
            <a
              className="font-medium underline hover:no-underline"
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
            className="font-medium underline hover:no-underline"
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
            className="font-medium underline hover:no-underline"
            href="https://openfreemap.org/"
            target="_blank"
            rel="noreferrer"
          >
            OpenFreeMap
          </a>{" "}
          · OpenMapTiles ·{" "}
          <a
            className="font-medium underline hover:no-underline"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap
          </a>
        </p>
      </footer>
    </main>
  );
}

function StationDetail({
  station,
  fuel,
  userLocation,
}: {
  station: Station;
  fuel: FuelCode;
  userLocation: Coordinates | null;
}) {
  const selectedPrice = getStationPrice(station, fuel);
  const availablePrices = Object.entries(station.fuels) as [FuelCode, string][];

  return (
    <div>
      <p className="text-accent text-xs font-bold tracking-[0.12em] uppercase">
        {station.provinceName}
      </p>
      <h2
        id="station-detail-title"
        className="mt-2 text-xl font-semibold tracking-[-0.025em] text-slate-950"
      >
        {station.brand ?? "Sin rótulo"}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Estación MITECO {station.id}
      </p>

      {selectedPrice !== null ? (
        <div className="bg-accent-soft mt-5 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-600">
            {FUEL_LABELS[fuel]}
          </p>
          <p className="text-accent mt-1 text-3xl font-bold tabular-nums">
            {formatPrice(station.fuels[fuel]!)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Precio comunicado · unidad no acreditada por el contrato REST
          </p>
        </div>
      ) : null}

      <dl className="mt-5 space-y-4 text-sm">
        <div>
          <dt className="font-medium text-slate-500">Dirección</dt>
          <dd className="mt-1 leading-6 text-slate-900">
            {station.address}
            <br />
            {station.postal_code ? `${station.postal_code} · ` : ""}
            {station.municipality}
            {station.locality && station.locality !== station.municipality
              ? ` · ${station.locality}`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Horario comunicado</dt>
          <dd className="mt-1 leading-6 text-slate-900">
            {station.opening_hours ?? "No comunicado"}
          </dd>
        </div>
      </dl>

      <a
        href={directionsUrl(station, userLocation)}
        target="_blank"
        rel="noreferrer"
        className="bg-accent mt-5 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
      >
        Obtener indicaciones
        <span aria-hidden="true" className="ml-2">
          ↗
        </span>
      </a>

      <section
        className="border-line mt-6 border-t pt-5"
        aria-labelledby="available-prices-title"
      >
        <h3
          id="available-prices-title"
          className="font-semibold text-slate-900"
        >
          Precios disponibles
        </h3>
        <ul className="mt-3 divide-y divide-slate-100">
          {availablePrices.map(([code, price]) => (
            <li
              className="flex items-center justify-between gap-3 py-2.5 text-sm"
              key={code}
            >
              <span className="text-slate-600">{FUEL_LABELS[code]}</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {formatPrice(price)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          MITECO comunica una fecha global del conjunto, no una fecha individual
          para esta estación o cada precio.
        </p>
      </section>
    </div>
  );
}
