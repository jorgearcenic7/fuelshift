"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ExpressionSpecification,
  type GeoJSONSource,
  Map as MapLibreMap,
  type MapLayerMouseEvent,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";

import type { PriceZone, PriceZoneMap } from "@/domain/price-zones";
import type {
  Coordinates,
  FuelCode,
  MapBounds,
  StationResult,
} from "@/domain/stations";
import { getStationPrice } from "@/domain/stations";

import {
  INSUFFICIENT_CLASS,
  INSUFFICIENT_STYLE,
  PRICE_CLASS_STYLES,
  describeZone,
  layerVisibility,
  toZoneGeoJson,
  type MapView,
} from "./price-zone-layer";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const CLUSTER_MAX_ZOOM = 14;
// Por encima del último nivel agrupado, para que la estación elegida se vea
// como punto propio y no dentro de un clúster.
const SELECTED_ZOOM = CLUSTER_MAX_ZOOM + 1;
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

function zonePopupContent(zone: PriceZone, fuel: FuelCode): HTMLElement {
  const { title, lines } = describeZone(zone, fuel);
  const container = document.createElement("div");
  container.className = "text-ink space-y-0.5 text-xs leading-5";
  const heading = document.createElement("strong");
  heading.className = "block text-sm font-semibold";
  heading.textContent = title;
  container.append(
    heading,
    ...lines.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }),
  );
  return container;
}

const isInsufficient: ExpressionSpecification = [
  "==",
  ["get", "priceClass"],
  INSUFFICIENT_CLASS,
];

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
  /**
   * Zona visible tras la carga y tras cada movimiento iniciado por el usuario.
   * Los desplazamientos automáticos al seleccionar una estación no la cambian.
   */
  onBoundsChange?: (bounds: MapBounds) => void;
  view?: MapView;
  /** Agregación nacional del combustible; solo se dibuja en la vista "zones". */
  priceZones?: PriceZoneMap | null;
}

export function StationMap({
  stations,
  fuel,
  selectedId,
  userLocation,
  onSelect,
  onBoundsChange,
  view = "stations",
  priceZones = null,
}: StationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef =
    useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>(EMPTY_COLLECTION);
  const onSelectRef = useRef(onSelect);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const [providerError, setProviderError] = useState(false);
  const geoJson = useMemo(
    () => toGeoJson(stations, fuel, selectedId),
    [stations, fuel, selectedId],
  );

  const stationsRef = useRef(stations);
  const zoneGeoJson = useMemo(() => toZoneGeoJson(priceZones), [priceZones]);
  const zoneDataRef = useRef(zoneGeoJson);
  const zonesByIdRef = useRef(new Map<string, PriceZone>());
  const zoneFuelRef = useRef<FuelCode>(fuel);
  const viewRef = useRef(view);
  const popupRef = useRef<Popup | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    zoneDataRef.current = zoneGeoJson;
    zonesByIdRef.current = new Map(
      priceZones?.zones.map((zone) => [zone.id, zone]) ?? [],
    );
    if (priceZones) zoneFuelRef.current = priceZones.fuel;
    popupRef.current?.remove();
    const source = mapRef.current?.getSource("price-zones") as
      | GeoJSONSource
      | undefined;
    source?.setData(zoneGeoJson);
  }, [zoneGeoJson, priceZones]);

  useEffect(() => {
    viewRef.current = view;
    popupRef.current?.remove();
    const map = mapRef.current;
    if (!map?.getLayer("station-points")) return;
    for (const [layer, visibility] of Object.entries(layerVisibility(view))) {
      map.setLayoutProperty(layer, "visibility", visibility);
    }
  }, [view]);

  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);

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
    map.addControl(
      new NavigationControl({ showCompass: false }),
      "bottom-right",
    );
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    function emitBounds() {
      const bounds = map.getBounds();
      onBoundsChangeRef.current?.({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      });
    }
    map.on("moveend", (event) => {
      const userInitiated =
        event.originalEvent !== undefined ||
        (event as { userInitiated?: boolean }).userInitiated === true;
      if (userInitiated) emitBounds();
    });
    map.on("resize", emitBounds);

    const timeout = window.setTimeout(() => {
      if (!map.loaded()) setProviderError(true);
    }, 12_000);

    map.once("load", () => {
      styleLoaded = true;
      window.clearTimeout(timeout);
      setProviderError(false);
      emitBounds();
      // Las zonas quedan bajo las etiquetas del mapa base para no tapar los
      // nombres de lugares.
      const firstLabelLayer = map
        .getStyle()
        .layers.find((layer) => layer.type === "symbol")?.id;
      map.addSource("price-zones", {
        type: "geojson",
        data: zoneDataRef.current,
      });
      map.addLayer(
        {
          id: "price-zone-fill",
          type: "fill",
          source: "price-zones",
          paint: {
            "fill-color": [
              "match",
              ["get", "priceClass"],
              0,
              PRICE_CLASS_STYLES[0].fill,
              1,
              PRICE_CLASS_STYLES[1].fill,
              2,
              PRICE_CLASS_STYLES[2].fill,
              INSUFFICIENT_STYLE.fill,
            ],
            // Más transparente al acercarse para seguir leyendo calles.
            "fill-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6,
              ["case", isInsufficient, 0.22, 0.62],
              12,
              ["case", isInsufficient, 0.12, 0.32],
            ],
          },
        },
        firstLabelLayer,
      );
      map.addLayer(
        {
          id: "price-zone-outline",
          type: "line",
          source: "price-zones",
          paint: {
            "line-color": [
              "match",
              ["get", "priceClass"],
              0,
              PRICE_CLASS_STYLES[0].outline,
              1,
              PRICE_CLASS_STYLES[1].outline,
              2,
              PRICE_CLASS_STYLES[2].outline,
              INSUFFICIENT_STYLE.outline,
            ],
            "line-opacity": ["case", isInsufficient, 0.35, 0.7],
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              5,
              0.4,
              10,
              1.2,
            ],
          },
        },
        firstLabelLayer,
      );
      map.addSource("stations", {
        type: "geojson",
        data: dataRef.current,
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 44,
      });
      // Halo translúcido bajo cada clúster para darle profundidad.
      map.addLayer({
        id: "station-cluster-halo",
        type: "circle",
        source: "stations",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#1f62b0",
          "circle-opacity": 0.16,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            24,
            100,
            30,
            500,
            37,
          ],
        },
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
            "#3a7bc8",
            100,
            "#1f62b0",
            500,
            "#174d8c",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            17,
            100,
            22,
            500,
            28,
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.5,
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
            "#f08c00",
            "#1f62b0",
          ],
          "circle-radius": ["case", ["==", ["get", "selected"], 1], 9, 6],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 2],
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
        // Ampliar un clúster es una navegación del usuario.
        map.easeTo(
          { center: coordinates as [number, number], zoom },
          { userInitiated: true },
        );
      });
      map.on("click", "station-points", (event: MapLayerMouseEvent) => {
        const stationId = event.features?.[0]?.properties?.id as
          | string
          | undefined;
        if (stationId) onSelectRef.current(stationId);
      });
      map.on("click", "price-zone-fill", (event: MapLayerMouseEvent) => {
        const zoneId = event.features?.[0]?.properties?.id as
          | string
          | undefined;
        const zone = zoneId ? zonesByIdRef.current.get(zoneId) : undefined;
        if (!zone) return;
        popupRef.current?.remove();
        popupRef.current = new Popup({ maxWidth: "18rem" })
          .setLngLat(event.lngLat)
          .setDOMContent(zonePopupContent(zone, zoneFuelRef.current))
          .addTo(map);
      });
      for (const layer of [
        "station-clusters",
        "station-points",
        "price-zone-fill",
      ]) {
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }
      for (const [layer, visibility] of Object.entries(
        layerVisibility(viewRef.current),
      )) {
        map.setLayoutProperty(layer, "visibility", visibility);
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
        zoom: Math.max(mapRef.current.getZoom(), SELECTED_ZOOM),
      });
    }
  }, [selectedId]);

  return (
    <div className="relative h-full overflow-hidden bg-[#eef2f5]">
      {/* MapLibre fuerza position: relative sobre su contenedor, así que el
          posicionamiento absoluto va en un envoltorio propio. */}
      <div className="absolute inset-0">
        <div
          ref={containerRef}
          className="h-full w-full"
          role="region"
          aria-label={
            view === "zones"
              ? "Mapa de precios por zona. La leyenda incluye las zonas más baratas y más caras como texto."
              : "Mapa interactivo de gasolineras. Los resultados también están disponibles como lista accesible."
          }
        />
      </div>
      {providerError ? (
        <div
          className="absolute inset-x-4 top-4 z-10 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-5 text-amber-950 shadow-[0_12px_30px_-14px_rgb(15_29_46/45%)] xl:right-auto xl:max-w-sm"
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
