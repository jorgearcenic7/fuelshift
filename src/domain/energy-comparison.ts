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

export interface EnergyComparison {
  gasoline: EnergyCost;
  diesel: EnergyCost;
  electric: EnergyCost;
  /** Positiva: eléctrico más barato. Negativa: eléctrico más caro. */
  gasolineVsElectricEuros: number;
  dieselVsElectricEuros: number;
  gasolineVsElectricPercent: number;
  dieselVsElectricPercent: number;
}

function valid(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function calculateEnergyComparison(
  inputs: EnergyInputs,
): EnergyComparison | null {
  if (
    !valid(inputs.annualKm, 1, 150000) ||
    !Number.isInteger(inputs.years) ||
    !valid(inputs.years, 1, 20) ||
    !valid(inputs.gasolineConsumption, 0.1, 60) ||
    !valid(inputs.dieselConsumption, 0.1, 60) ||
    !valid(inputs.electricConsumption, 0.1, 120) ||
    !valid(inputs.gasolinePrice, 0.01, 10) ||
    !valid(inputs.dieselPrice, 0.01, 10) ||
    !valid(inputs.electricPrice, 0, 5)
  ) {
    return null;
  }

  const cost = (consumption: number, price: number): EnergyCost => {
    const annualUnits = (inputs.annualKm * consumption) / 100;
    const annualEuros = annualUnits * price;
    return {
      annualUnits,
      annualEuros,
      periodEuros: annualEuros * inputs.years,
    };
  };
  const gasoline = cost(inputs.gasolineConsumption, inputs.gasolinePrice);
  const diesel = cost(inputs.dieselConsumption, inputs.dieselPrice);
  const electric = cost(inputs.electricConsumption, inputs.electricPrice);
  return {
    gasoline,
    diesel,
    electric,
    gasolineVsElectricEuros: gasoline.annualEuros - electric.annualEuros,
    dieselVsElectricEuros: diesel.annualEuros - electric.annualEuros,
    gasolineVsElectricPercent:
      ((gasoline.annualEuros - electric.annualEuros) / gasoline.annualEuros) *
      100,
    dieselVsElectricPercent:
      ((diesel.annualEuros - electric.annualEuros) / diesel.annualEuros) * 100,
  };
}
