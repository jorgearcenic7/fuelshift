/** Solo coste energético. No incluye adquisición, seguros ni mantenimiento. */
export interface EnergyInputs {
  annualKm: number;
  years: number;
  gasolineConsumption: number;
  dieselConsumption: number;
  electricConsumption: number;
  gasolinePrice: number;
  dieselPrice: number;
  electricPrice: number;
}

export type EnergyField = keyof EnergyInputs;

export interface InputLimit {
  min: number;
  max: number;
  integer?: boolean;
}

/** Rangos aceptados; la interfaz los reutiliza para no duplicarlos. */
export const INPUT_LIMITS: Readonly<Record<EnergyField, InputLimit>> = {
  annualKm: { min: 1, max: 150_000 },
  years: { min: 1, max: 20, integer: true },
  gasolineConsumption: { min: 0.1, max: 60 },
  dieselConsumption: { min: 0.1, max: 60 },
  electricConsumption: { min: 0.1, max: 120 },
  gasolinePrice: { min: 0.01, max: 10 },
  dieselPrice: { min: 0.01, max: 10 },
  // Se admite 0 para representar recarga gratuita de forma explícita.
  electricPrice: { min: 0, max: 5 },
};

/** Valores de ejemplo, no tarifas oficiales. */
export const EXAMPLE_INPUTS: EnergyInputs = {
  annualKm: 12000,
  years: 5,
  gasolineConsumption: 6.5,
  dieselConsumption: 5.5,
  electricConsumption: 17,
  gasolinePrice: 1.6,
  dieselPrice: 1.5,
  electricPrice: 0.2,
};

export interface EnergyCost {
  annualUnits: number;
  annualEuros: number;
  periodEuros: number;
}

/** Positivo: el eléctrico gasta menos. Negativo: gasta más. */
export interface ElectricDifference {
  annualEuros: number;
  periodEuros: number;
  /** Porcentaje sobre el gasto del vehículo de combustión. */
  percent: number;
}

export interface EnergyComparison {
  gasoline: EnergyCost;
  diesel: EnergyCost;
  electric: EnergyCost;
  electricVs: Record<"gasoline" | "diesel", ElectricDifference>;
}

function isValid(value: number, { min, max, integer }: InputLimit): boolean {
  return (
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value))
  );
}

/** Campos fuera de rango; la interfaz los marca uno a uno. */
export function findInvalidFields(inputs: EnergyInputs): EnergyField[] {
  return (Object.keys(INPUT_LIMITS) as EnergyField[]).filter(
    (field) => !isValid(inputs[field], INPUT_LIMITS[field]),
  );
}

/**
 * Gasto energético anual y del periodo para los tres vehículos, y lo que se
 * ahorra (o se gasta de más) con el eléctrico. Devuelve null si algún dato no
 * es válido, para no enseñar cifras calculadas con entradas imposibles.
 */
export function calculateEnergyComparison(
  inputs: EnergyInputs,
): EnergyComparison | null {
  if (findInvalidFields(inputs).length > 0) return null;

  // Consumo en L/100 km o kWh/100 km → unidades al año → euros.
  const cost = (consumption: number, price: number): EnergyCost => {
    const annualUnits = (inputs.annualKm * consumption) / 100;
    const annualEuros = annualUnits * price;
    return {
      annualUnits,
      annualEuros,
      periodEuros: annualEuros * inputs.years,
    };
  };
  // Positivo: el eléctrico sale más barato. El porcentaje es sobre el coste del
  // coche de combustión, que nunca es cero gracias a los mínimos de INPUT_LIMITS.
  const difference = (combustion: EnergyCost): ElectricDifference => {
    const annualEuros = combustion.annualEuros - electric.annualEuros;
    return {
      annualEuros,
      periodEuros: annualEuros * inputs.years,
      percent: (annualEuros / combustion.annualEuros) * 100,
    };
  };

  const gasoline = cost(inputs.gasolineConsumption, inputs.gasolinePrice);
  const diesel = cost(inputs.dieselConsumption, inputs.dieselPrice);
  const electric = cost(inputs.electricConsumption, inputs.electricPrice);
  return {
    gasoline,
    diesel,
    electric,
    electricVs: { gasoline: difference(gasoline), diesel: difference(diesel) },
  };
}
