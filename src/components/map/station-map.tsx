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

import { priceUnit } from "@/domain/fuel-units";
import {
  HEATMAP_REGIONS,
  type PriceHeatmap,
  type PriceScale,
} from "@/domain/price-heatmap";
import {
  getStationPrice,
  type Coordinates,
  type FuelCode,
  type MapBounds,
  type StationResult,
} from "@/domain/stations";
import { formatCount, formatPrice } from "@/lib/format";

import { BASE_STYLE_URL, customizeBaseStyle } from "./map-style";
import {
  EMPTY_IMAGE,
  heatmapDataUrl,
  imageCoordinates,
  layerVisibility,
  pointColorExpression,
  type MapView,
} from "./price-heatmap-layer";

const CLUSTER_MAX_ZOOM = 14;
// Por encima del último nivel agrupado, para que la estación elegida se vea
// como punto propio y no dentro de un clúster.
const SELECTED_ZOOM = CLUSTER_MAX_ZOOM + 1;
/** Vuelo hacia la estación elegida: corto, para no hacer esperar. */
const FLY_DURATION_MS = 450;
// Con el zoom fijo, un mapa estrecho (móvil) solo muestra el centro de la
// península. Por debajo de este ancho se encuadra entera al cargar; por
// encima se conserva la vista inicial de siempre.
const NARROW_MAP_WIDTH = 640;
const PENINSULA_BOUNDS: [[number, number], [number, number]] = [
  [-9.6, 35.9],
  [3.4, 43.9],
];
const NAVY = "#14406f";
const BRAND = "#1f62b0";
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

/** Muestra las capas de la vista elegida y oculta las de la otra. */
function applyLayerVisibility(map: MapLibreMap, view: MapView) {
  for (const [layer, visibility] of Object.entries(layerVisibility(view))) {
    map.setLayoutProperty(layer, "visibility", visibility);
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  /** Estación resaltada desde la lista (o `null`). */
  hoveredId?: string | null;
  userLocation: Coordinates | null;
  onSelect: (stationId: string) => void;
  /** Avisa de la estación bajo el ratón en el mapa, para resaltarla en la lista. */
  onHoverChange?: (stationId: string | null) => void;
  /**
   * Zona visible tras la carga y tras cada movimiento iniciado por el usuario.
   * Los desplazamientos automáticos al seleccionar una estación no la cambian.
   */
  onBoundsChange?: (bounds: MapBounds) => void;
  view?: MapView;
  /** Superficie de precios del combustible; solo se dibuja en la vista "heat". */
  heatmap?: PriceHeatmap | null;
  /** Escala nacional P5–P95 con la que se colorea cada estación; `null` hasta calcularla. */
  colorScale?: PriceScale | null;
}

export function StationMap({
  stations,
  fuel,
  selectedId,
  hoveredId = null,
  userLocation,
  onSelect,
  onHoverChange,
  onBoundsChange,
  view = "stations",
  heatmap = null,
  colorScale = null,
}: StationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const dataRef =
    useRef<GeoJSON.FeatureCollection<GeoJSON.Point>>(EMPTY_COLLECTION);
  const onSelectRef = useRef(onSelect);
  const onHoverChangeRef = useRef(onHoverChange);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const fuelRef = useRef(fuel);
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
  const colorScaleRef = useRef(colorScale);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onHoverChangeRef.current = onHoverChange;
    fuelRef.current = fuel;
  }, [onSelect, onHoverChange, fuel]);

  useEffect(() => {
    heatImagesRef.current = heatImages;
    const map = mapRef.current;
    if (map?.getLayer("station-points")) applyHeatImages(map, heatImages);
  }, [heatImages]);

  useEffect(() => {
    viewRef.current = view;
    const map = mapRef.current;
    if (map?.getLayer("station-points")) applyLayerVisibility(map, view);
  }, [view]);

  useEffect(() => {
    colorScaleRef.current = colorScale;
    const map = mapRef.current;
    if (map?.getLayer("station-points")) {
      map.setPaintProperty(
        "station-points",
        "circle-color",
        pointColorExpression(colorScale),
      );
    }
  }, [colorScale]);

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

    const initialView =
      containerRef.current.clientWidth < NARROW_MAP_WIDTH
        ? { bounds: PENINSULA_BOUNDS, fitBoundsOptions: { padding: 12 } }
        : { center: [-3.7, 40.2] as [number, number], zoom: 5.1 };
    const map = new MapLibreMap({
      container: containerRef.current,
      ...initialView,
      minZoom: 4,
      maxZoom: 18,
      maxBounds: [
        [-20.5, 25.5],
        [6, 45.5],
      ],
      attributionControl: {},
    });
    // El estilo se personaliza antes de pintarse (colores y nombres en español).
    map.setStyle(BASE_STYLE_URL, { transformStyle: customizeBaseStyle });
    mapRef.current = map;
    let styleLoaded = false;
    // Un fallo aislado de una tesela no inutiliza el mapa; solo se avisa si el
    // estilo del proveedor no llega a cargarse.
    map.on("error", () => {
      if (!styleLoaded) setProviderError(true);
    });
    // Sin giro ni inclinación: en móvil, arrastrar y pellizcar solo desplazan
    // y amplían, y el norte queda siempre arriba.
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.touchPitch.disable();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
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

    // Un único tooltip, reutilizado por grupos y estaciones.
    const tooltip = new Popup({
      closeButton: false,
      closeOnClick: false,
      className: "fs-tip",
      offset: 14,
      maxWidth: "none",
    });
    let tooltipKey: string | null = null;
    function showTooltip(
      key: string,
      coordinates: [number, number],
      text: string,
    ) {
      if (tooltip.isOpen() && tooltipKey === key) return;
      tooltipKey = key;
      tooltip.setLngLat(coordinates).setText(text);
      // addTo desmonta un popup ya abierto: hacerlo por mousemove reinicia la
      // entrada y reconstruye el DOM aunque no cambie el grupo o la estación.
      if (!tooltip.isOpen()) tooltip.addTo(map);
    }
    let mapHoverId: string | null = null;
    function setMapHover(stationId: string | null) {
      if (stationId === mapHoverId) return;
      if (mapHoverId !== null) {
        map.setFeatureState(
          { source: "stations", id: mapHoverId },
          { hover: false },
        );
      }
      mapHoverId = stationId;
      if (stationId !== null) {
        map.setFeatureState(
          { source: "stations", id: stationId },
          { hover: true },
        );
      }
      onHoverChangeRef.current?.(stationId);
    }

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
                0.5,
                9,
                0.4,
                13,
                0.27,
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
        // El identificador de MITECO permite resaltar una estación desde la lista.
        promoteId: "id",
      });
      // Halo translúcido bajo cada clúster para darle profundidad.
      map.addLayer({
        id: "station-cluster-halo",
        type: "circle",
        source: "stations",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": BRAND,
          "circle-opacity": 0.07,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            23,
            100,
            27,
            500,
            32,
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
            "#ffffff",
            100,
            "#ffffff",
            500,
            NAVY,
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            100,
            22,
            500,
            27,
          ],
          "circle-stroke-color": "#5784a7",
          "circle-stroke-width": 1.5,
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
          "text-size": 13,
        },
        paint: {
          "text-color": ["step", ["get", "point_count"], NAVY, 500, "#ffffff"],
        },
      });
      // Halo oscuro y fino bajo cada estación: separa del mapa claro incluso
      // el amarillo central de la rampa.
      map.addLayer({
        id: "station-points-halo",
        type: "circle",
        source: "stations",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "rgba(15, 29, 46, 0.32)",
          "circle-radius": [
            "case",
            ["==", ["get", "selected"], 1],
            13.5,
            ["boolean", ["feature-state", "hover"], false],
            12,
            8.5,
          ],
        },
      });
      // Cada estación con el color de su precio en la escala nacional (la
      // misma del mapa de calor); la elegida, con anillo azul marino.
      map.addLayer({
        id: "station-points",
        type: "circle",
        source: "stations",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": pointColorExpression(colorScaleRef.current),
          "circle-radius": [
            "case",
            ["==", ["get", "selected"], 1],
            9,
            ["boolean", ["feature-state", "hover"], false],
            8.5,
            6,
          ],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "selected"], 1],
            NAVY,
            "#ffffff",
          ],
          "circle-stroke-width": [
            "case",
            ["==", ["get", "selected"], 1],
            3.5,
            ["boolean", ["feature-state", "hover"], false],
            3,
            2,
          ],
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
        tooltip.remove();
        // Ampliar un clúster es una navegación del usuario.
        map.easeTo(
          {
            center: coordinates as [number, number],
            zoom,
            duration: prefersReducedMotion() ? 0 : 400,
          },
          { userInitiated: true },
        );
      });
      map.on("click", "station-points", (event: MapLayerMouseEvent) => {
        const stationId = event.features?.[0]?.properties?.id as
          | string
          | undefined;
        if (stationId) onSelectRef.current(stationId);
      });

      // Tooltips: «N estaciones · pulsa para ampliar» y «Marca · precio».
      map.on("mousemove", "station-clusters", (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const count = Number(feature.properties?.point_count ?? 0);
        map.getCanvas().style.cursor = "pointer";
        showTooltip(
          `cluster:${feature.properties?.cluster_id}:${count}`,
          feature.geometry.coordinates as [number, number],
          `${formatCount(count)} estaciones · pulsa para ampliar`,
        );
      });
      map.on("mouseleave", "station-clusters", () => {
        map.getCanvas().style.cursor = "";
        tooltip.remove();
      });
      map.on("mousemove", "station-points", (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const stationId = String(feature.properties?.id ?? "");
        const price = Number(feature.properties?.price);
        map.getCanvas().style.cursor = "pointer";
        setMapHover(stationId || null);
        showTooltip(
          `station:${stationId}:${fuelRef.current}:${price}`,
          feature.geometry.coordinates as [number, number],
          Number.isFinite(price)
            ? `${feature.properties?.brand} · ${formatPrice(price)} ${priceUnit(fuelRef.current)}`
            : String(feature.properties?.brand ?? ""),
        );
      });
      map.on("mouseleave", "station-points", () => {
        map.getCanvas().style.cursor = "";
        setMapHover(null);
        tooltip.remove();
      });
      map.on("movestart", () => tooltip.remove());
      applyLayerVisibility(map, viewRef.current);
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

    return () => {
      window.clearTimeout(timeout);
      resizeObserver.disconnect();
      tooltip.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Resaltado desde la lista: el punto crece mientras la fila está bajo el ratón.
  useEffect(() => {
    const map = mapRef.current;
    if (!hoveredId || !map?.getSource("stations")) return;
    map.setFeatureState({ source: "stations", id: hoveredId }, { hover: true });
    return () => {
      if (map.getSource("stations")) {
        map.setFeatureState(
          { source: "stations", id: hoveredId },
          { hover: false },
        );
      }
    };
  }, [hoveredId]);

  useEffect(() => {
    if (!userLocation || !mapRef.current) return;
    const element = document.createElement("div");
    element.className = "me-marker";
    const marker = new Marker({ element })
      .setLngLat([userLocation.longitude, userLocation.latitude])
      .setPopup(new Popup({ offset: 14 }).setText("Tu ubicación aproximada"))
      .addTo(mapRef.current);
    return () => {
      marker.remove();
    };
  }, [userLocation]);

  // Vuela a la estación solo cuando cambia la selección, no cada vez que se
  // filtran los resultados.
  useEffect(() => {
    const map = mapRef.current;
    if (!selectedId || !map) return;
    const station = stationsRef.current.find(
      (candidate) => candidate.id === selectedId,
    );
    if (!station) return;
    const target = {
      center: [station.location.longitude, station.location.latitude] as [
        number,
        number,
      ],
      zoom: Math.max(map.getZoom(), SELECTED_ZOOM),
    };
    if (prefersReducedMotion()) map.jumpTo(target);
    else map.flyTo({ ...target, duration: FLY_DURATION_MS });
  }, [selectedId]);

  return (
    <div className="relative h-full overflow-hidden bg-[#c9d6e0]">
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
          className="glass absolute inset-x-3 top-16 z-10 p-4 text-sm leading-5 text-amber-950 md:right-auto md:left-4 md:max-w-sm"
          role="alert"
        >
          <strong className="block font-bold">
            El mapa base no está disponible.
          </strong>
          Puedes seguir consultando las estaciones y sus precios en la lista.
        </div>
      ) : null}
    </div>
  );
}
