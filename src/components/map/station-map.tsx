"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type GeoJSONSource,
  type ImageSource,
  Map as MapLibreMap,
  type MapLayerMouseEvent,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";

import { HEATMAP_REGIONS, type PriceHeatmap } from "@/domain/price-heatmap";
import type {
  Coordinates,
  FuelCode,
  MapBounds,
  StationResult,
} from "@/domain/stations";
import { getStationPrice } from "@/domain/stations";

import {
  EMPTY_IMAGE,
  heatmapDataUrl,
  imageCoordinates,
  layerVisibility,
  type MapView,
} from "./price-heatmap-layer";

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

/** Sustituye la imagen de cada región; sin datos, deja una transparente. */
function applyHeatImages(
  map: MapLibreMap,
  images: ReadonlyMap<string, string> | null,
) {
  for (const region of HEATMAP_REGIONS) {
    const source = map.getSource(`price-heat-${region.id}`) as
      | ImageSource
      | undefined;
    source?.updateImage({
      url: images?.get(region.id) ?? EMPTY_IMAGE,
      coordinates: imageCoordinates(region),
    });
  }
}

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
  /** Superficie de precios del combustible; solo se dibuja en la vista "heat". */
  heatmap?: PriceHeatmap | null;
}

export function StationMap({
  stations,
  fuel,
  selectedId,
  userLocation,
  onSelect,
  onBoundsChange,
  view = "stations",
  heatmap = null,
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
  // Una imagen PNG por región, generada solo cuando cambia la superficie.
  const heatImages = useMemo(
    () =>
      heatmap?.scale
        ? new Map(
            heatmap.rasters.map((raster) => [
              raster.region.id,
              heatmapDataUrl(raster, heatmap.scale!),
            ]),
          )
        : null,
    [heatmap],
  );
  const heatImagesRef = useRef(heatImages);
  const viewRef = useRef(view);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    heatImagesRef.current = heatImages;
    const map = mapRef.current;
    if (map?.getLayer("station-points")) applyHeatImages(map, heatImages);
  }, [heatImages]);

  useEffect(() => {
    viewRef.current = view;
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
      // El mapa de calor queda bajo las etiquetas del mapa base para no tapar
      // los nombres de lugares. No es clicable: es una estimación visual.
      const firstLabelLayer = map
        .getStyle()
        .layers.find((layer) => layer.type === "symbol")?.id;
      for (const region of HEATMAP_REGIONS) {
        const id = `price-heat-${region.id}`;
        map.addSource(id, {
          type: "image",
          url: heatImagesRef.current?.get(region.id) ?? EMPTY_IMAGE,
          coordinates: imageCoordinates(region),
        });
        map.addLayer(
          {
            id,
            type: "raster",
            source: id,
            paint: {
              // La interpolación lineal entre píxeles produce el degradado.
              "raster-resampling": "linear",
              "raster-fade-duration": 0,
              // Más transparente al acercarse para seguir leyendo calles.
              "raster-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                5,
                0.8,
                9,
                0.65,
                13,
                0.4,
              ],
            },
          },
          firstLabelLayer,
        );
      }
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
      for (const layer of ["station-clusters", "station-points"]) {
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
            view === "heat"
              ? "Mapa de calor de precios. La leyenda explica la escala; los precios de cada estación están en la lista accesible."
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
