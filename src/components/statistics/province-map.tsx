// Mapa de provincias coloreado por su precio medio frente a la media nacional.
// Es una ayuda visual: los mismos datos están en «Precio medio por provincia»,
// que es la versión accesible. Los contornos (Natural Earth, dominio público)
// se descargan aparte; si fallan, el mapa no se muestra y nada más cambia.

import {
  useEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import type {
  FuelStatistics,
  ProvinceStatistics,
} from "@/domain/fuel-statistics";
import { MIN_PROVINCE_SAMPLE } from "@/domain/fuel-statistics";
import { priceUnit } from "@/domain/fuel-units";
import { FUEL_LABELS } from "@/domain/stations";
import {
  formatCount,
  formatPrice,
  formatSignedPercent,
  formatSignedPrice,
} from "@/lib/format";

import { CHEAPER, NEUTRAL, PRICIER, provinceFill } from "./province-colors";

interface ProvinceShape {
  id: string;
  d: string;
  x: number;
  y: number;
  dot?: boolean;
}

interface ProvinceShapes {
  source: string;
  width: number;
  height: number;
  canaryBox: { x: number; y: number; w: number; h: number };
  provinces: ProvinceShape[];
}

type Load =
  | { status: "loading" }
  | { status: "ready"; value: ProvinceShapes }
  | { status: "error" };

export function ProvinceMap({
  statistics,
  hotProvince,
  onHotProvince,
}: {
  statistics: FuelStatistics;
  hotProvince: string | null;
  onHotProvince: (id: string | null) => void;
}) {
  const [shapes, setShapes] = useState<Load>({ status: "loading" });
  useEffect(() => {
    let active = true;
    fetch("/geo/provincias.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ProvinceShapes>;
      })
      .then(
        (value) => {
          if (active) setShapes({ status: "ready", value });
        },
        () => {
          if (active) setShapes({ status: "error" });
        },
      );
    return () => {
      active = false;
    };
  }, []);

  if (shapes.status === "error") return null;

  const unit = priceUnit(statistics.fuel);
  const byId = new Map(
    statistics.provinces.map((province) => [province.id, province]),
  );
  const largestGap = Math.max(
    0.001,
    ...statistics.provinces.map((province) =>
      Math.abs(province.differenceFromNational?.absolute ?? 0),
    ),
  );
  const hot = hotProvince ? byId.get(hotProvince) : undefined;
  const hotShape =
    shapes.status === "ready"
      ? shapes.value.provinces.find((shape) => shape.id === hotProvince)
      : undefined;
  const anyMissing = statistics.provinces.some((province) => !province.summary);

  // Un único punto de tabulación; las flechas recorren todas las provincias
  // y anuncian el mismo dato que el tooltip del ratón o del dedo.
  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (shapes.status !== "ready") return;
    const provinces = shapes.value.provinces;
    const current = Math.max(
      0,
      provinces.findIndex(({ id }) => id === hotProvince),
    );
    const next = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowUp: Math.max(0, current - 1),
      ArrowRight: Math.min(provinces.length - 1, current + 1),
      ArrowDown: Math.min(provinces.length - 1, current + 1),
      Home: 0,
      End: provinces.length - 1,
    }[event.key];
    if (event.key === "Escape") onHotProvince(null);
    if (next === undefined) return;
    event.preventDefault();
    onHotProvince(provinces[next].id);
  }

  // Con dedo, tocar una provincia muestra su dato; tocar de nuevo lo quita.
  function onPointerDown(event: PointerEvent, id: string) {
    if (event.pointerType !== "mouse") {
      onHotProvince(hotProvince === id ? null : id);
    }
  }

  return (
    <figure className="m-0">
      <div className="relative mx-auto w-full max-w-[45rem]">
        {shapes.status === "loading" ? (
          <p
            role="status"
            className="text-muted grid aspect-[560/454] place-items-center text-[0.875rem]"
          >
            Cargando el mapa de provincias…
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${shapes.value.width} ${shapes.value.height}`}
            className={`province-map block h-auto w-full ${hotProvince ? "has-hot" : ""}`}
            role="group"
            tabIndex={0}
            aria-label={`Mapa de provincias coloreado según su precio medio de ${FUEL_LABELS[statistics.fuel]} frente a la media nacional: verde, más barata; rojo, más cara. Usa las flechas, Inicio y Fin para recorrer las provincias. Los valores están en «Precio medio por provincia».`}
            onFocus={() =>
              onHotProvince(hotProvince ?? shapes.value.provinces[0].id)
            }
            onBlur={() => onHotProvince(null)}
            onKeyDown={onKeyDown}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") onHotProvince(null);
            }}
          >
            <rect
              x={shapes.value.canaryBox.x}
              y={shapes.value.canaryBox.y}
              width={shapes.value.canaryBox.w}
              height={shapes.value.canaryBox.h}
              rx={8}
              className="fill-none stroke-[rgb(15_29_46/16%)]"
              strokeDasharray="4 4"
              aria-hidden="true"
            />
            {shapes.value.provinces.map((shape) => {
              const province = byId.get(shape.id);
              const fill = provinceFill(province, largestGap);
              const common = {
                className: `province ${hotProvince === shape.id ? "is-hot" : ""}`,
                onPointerEnter: (event: PointerEvent) => {
                  if (event.pointerType === "mouse") onHotProvince(shape.id);
                },
                onPointerDown: (event: PointerEvent) =>
                  onPointerDown(event, shape.id),
              };
              return shape.dot ? (
                <circle
                  key={shape.id}
                  cx={shape.x}
                  cy={shape.y}
                  r={6}
                  fill={fill}
                  {...common}
                />
              ) : (
                <path key={shape.id} d={shape.d} fill={fill} {...common} />
              );
            })}
          </svg>
        )}
        {hot && hotShape && shapes.status === "ready" ? (
          <ProvinceTooltip
            province={hot}
            unit={unit}
            left={(hotShape.x / shapes.value.width) * 100}
            top={(hotShape.y / shapes.value.height) * 100}
          />
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {hot
          ? `${hot.name}: ${hot.summary ? `${formatPrice(hot.summary.mean)} ${unit}, ${formatCount(hot.summary.count)} estaciones${hot.differenceFromNational ? `, ${formatSignedPrice(hot.differenceFromNational.absolute)} ${unit} frente a la media nacional` : ""}${!hot.sufficient ? ", muestra reducida" : ""}` : "sin datos"}.`
          : ""}
      </p>
      <figcaption className="text-muted mt-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[0.75rem]">
        <span>Más barata que la media</span>
        <span
          aria-hidden="true"
          className="h-2 w-28 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${CHEAPER}, ${NEUTRAL}, ${PRICIER})`,
          }}
        />
        <span>Más cara</span>
        <span className="num">
          (±{formatPrice(largestGap)} {unit})
        </span>
        {anyMissing ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-sm bg-[#dfe3e8]"
            />
            Sin datos
          </span>
        ) : null}
        <span className="w-full text-right">
          Contornos:{" "}
          <a
            className="underline underline-offset-2"
            href="https://www.naturalearthdata.com/about/terms-of-use/"
            target="_blank"
            rel="noreferrer"
          >
            Natural Earth
          </a>{" "}
          · dominio público
        </span>
      </figcaption>
    </figure>
  );
}

function ProvinceTooltip({
  province,
  unit,
  left,
  top,
}: {
  province: ProvinceStatistics;
  unit: ReturnType<typeof priceUnit>;
  left: number;
  top: number;
}) {
  const difference = province.differenceFromNational;
  return (
    <div
      aria-hidden="true"
      className="bg-ink pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+0.875rem)] rounded-[0.625rem] px-3 pt-2 pb-1.5 text-[0.8125rem] whitespace-nowrap text-white shadow-[0_10px_24px_-10px_rgb(15_29_46/60%)]"
      style={{
        left: `${Math.min(Math.max(left, 18), 82)}%`,
        top: `${top}%`,
      }}
    >
      <span className="block font-bold">{province.name}</span>
      {province.summary ? (
        <>
          <span className="num text-[1.0625rem] font-extrabold">
            {formatPrice(province.summary.mean)} {unit}
          </span>
          {difference ? (
            <span className="num ml-1.5 text-[#b7c3d0]">
              {formatSignedPrice(difference.absolute)}
              {difference.percent !== null
                ? ` (${formatSignedPercent(difference.percent)})`
                : ""}
            </span>
          ) : null}
          <span className="num block text-[#b7c3d0]">
            {formatCount(province.summary.count)} estaciones
            {!province.sufficient
              ? ` · muestra reducida (menos de ${MIN_PROVINCE_SAMPLE})`
              : ""}
          </span>
        </>
      ) : (
        <span className="block text-[#b7c3d0]">
          Ninguna estación comunica este combustible
        </span>
      )}
    </div>
  );
}
