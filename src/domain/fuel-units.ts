import type { FuelCode } from "./stations";

export type PriceUnit = "€/L" | "€/kg";

/**
 * Unidad de cada precio según los anexos vigentes de la Orden ITC/2308/2007,
 * modificados por la Resolución de 5 de diciembre de 2025 (BOE-A-2025-25592,
 * en vigor desde el 16 de diciembre de 2025). El conjunto de MITECO declara
 * que sus precios proceden de esa orden, cuyo anexo I.1.1 dice: «Todos los
 * precios se darán en: euros por litro G95E5, G95E5+, G95E10, G95E25, G95E85,
 * BIE, G98E5, G98E10, GOA, GOA+, GOB, GOC, BIO, GLP, ADB, DREN y GREN» y en
 * euros por kilogramo «PVPGNC, PVPGNL, PVPH2, PVPMET, PVPAMO, PVPBGNC y
 * PVPBGNL».
 *
 * Cada producto indica su campo del anexo. Que la tabla cubra todos los
 * códigos lo exige el tipo: un producto nuevo no compila sin su unidad.
 * Correspondencias y citas: docs/data-contract.md.
 */
export const FUEL_PRICE_UNITS: Readonly<Record<FuelCode, PriceUnit>> = {
  gasoline_95_e5: "€/L", // PVPG95E5
  gasoline_95_e10: "€/L", // PVPG95E10
  gasoline_95_e25: "€/L", // PVPG95E25
  gasoline_95_e85: "€/L", // PVPG95E85
  premium_gasoline_95_e5: "€/L", // PVPG95E5+, «de características mejoradas»
  gasoline_98_e5: "€/L", // PVPG98E5
  gasoline_98_e10: "€/L", // PVPG98E10
  renewable_gasoline: "€/L", // PVPGREN
  bioethanol: "€/L", // PVPBIOE (BIE en la lista de unidades)
  diesel_a: "€/L", // PVPGOA, «gasóleo de automoción (gasóleo A)»
  premium_diesel: "€/L", // PVPGOA+, gasóleo A de «características mejoradas»
  diesel_b: "€/L", // PVPGOB
  renewable_diesel: "€/L", // PVPDREN
  biodiesel: "€/L", // PVPBIOD (BIO en la lista de unidades)
  liquefied_petroleum_gas: "€/L", // PVPGLP
  adblue: "€/L", // PVPADB, «AUS 32 (AdBlue)»
  compressed_natural_gas: "€/kg", // PVPGNC
  liquefied_natural_gas: "€/kg", // PVPGNL
  compressed_natural_biogas: "€/kg", // PVPBGNC
  liquefied_natural_biogas: "€/kg", // PVPBGNL
  hydrogen: "€/kg", // PVPH2
  methanol: "€/kg", // PVPMET
  ammonia: "€/kg", // PVPAMO
};

/** Lectura completa de cada unidad para lectores de pantalla. */
export const PRICE_UNIT_NAMES: Readonly<Record<PriceUnit, string>> = {
  "€/L": "euros por litro",
  "€/kg": "euros por kilogramo",
};

export function priceUnit(fuel: FuelCode): PriceUnit {
  return FUEL_PRICE_UNITS[fuel];
}
