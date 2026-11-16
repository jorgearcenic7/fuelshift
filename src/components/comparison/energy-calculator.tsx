"use client";

// Comparador de gasto energético (gasolina, diésel y eléctrico).
// Solo calcula lo que cuesta la energía; no entra en precio de compra, seguros
// ni mantenimiento. Si se llega desde la ficha de una estación, su precio
// sustituye al de ejemplo hasta que la persona lo edite, lo descarte o
// restablezca el ejemplo.

import {
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import { parseComparatorParams } from "@/domain/comparator-link";
import {
  calculateEnergyComparison,
  EXAMPLE_INPUTS,
  findInvalidFields,
  INPUT_LIMITS,
  type EnergyField,
  type EnergyInputs,
} from "@/domain/energy-comparison";
import { FUEL_LABELS } from "@/domain/stations";

type Values = Record<EnergyField, string>;

const FIELDS: Record<EnergyField, { label: string; unit: string }> = {
  annualKm: { label: "Kilómetros al año", unit: "km" },
  gasolinePrice: { label: "Gasolina", unit: "€/L" },
  dieselPrice: { label: "Diésel", unit: "€/L" },
  electricPrice: { label: "Electricidad", unit: "€/kWh" },
  gasolineConsumption: { label: "Consumo gasolina", unit: "L/100 km" },
  dieselConsumption: { label: "Consumo diésel", unit: "L/100 km" },
  electricConsumption: { label: "Consumo eléctrico", unit: "kWh/100 km" },
  years: { label: "Proyección", unit: "años" },
};
/** En modo sencillo, el resto de campos usa los supuestos de EXAMPLE_INPUTS. */
const SIMPLE_FIELDS: readonly EnergyField[] = [
  "annualKm",
  "gasolinePrice",
  "dieselPrice",
  "electricPrice",
];
const EXAMPLE_VALUES = Object.fromEntries(
  Object.entries(EXAMPLE_INPUTS).map(([field, value]) => [
    field,
    String(value),
  ]),
) as Values;
/** Recorrido del deslizador; el campo de texto admite todo el rango válido. */
const KM_SLIDER = { min: 1_000, max: 100_000, step: 500 } as const;
const KM_TICKS = [1_000, 25_000, 50_000, 75_000, 100_000] as const;

const euros = (value: number) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
const decimal = (value: number, digits = 1) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: digits }).format(
    value,
  );
const toNumber = (value: string) =>
  value.trim() === "" ? Number.NaN : Number(value);

// La URL no cambia mientras la página está abierta; en el HTML estático se lee vacía.
const subscribeToNothing = () => () => {};
const readSearch = () => window.location.search;
const readServerSearch = () => "";

function rangeMessage(field: EnergyField): string {
  const { min, max, integer } = INPUT_LIMITS[field];
  return `Introduce un ${integer ? "número entero" : "valor"} entre ${decimal(min, 2)} y ${decimal(max, 2)} ${FIELDS[field].unit}.`;
}

/** Campo numérico dentro de la frase: su etiqueta completa es accesible. */
function InlineField({
  field,
  value,
  invalid,
  onChange,
}: {
  field: EnergyField;
  value: string;
  invalid: boolean;
  onChange: (field: EnergyField, value: string) => void;
}) {
  const { label, unit } = FIELDS[field];
  const { min, max, integer } = INPUT_LIMITS[field];
  return (
    <label className="inline-block max-w-full">
      <span className="sr-only">
        {label} ({unit})
      </span>
      <input
        className={`inline-field num ${invalid ? "inline-field-invalid" : ""}`}
        style={{ width: `${Math.min(12, Math.max(3, value.length + 1))}ch` }}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={integer ? 1 : "any"}
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${field}-error` : undefined}
        onChange={(event) => onChange(field, event.target.value)}
      />
    </label>
  );
}

function ResultRow({
  name,
  units,
  annual,
  period,
  share,
  cheapest,
}: {
  name: string;
  units: string;
  annual: number;
  period: ReactNode;
  share: number;
  cheapest: boolean;
}) {
  return (
    <div className={`result-row ${cheapest ? "is-cheapest" : ""}`}>
      <span className="result-name">{name}</span>
      <span className="result-amount num">
        <span>{euros(annual)}</span>
        <span className="result-unit">/año</span>
        <span className="result-period">{period}</span>
      </span>
      <span aria-hidden="true" className="result-track">
        <span
          className="result-bar"
          style={{ "--share": share } as CSSProperties}
        />
      </span>
      <span className="result-consumption num">{units}</span>
      {cheapest ? (
        <span className="result-best">Menor gasto energético</span>
      ) : null}
    </div>
  );
}

export function EnergyCalculator() {
  const search = useSyncExternalStore(
    subscribeToNothing,
    readSearch,
    readServerSearch,
  );
  const [edits, setEdits] = useState<Partial<Values>>({});
  const [stationDismissed, setStationDismissed] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  // Prioridad de valores: ejemplo < precio de la estación < lo que escribe la persona.
  const station = stationDismissed ? null : parseComparatorParams(search);
  const values: Values = {
    ...EXAMPLE_VALUES,
    ...(station ? { [station.field]: String(station.price) } : {}),
    ...edits,
  };
  const stationPriceInUse = station !== null && !(station.field in edits);

  // En modo sencillo los campos avanzados ocultos usan los valores de ejemplo.
  const inputs = Object.fromEntries(
    (Object.keys(EXAMPLE_INPUTS) as EnergyField[]).map((field) => [
      field,
      advanced || SIMPLE_FIELDS.includes(field)
        ? toNumber(values[field])
        : EXAMPLE_INPUTS[field],
    ]),
  ) as unknown as EnergyInputs;
  const invalidFields = new Set(findInvalidFields(inputs));
  const result = calculateEnergyComparison(inputs);

  const updateValue = (field: EnergyField, value: string) =>
    setEdits((current) => ({ ...current, [field]: value }));
  const reset = () => {
    setEdits({});
    setStationDismissed(true);
  };
  const field = (name: EnergyField) => (
    <InlineField
      field={name}
      value={values[name]}
      invalid={invalidFields.has(name)}
      onChange={updateValue}
    />
  );
  // Solo los campos visibles: en modo sencillo los ocultos usan el ejemplo.
  const visibleInvalid = (Object.keys(FIELDS) as EnergyField[]).filter(
    (name) =>
      invalidFields.has(name) && (advanced || SIMPLE_FIELDS.includes(name)),
  );

  const kmValue = toNumber(values.annualKm);
  const sliderKm = Number.isFinite(kmValue)
    ? Math.min(KM_SLIDER.max, Math.max(KM_SLIDER.min, kmValue))
    : EXAMPLE_INPUTS.annualKm;
  const sliderFill =
    ((sliderKm - KM_SLIDER.min) / (KM_SLIDER.max - KM_SLIDER.min)) * 100;

  const costs = result
    ? [
        { name: "Gasolina", unit: "L", data: result.gasoline },
        { name: "Diésel", unit: "L", data: result.diesel },
        { name: "Eléctrico", unit: "kWh", data: result.electric },
      ]
    : [];
  const maxCost = Math.max(1, ...costs.map(({ data }) => data.annualEuros));
  const minCost = Math.min(...costs.map(({ data }) => data.annualEuros));

  return (
    <main id="contenido" className="comparison-page page-shell">
      <div className="page-heading">
        <div>
          <h1>¿Cuánto te cuesta conducir?</h1>
          <p className="text-muted mt-2 text-[0.9375rem] leading-relaxed">
            Simulador de coste energético. Compara el gasto en energía de
            gasolina, diésel y eléctrico para los mismos kilómetros. No
            necesitas indicar un trayecto ni compartir tu ubicación.
          </p>
        </div>
        <div className="comparison-modes flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <div
            role="group"
            aria-label="Modo de cálculo"
            className="seg seg-sm w-[13rem] max-w-full shrink-0"
            style={{ "--n": 2, "--i": advanced ? 1 : 0 } as CSSProperties}
          >
            <span className="seg-thumb" aria-hidden="true" />
            {(
              [
                [false, "Sencillo"],
                [true, "Personalizado"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={advanced === value}
                onClick={() => setAdvanced(value)}
                className="seg-option"
              >
                <span className="optical">{label}</span>
              </button>
            ))}
          </div>
          <button type="button" className="link-action press" onClick={reset}>
            Restablecer<span className="sr-only"> ejemplo</span>
          </button>
        </div>
      </div>

      {stationPriceInUse ? (
        <div
          role="status"
          className="bg-positive-soft text-positive-strong mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl py-2 pr-2 pl-4 text-[0.875rem] font-semibold"
        >
          <p className="pt-0.5">
            Precio de {FUEL_LABELS[station.fuel]}
            {station.stationId
              ? ` de la estación MITECO ${station.stationId}`
              : ""}{" "}
            cargado desde el mapa. Puedes editarlo; comprueba su antigüedad en
            el mapa.
          </p>
          <button
            type="button"
            className="link-action press text-positive-strong px-2"
            onClick={() => setStationDismissed(true)}
          >
            Descartar
            <span className="sr-only"> el precio de la estación</span>
          </button>
        </div>
      ) : null}

      <div className="comparison-layout">
        <section aria-labelledby="inputs-title" className="comparison-editor">
          <h2 id="inputs-title" className="section-label">
            Tus datos
          </h2>
          <div className="sentence">
            <p>
              Hago{" "}
              <span className="inline-measure">
                {field("annualKm")} <span className="measure-unit">km</span>
              </span>{" "}
              al año.
            </p>
            <div
              className="km-slider"
              style={{ "--fill": `${sliderFill}%` } as CSSProperties}
            >
              <label>
                <span className="sr-only">
                  Kilómetros al año: desliza para cambiarlos
                </span>
                <input
                  type="range"
                  min={KM_SLIDER.min}
                  max={KM_SLIDER.max}
                  step={KM_SLIDER.step}
                  value={sliderKm}
                  aria-valuetext={`${decimal(sliderKm, 0)} km al año`}
                  onChange={(event) =>
                    updateValue("annualKm", event.target.value)
                  }
                />
              </label>
              <div
                aria-hidden="true"
                className="num text-muted mt-1 flex justify-between text-[0.75rem] font-medium tracking-normal"
              >
                {KM_TICKS.map((tick) => (
                  <span key={tick}>{decimal(tick, 0)}</span>
                ))}
              </div>
            </div>
            <p className="mt-4" role="group" aria-label="Precio de la energía">
              La gasolina está a{" "}
              <span className="inline-measure">
                {field("gasolinePrice")}{" "}
                <span className="measure-unit">€/L</span>
              </span>
              , el diésel a{" "}
              <span className="inline-measure">
                {field("dieselPrice")} <span className="measure-unit">€/L</span>
              </span>{" "}
              y la electricidad a{" "}
              <span className="inline-measure">
                {field("electricPrice")}{" "}
                <span className="measure-unit">€/kWh</span>
              </span>
              .
            </p>
            {advanced ? (
              <p className="mt-4" role="group" aria-label="Consumos y plazo">
                Mi coche gasta{" "}
                <span className="inline-measure">
                  {field("gasolineConsumption")}{" "}
                  <span className="measure-unit">L/100 km</span>
                </span>{" "}
                en gasolina,{" "}
                <span className="inline-measure">
                  {field("dieselConsumption")}{" "}
                  <span className="measure-unit">L/100 km</span>
                </span>{" "}
                en diésel o{" "}
                <span className="inline-measure">
                  {field("electricConsumption")}{" "}
                  <span className="measure-unit">kWh/100 km</span>
                </span>{" "}
                en eléctrico, y quiero verlo a{" "}
                <span className="inline-measure">
                  {field("years")} <span className="measure-unit">años</span>
                </span>
                .
              </p>
            ) : null}
          </div>

          {visibleInvalid.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1 text-[0.875rem] text-amber-900">
              {visibleInvalid.map((name) => (
                <li key={name} id={`${name}-error`}>
                  <strong className="font-bold">
                    {FIELDS[name].label} ({FIELDS[name].unit}):
                  </strong>{" "}
                  {rangeMessage(name)}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="text-muted mt-5 max-w-[70ch] text-[0.875rem] leading-relaxed">
            Los valores iniciales son{" "}
            <strong className="text-ink-2 font-bold">ejemplos</strong>, no
            tarifas oficiales. Puedes modificarlos.
            {advanced ? null : (
              <>
                {" "}
                Supuestos del modo sencillo: gasolina{" "}
                {decimal(EXAMPLE_INPUTS.gasolineConsumption)} L/100 km, diésel{" "}
                {decimal(EXAMPLE_INPUTS.dieselConsumption)} L/100 km, eléctrico{" "}
                {decimal(EXAMPLE_INPUTS.electricConsumption)} kWh/100 km y
                proyección a {EXAMPLE_INPUTS.years} años. Usa el modo
                personalizado si conoces los consumos de tu coche.
              </>
            )}
          </p>
        </section>

        <section aria-labelledby="results-title" className="comparison-results">
          <h2
            id="results-title"
            className="text-ink text-[1.375rem] font-extrabold tracking-[-0.02em]"
          >
            Gasto energético estimado
          </h2>
          {result ? (
            <>
              <p className="num text-muted mt-1.5 text-[0.9375rem]">
                Para {decimal(inputs.annualKm)} km al año y una proyección a{" "}
                {inputs.years} años.
              </p>
              <div className="results-chart">
                {costs.map(({ name, unit, data }) => (
                  <ResultRow
                    key={name}
                    name={name}
                    units={`${decimal(data.annualUnits)} ${unit}/año`}
                    annual={data.annualEuros}
                    period={`${inputs.years} años: ${euros(data.periodEuros)}`}
                    share={Math.max(0.015, data.annualEuros / maxCost)}
                    cheapest={data.annualEuros === minCost}
                  />
                ))}
              </div>

              <h3 className="text-ink mt-12 text-[1.375rem] font-extrabold tracking-[-0.02em]">
                Diferencia del eléctrico
              </h3>
              <div
                className="mt-5 grid gap-8 md:grid-cols-2 md:gap-12"
                aria-live="polite"
              >
                {(
                  [
                    ["Frente a gasolina", result.electricVs.gasoline],
                    ["Frente a diésel", result.electricVs.diesel],
                  ] as const
                ).map(([name, difference]) => {
                  const cheaper = difference.annualEuros >= 0;
                  const comparison = cheaper ? "menos" : "más";
                  return (
                    <div key={name} className="comparison-difference">
                      <p className="text-ink-2 text-[0.875rem] font-extrabold">
                        {name}
                      </p>
                      <p
                        className={`num mt-1.5 text-[2.5rem] leading-none font-extrabold tracking-[-0.04em] md:text-[2.875rem] ${cheaper ? "text-positive" : "text-dear"}`}
                      >
                        {euros(Math.abs(difference.annualEuros))}
                        <span className="text-muted ml-1.5 text-[0.9375rem] font-bold tracking-normal">
                          {comparison} al año
                        </span>
                      </p>
                      <p className="num text-ink-2 mt-2 text-[0.875rem]">
                        {decimal(Math.abs(difference.percent))} % {comparison}{" "}
                        de gasto energético ·{" "}
                        {euros(Math.abs(difference.periodEuros))} {comparison}{" "}
                        en {inputs.years} años
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p
              role="status"
              className="mt-4 rounded-xl bg-amber-50 px-4 pt-3.5 pb-3 text-[0.9375rem] text-amber-950"
            >
              Revisa los campos marcados: el cálculo se mostrará cuando todos
              los valores sean válidos.
            </p>
          )}
        </section>
        <div className="comparison-scope pt-5 shadow-[inset_0_1px_0_var(--line-soft)]">
          <h3 className="text-ink text-[0.9375rem] font-extrabold">
            Coste energético, no coste total de propiedad
          </h3>
          <p className="text-muted mt-1.5 text-[0.875rem] leading-relaxed">
            Solo incluye el gasto en carburante o electricidad. No incluye
            compra, financiación, seguros, mantenimiento, impuestos ni
            variaciones futuras de precios. Un menor gasto energético no
            garantiza un menor coste total.
          </p>
        </div>
      </div>
    </main>
  );
}
