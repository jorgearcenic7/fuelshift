import { BrandMark } from "@/components/map/brand-mark";
import { PriceUnitLabel } from "@/components/price-unit";
import { getBrandIdentity } from "@/domain/brands";
import type { PriceUnit } from "@/domain/fuel-units";
import {
  NEGLIGIBLE_SAVING_EUROS,
  type Profitability,
  type RefuelMovement,
  type RefuelOption,
  type RefuelRanking,
} from "@/domain/refuel/economics";
import type { Station } from "@/domain/stations";
import {
  formatDuration,
  formatEuros,
  formatKilometres,
  formatPrice,
  formatSignedEuros,
} from "@/lib/format";

// Lista ordenada por ahorro neto. Cada fila separa los tres datos que el
// usuario debe poder distinguir: ahorro bruto por precio, coste extra del
// desplazamiento y ahorro neto. Un ahorro cero o negativo se muestra tal cual.

const PROFITABILITY: Record<
  Profitability,
  { label: string; tone: string; dot: string }
> = {
  worthwhile: {
    label: "Compensa",
    tone: "bg-positive-soft text-positive-strong",
    dot: "bg-positive",
  },
  negligible: {
    label: "Diferencia mínima",
    tone: "bg-amber-50 text-amber-900",
    dot: "bg-amber",
  },
  "not-worthwhile": {
    label: "No compensa",
    tone: "bg-rose-50 text-rose-800",
    dot: "bg-dear",
  },
  reference: {
    label: "Referencia",
    tone: "bg-accent-soft text-accent-strong",
    dot: "bg-navy",
  },
};

function Fact({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-[0.6875rem] leading-4 font-bold">
        {label}
      </dt>
      <dd
        className={`num optical text-[0.9375rem] leading-5 whitespace-nowrap ${strong ? "text-ink font-extrabold" : "text-ink-2 font-bold"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function OptionRow({
  option,
  rank,
  movement,
  unit,
  focused,
  onFocus,
  onMakeReference,
}: {
  option: RefuelOption<Station>;
  rank: number;
  movement: RefuelMovement;
  unit: PriceUnit;
  focused: boolean;
  onFocus: () => void;
  onMakeReference: (() => void) | null;
}) {
  const { station, cost, versusReference, profitability } = option;
  const style = PROFITABILITY[profitability];
  const isReference = profitability === "reference";
  const trip = cost.attributable;
  const tripLabel = movement === "detour" ? "Desvío" : "Ida y vuelta";
  const tripValue = `${movement === "detour" ? "+" : ""}${formatKilometres(trip.distanceMeters)} · ${movement === "detour" ? "+" : ""}${formatDuration(trip.durationSeconds)}`;

  return (
    <li
      data-refuel-row={station.id}
      className={`rounded-2xl border px-3 py-3 transition-colors duration-150 ${focused ? "border-accent bg-accent-soft/60" : "border-line bg-white"}`}
    >
      <button
        type="button"
        onClick={onFocus}
        aria-pressed={focused}
        className="press grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2.5 text-left"
      >
        <span
          className={`num inline-flex h-[1.375rem] min-w-[1.875rem] items-center justify-center rounded-[0.4375rem] px-1.5 pt-0.5 text-[0.75rem] font-extrabold ${rank === 1 ? "bg-positive text-white" : "bg-accent-soft text-accent-strong"}`}
        >
          <span className="sr-only">Puesto </span>
          <span aria-hidden="true">#</span>
          {rank}
        </span>
        <BrandMark identity={getBrandIdentity(station.brand)} />
        <span className="min-w-0">
          <span className="text-ink optical block truncate text-[0.9375rem] leading-tight font-bold">
            {station.brand ?? "Sin rótulo"}
          </span>
          <span className="text-muted mt-0.5 block truncate text-[0.8125rem]">
            {station.municipality} · {station.address}
          </span>
        </span>
        <span className="num text-ink optical text-[1.125rem] leading-none font-extrabold tracking-[-0.02em]">
          {formatPrice(cost.price)}
          <PriceUnitLabel unit={unit} visuallyHidden />
        </span>
      </button>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={`optical inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.75rem] font-extrabold ${style.tone}`}
        >
          <span
            aria-hidden="true"
            className={`-mt-px size-1.5 rounded-full ${style.dot}`}
          />
          {style.label}
        </span>
        <span className="num text-muted text-[0.8125rem]">
          {tripLabel}: {tripValue}
        </span>
      </div>

      <dl className="mt-2.5 grid grid-cols-3 gap-2">
        {isReference ? (
          <>
            <Fact label="Repostaje" value={formatEuros(cost.fillCost)} />
            <Fact label="Desplazamiento" value={formatEuros(cost.travelCost)} />
            <Fact label="Total" value={formatEuros(cost.totalCost)} strong />
          </>
        ) : (
          <>
            <Fact
              label="Ahorro bruto"
              value={formatSignedEuros(versusReference.grossSaving)}
            />
            <Fact
              label="Desplazamiento extra"
              value={formatSignedEuros(versusReference.extraTravelCost)}
            />
            <Fact
              label="Ahorro neto"
              value={formatSignedEuros(versusReference.netSaving)}
              strong
            />
          </>
        )}
      </dl>

      {onMakeReference ? (
        <button
          type="button"
          className="link-action press mt-2 text-[0.8125rem]"
          onClick={onMakeReference}
        >
          Comparar con esta
          <span className="sr-only">
            {" "}
            gasolinera ({station.brand ?? "sin rótulo"}, {station.municipality})
          </span>
        </button>
      ) : null}
    </li>
  );
}

export function RefuelResults({
  ranking,
  movement,
  unit,
  focusedId,
  onFocus,
  onReferenceChange,
}: {
  ranking: RefuelRanking<Station>;
  movement: RefuelMovement;
  unit: PriceUnit;
  focusedId: string | null;
  onFocus: (stationId: string) => void;
  onReferenceChange: (stationId: string | null) => void;
}) {
  const reference = ranking.reference.station;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted text-[0.8125rem] leading-[1.15rem]">
        Ordenadas por ahorro neto frente a{" "}
        <strong className="text-ink-2">
          {reference.brand ?? "Sin rótulo"} ({reference.municipality})
        </strong>
        ,{" "}
        {ranking.referenceBasis === "nearest"
          ? "la más cercana por carretera."
          : "la referencia que has elegido."}
        {ranking.referenceBasis === "selected" ? (
          <>
            {" "}
            <button
              type="button"
              className="link-action press inline"
              onClick={() => onReferenceChange(null)}
            >
              Volver a la más cercana
            </button>
          </>
        ) : null}
      </p>
      <ol
        className="flex flex-col gap-2"
        aria-label="Gasolineras por ahorro neto"
      >
        {ranking.options.map((option, index) => (
          <OptionRow
            key={option.station.id}
            option={option}
            rank={index + 1}
            movement={movement}
            unit={unit}
            focused={focusedId === option.station.id}
            onFocus={() => onFocus(option.station.id)}
            onMakeReference={
              option.profitability === "reference"
                ? null
                : () => onReferenceChange(option.station.id)
            }
          />
        ))}
      </ol>
      <details className="dataset-details">
        <summary>Cómo se calcula</summary>
        <ul className="text-muted mt-1 list-disc space-y-1 pl-4 text-[0.8125rem] leading-[1.15rem]">
          <li>
            <strong>Ahorro bruto</strong>: diferencia de precio con la
            referencia por la cantidad que vas a repostar.
          </li>
          <li>
            <strong>Desplazamiento extra</strong>: combustible gastado en los
            kilómetros{" "}
            {movement === "detour"
              ? "que añades a tu viaje"
              : "de ida y vuelta"}{" "}
            con tu consumo, al precio de cada estación, menos el de la
            referencia.
          </li>
          <li>
            <strong>Ahorro neto</strong>: ahorro bruto menos desplazamiento
            extra. Por debajo de {formatEuros(NEGLIGIBLE_SAVING_EUROS)} en valor
            absoluto se considera una diferencia mínima.
          </li>
          <li>No incluye peajes, aparcamiento ni el valor de tu tiempo.</li>
        </ul>
      </details>
    </div>
  );
}

const LEGEND_ORDER: readonly Profitability[] = [
  "worthwhile",
  "negligible",
  "not-worthwhile",
  "reference",
];

/** Leyenda sobre el mapa: el número es el puesto y el color, la etiqueta del panel. */
export function RefuelMapLegend() {
  return (
    <div className="glass text-ink-2 px-3 py-2 text-[0.75rem] leading-4">
      <p className="text-ink font-extrabold">Puesto por ahorro neto</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {LEGEND_ORDER.map((key) => (
          <li key={key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-2.5 rounded-full ${PROFITABILITY[key].dot}`}
            />
            {PROFITABILITY[key].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
