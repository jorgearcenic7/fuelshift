"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type GeoJSONSource,
  Map as MapLibreMap,
  type MapLayerMouseEvent,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";

import type { Coordinates, FuelCode, StationResult } from "@/domain/stations";
import { getStationPrice } from "@/domain/stations";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
setWorkerUrl(
  new URL(
    "maplibre-gl/dist/maplibre-gl-worker.mjs",
    import.meta.url,
  ).toString(),
);
const EMPTY_COLLECTION: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

function toGeoJson(
  stations: readonly StationResult[],
  fuel: FuelCode,
  selectedId: string | null,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [station.location.longitude, station.location.latitude],
      },
      properties: {
        id: station.id,
        brand: station.brand ?? "Sin rótulo",
        price: getStationPrice(station, fuel),
        selected: station.id === selectedId ? 1 : 0,
      },
    })),
  };
}

interface StationMapProps {
  stations: readonly StationResult[];
  fuel: FuelCode;
  selectedId: string | null;
  userLocation: Coordinates | null;
  onSelect: (stationId: string) => void;
}

export function StationMap({
  stations,
  fuel,
  selectedId,
  userLocation,
  onSelect,
}: StationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef =
    useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>(EMPTY_COLLECTION);
  const onSelectRef = useRef(onSelect);
  const [providerError, setProviderError] = useState(false);
  const geoJson = useMemo(
    () => toGeoJson(stations, fuel, selectedId),
    [stations, fuel, selectedId],
  );

  const stationsRef = useRef(stations);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);

  useEffect(() => {
    dataRef.current = geoJson;
    const source = mapRef.current?.getSource("stations") as
      | GeoJSONSource
      | undefined;
    source?.setData(geoJson);
  }, [geoJson]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-3.7, 40.2],
      zoom: 5.1,
      minZoom: 4,
      maxZoom: 18,
      maxBounds: [
        [-20.5, 25.5],
        [6, 45.5],
      ],
      attributionControl: {},
    });
    mapRef.current = map;
    let styleLoaded = false;
    // Un fallo aislado de una tesela no inutiliza el mapa; solo se avisa si el
    // estilo del proveedor no llega a cargarse.
    map.on("error", () => {
      if (!styleLoaded) setProviderError(true);
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    const timeout = window.setTimeout(() => {
      if (!map.loaded()) setProviderError(true);
    }, 12_000);

    map.once("load", () => {
      styleLoaded = true;
      window.clearTimeout(timeout);
      setProviderError(false);
      map.addSource("stations", {
        type: "geojson",
        data: dataRef.current,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 44,
      });
      map.addLayer({
        id: "station-clusters",
        type: "circle",
        source: "stations",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#1f6f8b",
            100,
            "#15578a",
            500,
            "#103f73",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            100,
            23,
            500,
            29,
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "station-cluster-count",
        type: "symbol",
        source: "stations",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          // Fuente servida por OpenFreeMap; la predeterminada de MapLibre no existe allí.
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "station-points",
        type: "circle",
        source: "stations",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "case",
            ["==", ["get", "selected"], 1],
            "#f59e0b",
            "#0b806f",
          ],
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 10, 7],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      map.on("click", "station-clusters", async (event: MapLayerMouseEvent) => {
        const feature = map.queryRenderedFeatures(event.point, {
          layers: ["station-clusters"],
        })[0];
        const clusterId = feature?.properties?.cluster_id as number | undefined;
        const coordinates =
          feature?.geometry.type === "Point"
            ? feature.geometry.coordinates
            : null;
        if (clusterId === undefined || !coordinates) return;
        const source = map.getSource("stations") as GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({ center: coordinates as [number, number], zoom });
      });
      map.on("click", "station-points", (event: MapLayerMouseEvent) => {
        const stationId = event.features?.[0]?.properties?.id as
          | string
          | undefined;
        if (stationId) onSelectRef.current(stationId);
      });
      for (const layer of ["station-clusters", "station-points"]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      window.clearTimeout(timeout);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!userLocation || !mapRef.current) return;
    const marker = new Marker({ color: "#2563eb" })
      .setLngLat([userLocation.longitude, userLocation.latitude])
      .setPopup(new Popup().setText("Tu ubicación aproximada"))
      .addTo(mapRef.current);
    return () => {
      marker.remove();
    };
  }, [userLocation]);

  // Centra el mapa solo cuando cambia la selección, no cada vez que se filtran
  // los resultados.
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const station = stationsRef.current.find(
      (candidate) => candidate.id === selectedId,
    );
    if (station) {
      mapRef.current.easeTo({
        center: [station.location.longitude, station.location.latitude],
        zoom: Math.max(mapRef.current.getZoom(), 13),
      });
    }
  }, [selectedId]);

  return (
    <div className="relative h-full min-h-[26rem] overflow-hidden bg-slate-100">
      {/* MapLibre fuerza position: relative sobre su contenedor, así que el
          posicionamiento absoluto va en un envoltorio propio. */}
      <div className="absolute inset-0">
        <div
          ref={containerRef}
          className="h-full w-full"
          role="region"
          aria-label="Mapa interactivo de gasolineras. Los resultados también están disponibles como lista accesible."
        />
      </div>
      {providerError ? (
        <div
          className="absolute inset-x-4 top-4 z-10 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-lg"
          role="alert"
        >
          <strong className="block font-semibold">
            El mapa base no está disponible.
          </strong>
          Puedes seguir consultando las estaciones y sus precios en la lista.
        </div>
      ) : null}
    </div>
  );
}
