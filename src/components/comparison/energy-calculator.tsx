"use client";

import { useEffect, useMemo, useState } from "react";
import {
  calculateEnergyComparison,
  EXAMPLE_INPUTS,
  type EnergyInputs,
} from "@/domain/energy-comparison";

type Field = keyof EnergyInputs;
type Values = Record<Field, string>;
const defaults = Object.fromEntries(
  Object.entries(EXAMPLE_INPUTS).map(([key, value]) => [key, String(value)]),
) as Values;
const euros = (value: number) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
const decimal = (value: number) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value);

function NumericField({
  label,
  unit,
  field,
  value,
  setValue,
  min = 0.01,
  max = 100000,
  step = "any",
}: {
  label: string;
  unit: string;
  field: Field;
  value: string;
  setValue: (field: Field, value: string) => void;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="text-muted mb-1 block text-sm font-medium">
        {label} ({unit})
      </span>
      <input
        className="control h-11 tabular-nums"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => setValue(field, event.target.value)}
      />
    </label>
  );
}

export function EnergyCalculator() {
  const [values, setValues] = useState<Values>(defaults);
  const [advanced, setAdvanced] = useState(false);
  const [stationReference, setStationReference] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const fuel = query.get("fuel");
    const price = query.get("price");
    const field =
      fuel === "diesel_a"
        ? "dieselPrice"
        : fuel === "gasoline_95_e5" || fuel === "gasoline_98_e5"
          ? "gasolinePrice"
          : null;
    if (
      !field ||
      !price ||
      !/^\d{1,2}(?:\.\d{1,3})?$/.test(price) ||
      Number(price) < 0.01 ||
      Number(price) > 10
    )
      return;
    setValues((current) => ({ ...current, [field]: price }));
    const station = query.get("station");
    setStationReference(
      station && /^\d{1,10}$/.test(station)
        ? `Precio de la estación MITECO ${station} precargado desde el mapa (editable).`
        : "Precio precargado desde el mapa (editable).",
    );
  }, []);

  const setValue = (field: Field, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === "gasolinePrice" || field === "dieselPrice")
      setStationReference(null);
  };
  const inputs = useMemo(() => {
    const parsed = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value.trim() === "" ? Number.NaN : Number(value),
      ]),
    ) as unknown as EnergyInputs;
    return advanced
      ? parsed
      : {
          ...parsed,
          years: EXAMPLE_INPUTS.years,
          gasolineConsumption: EXAMPLE_INPUTS.gasolineConsumption,
          dieselConsumption: EXAMPLE_INPUTS.dieselConsumption,
          electricConsumption: EXAMPLE_INPUTS.electricConsumption,
        };
  }, [values, advanced]);
  const result = calculateEnergyComparison(inputs);
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
          className="border-line rounded-2xl border bg-white p-5 shadow-sm sm:p-6"
          aria-labelledby="inputs-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="inputs-title" className="text-lg font-semibold">
              Tus datos
            </h2>
            <button
              type="button"
              className="text-accent text-sm font-semibold hover:underline"
              onClick={() => {
                setValues(defaults);
                setStationReference(null);
              }}
            >
              Restablecer ejemplo
            </button>
          </div>
          <div
            className="bg-canvas mt-4 grid grid-cols-2 gap-1 rounded-xl p-1"
            role="group"
            aria-label="Modo"
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
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${advanced === value ? "text-accent-strong bg-white shadow-sm" : "text-muted"}`}
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
            <NumericField
              field="annualKm"
              label="Kilómetros al año"
              unit="km/año"
              value={values.annualKm}
              setValue={setValue}
              min={1}
              max={150000}
              step="1"
            />
            <fieldset>
              <legend className="mb-3 text-sm font-semibold">
                Precio de la energía
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumericField
                  field="gasolinePrice"
                  label="Gasolina"
                  unit="€/L"
                  value={values.gasolinePrice}
                  setValue={setValue}
                  max={10}
                />
                <NumericField
                  field="dieselPrice"
                  label="Diésel"
                  unit="€/L"
                  value={values.dieselPrice}
                  setValue={setValue}
                  max={10}
                />
                <NumericField
                  field="electricPrice"
                  label="Electricidad"
                  unit="€/kWh"
                  value={values.electricPrice}
                  setValue={setValue}
                  min={0}
                  max={5}
                />
              </div>
              {stationReference ? (
                <p role="status" className="text-accent mt-2 text-xs">
                  {stationReference} Comprueba su antigüedad en el mapa.
                </p>
              ) : null}
            </fieldset>
            {advanced ? (
              <fieldset>
                <legend className="mb-3 text-sm font-semibold">
                  Consumos y plazo
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <NumericField
                    field="gasolineConsumption"
                    label="Consumo gasolina"
                    unit="L/100 km"
                    value={values.gasolineConsumption}
                    setValue={setValue}
                    max={60}
                  />
                  <NumericField
                    field="dieselConsumption"
                    label="Consumo diésel"
                    unit="L/100 km"
                    value={values.dieselConsumption}
                    setValue={setValue}
                    max={60}
                  />
                  <NumericField
                    field="electricConsumption"
                    label="Consumo eléctrico"
                    unit="kWh/100 km"
                    value={values.electricConsumption}
                    setValue={setValue}
                    max={120}
                  />
                  <NumericField
                    field="years"
                    label="Proyección"
                    unit="años"
                    value={values.years}
                    setValue={setValue}
                    min={1}
                    max={20}
                    step="1"
                  />
                </div>
              </fieldset>
            ) : (
              <p className="bg-accent-soft text-accent-strong rounded-xl p-3 text-xs leading-6">
                Supuestos: gasolina 6,5 L/100 km, diésel 5,5 L/100 km, eléctrico
                17 kWh/100 km, durante 5 años. Personaliza los consumos si
                conoces los de tu coche.
              </p>
            )}
          </div>
        </section>
        <section
          className="border-line rounded-2xl border bg-white p-5 shadow-sm sm:p-6"
          aria-labelledby="results-title"
        >
          <h2 id="results-title" className="text-lg font-semibold">
            Gasto energético estimado
          </h2>
          {result ? (
            <>
              <p className="text-muted mt-1 text-sm">
                Para {decimal(inputs.annualKm)} km al año.
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
                      [
                        "Frente a gasolina",
                        result.gasolineVsElectricEuros,
                        result.gasolineVsElectricPercent,
                      ],
                      [
                        "Frente a diésel",
                        result.dieselVsElectricEuros,
                        result.dieselVsElectricPercent,
                      ],
                    ] as const
                  ).map(([name, diff, percent]) => (
                    <div
                      key={name}
                      className={`rounded-xl border p-4 ${diff >= 0 ? "bg-positive-soft border-emerald-200" : "border-amber-200 bg-amber-50"}`}
                    >
                      <p className="text-muted text-xs font-medium">{name}</p>
                      <p
                        className={`mt-1 text-2xl font-bold tabular-nums ${diff >= 0 ? "text-positive" : "text-amber-900"}`}
                      >
                        {euros(Math.abs(diff))}
                      </p>
                      <p className="mt-1 text-xs">
                        {diff >= 0 ? "Menor" : "Mayor"} gasto anual (
                        {decimal(Math.abs(percent))} %)
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"
            >
              Revisa los datos: introduce valores válidos para calcular el
              gasto.
            </p>
          )}
          <p className="border-line text-muted mt-6 border-t pt-4 text-xs leading-5">
            <strong>Solo coste de energía.</strong> No incluye compra,
            financiación, seguros, mantenimiento, impuestos ni variaciones
            futuras de precios. Un menor gasto energético no garantiza menor
            coste total de propiedad.
          </p>
        </section>
      </div>
    </main>
  );
}
