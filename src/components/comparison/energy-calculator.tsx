"use client";

import { useState, useSyncExternalStore } from "react";

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

function NumericField({
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
  const errorId = `${field}-error`;
  return (
    <label className="block">
      <span className="text-muted mb-1 block text-sm font-medium">
        {label} ({unit})
      </span>
      <input
        className={`control h-11 tabular-nums ${invalid ? "border-amber-600" : ""}`}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={integer ? 1 : "any"}
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => onChange(field, event.target.value)}
      />
      {invalid ? (
        <span id={errorId} className="mt-1 block text-xs text-amber-900">
          {rangeMessage(field)}
        </span>
      ) : null}
    </label>
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

  const station = stationDismissed ? null : parseComparatorParams(search);
  const values: Values = {
    ...EXAMPLE_VALUES,
    ...(station ? { [station.field]: String(station.price) } : {}),
    ...edits,
  };
  const stationPriceInUse = station !== null && !(station.field in edits);

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
    <NumericField
      field={name}
      value={values[name]}
      invalid={invalidFields.has(name)}
      onChange={updateValue}
    />
  );

  const costs = result
    ? [
        {
          name: "Gasolina",
          color: "bg-accent",
          unit: "L",
          data: result.gasoline,
        },
        {
          name: "Diésel",
          color: "bg-slate-600",
          unit: "L",
          data: result.diesel,
        },
        {
          name: "Eléctrico",
          color: "bg-positive",
          unit: "kWh",
          data: result.electric,
        },
      ]
    : [];
  const maxCost = Math.max(1, ...costs.map(({ data }) => data.annualEuros));

  return (
    <main
      id="contenido"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <p className="text-accent text-xs font-semibold tracking-widest uppercase">
        Simulador de coste energético
      </p>
      <h1 className="text-ink mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        ¿Cuánto te cuesta conducir?
      </h1>
      <p className="text-muted mt-3 max-w-3xl leading-7">
        Compara el gasto en energía de gasolina, diésel y eléctrico para los
        mismos kilómetros. No necesitas indicar un trayecto ni compartir tu
        ubicación.
      </p>
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
        <section
          className="border-line bg-surface rounded-2xl border p-5 shadow-sm sm:p-6"
          aria-labelledby="inputs-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="inputs-title" className="text-lg font-semibold">
              Tus datos
            </h2>
            <button
              type="button"
              className="text-accent text-sm font-semibold hover:underline"
              onClick={reset}
            >
              Restablecer ejemplo
            </button>
          </div>
          <div
            className="bg-canvas mt-4 grid grid-cols-2 gap-1 rounded-xl p-1"
            role="group"
            aria-label="Modo de cálculo"
          >
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
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${advanced === value ? "bg-surface text-accent-strong shadow-sm" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-muted mt-3 text-xs leading-5">
            Los valores iniciales son <strong>ejemplos</strong>, no tarifas
            oficiales. Puedes modificarlos.
          </p>
          <div className="mt-5 space-y-4">
            {field("annualKm")}
            <fieldset>
              <legend className="mb-3 text-sm font-semibold">
                Precio de la energía
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {field("gasolinePrice")}
                {field("dieselPrice")}
                {field("electricPrice")}
              </div>
              {stationPriceInUse ? (
                <p role="status" className="text-accent mt-2 text-xs leading-5">
                  Precio de {FUEL_LABELS[station.fuel]}
                  {station.stationId
                    ? ` de la estación MITECO ${station.stationId}`
                    : ""}{" "}
                  cargado desde el mapa. Puedes editarlo; comprueba su
                  antigüedad en el mapa.
                </p>
              ) : null}
            </fieldset>
            {advanced ? (
              <fieldset>
                <legend className="mb-3 text-sm font-semibold">
                  Consumos y plazo
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {field("gasolineConsumption")}
                  {field("dieselConsumption")}
                  {field("electricConsumption")}
                  {field("years")}
                </div>
              </fieldset>
            ) : (
              <p className="bg-accent-soft text-accent-strong rounded-xl p-3 text-xs leading-6">
                Supuestos del modo sencillo: gasolina{" "}
                {decimal(EXAMPLE_INPUTS.gasolineConsumption)} L/100 km, diésel{" "}
                {decimal(EXAMPLE_INPUTS.dieselConsumption)} L/100 km, eléctrico{" "}
                {decimal(EXAMPLE_INPUTS.electricConsumption)} kWh/100 km y
                proyección a {EXAMPLE_INPUTS.years} años. Usa el modo
                personalizado si conoces los consumos de tu coche.
              </p>
            )}
          </div>
        </section>
        <section
          className="border-line bg-surface rounded-2xl border p-5 shadow-sm sm:p-6 lg:sticky lg:top-6"
          aria-labelledby="results-title"
        >
          <h2 id="results-title" className="text-lg font-semibold">
            Gasto energético estimado
          </h2>
          {result ? (
            <>
              <p className="text-muted mt-1 text-sm">
                Para {decimal(inputs.annualKm)} km al año y una proyección a{" "}
                {inputs.years} años.
              </p>
              <div className="mt-6 space-y-5">
                {costs.map(({ name, color, unit, data }) => (
                  <div key={name}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{name}</span>
                      <strong className="text-xl tabular-nums">
                        {euros(data.annualEuros)}
                        <span className="text-muted ml-1 text-xs font-normal">
                          /año
                        </span>
                      </strong>
                    </div>
                    <div className="bg-canvas mt-2 h-2.5 overflow-hidden rounded-full">
                      <div
                        aria-hidden="true"
                        className={`h-full rounded-full ${color}`}
                        style={{
                          width: `${(data.annualEuros / maxCost) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="text-muted mt-1 text-xs">
                      {decimal(data.annualUnits)} {unit}/año · {inputs.years}{" "}
                      años: {euros(data.periodEuros)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="border-line mt-7 border-t pt-5">
                <h3 className="text-sm font-semibold">
                  Diferencia del eléctrico
                </h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["Frente a gasolina", result.electricVs.gasoline],
                      ["Frente a diésel", result.electricVs.diesel],
                    ] as const
                  ).map(([name, difference]) => {
                    const cheaper = difference.annualEuros >= 0;
                    const comparison = cheaper ? "menos" : "más";
                    return (
                      <div
                        key={name}
                        className={`rounded-xl border p-4 ${cheaper ? "bg-positive-soft border-emerald-200" : "border-amber-200 bg-amber-50"}`}
                      >
                        <p className="text-muted text-xs font-medium">{name}</p>
                        <p
                          className={`mt-1 text-2xl font-bold tabular-nums ${cheaper ? "text-positive" : "text-amber-900"}`}
                        >
                          {euros(Math.abs(difference.annualEuros))}{" "}
                          <span className="text-xs font-semibold">
                            {comparison} al año
                          </span>
                        </p>
                        <p className="text-ink mt-1 text-xs leading-5">
                          {decimal(Math.abs(difference.percent))} % {comparison}{" "}
                          de gasto energético ·{" "}
                          {euros(Math.abs(difference.periodEuros))} {comparison}{" "}
                          en {inputs.years} años
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <p
              role="status"
              className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"
            >
              Revisa los campos marcados: el cálculo se mostrará cuando todos
              los valores sean válidos.
            </p>
          )}
          <div className="border-line mt-6 border-t pt-4 text-xs leading-5">
            <p className="text-ink font-semibold">
              Coste energético, no coste total de propiedad
            </p>
            <p className="text-muted mt-1">
              Solo incluye el gasto en carburante o electricidad. No incluye
              compra, financiación, seguros, mantenimiento, impuestos ni
              variaciones futuras de precios. Un menor gasto energético no
              garantiza un menor coste total.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
