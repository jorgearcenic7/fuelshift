import type { InputLimit } from "@/domain/energy-comparison";
import { priceUnit } from "@/domain/fuel-units";
import type { FuelCode } from "@/domain/stations";
import type { RoadLeg } from "./road-routing";

/**
 * Rentabilidad de ir a repostar a una estación. Todo es cálculo de FuelShift
 * sobre tres tipos de dato que se mantienen separados:
 * - precios oficiales de MITECO (€/L o €/kg según el producto);
 * - supuestos del usuario (cantidad y consumo, en la unidad del precio);
 * - distancias y tiempos por carretera del proveedor de rutas.
 *
 * No se monetizan el tiempo ni los peajes: requieren supuestos que el usuario
 * no ha dado. El tiempo adicional se informa aparte, sin convertirlo en euros.
 */

/** El AdBlue no mueve el vehículo: repostarlo no admite el cálculo por consumo. */
export type RefuelFuel = Exclude<FuelCode, "adblue">;

export function isRefuelFuel(fuel: FuelCode): fuel is RefuelFuel {
  return fuel !== "adblue";
}

/** Unidad de cantidad y consumo: la misma del precio, para no mezclar litros y kilos. */
export function quantityUnit(fuel: RefuelFuel): "L" | "kg" {
  return priceUnit(fuel) === "€/kg" ? "kg" : "L";
}

export interface RefuelAssumptions {
  fuel: RefuelFuel;
  /** Cantidad a repostar, en litros o kilos según `quantityUnit`. */
  quantity: number;
  /** Consumo del vehículo en esa misma unidad por cada 100 km. */
  consumptionPer100Km: number;
}

type AssumptionField = Exclude<keyof RefuelAssumptions, "fuel">;

export const REFUEL_INPUT_LIMITS: Readonly<
  Record<AssumptionField, InputLimit>
> = {
  quantity: { min: 1, max: 200 },
  consumptionPer100Km: { min: 0.5, max: 60 },
};

export function findInvalidRefuelInputs(
  assumptions: RefuelAssumptions,
): AssumptionField[] {
  return (Object.keys(REFUEL_INPUT_LIMITS) as AssumptionField[]).filter(
    (field) => {
      const value = assumptions[field];
      const { min, max } = REFUEL_INPUT_LIMITS[field];
      return !Number.isFinite(value) || value < min || value > max;
    },
  );
}

/**
 * Qué kilómetros se atribuyen al repostaje:
 * - `dedicated-trip`: salir del origen solo para repostar y volver (ida + vuelta);
 * - `detour`: lo que se añade a un viaje que se haría igualmente
 *   (origen → estación → destino menos origen → destino).
 */
export type RefuelMovement = "dedicated-trip" | "detour";

export function dedicatedTripLeg(outbound: RoadLeg, back: RoadLeg): RoadLeg {
  return {
    distanceMeters: outbound.distanceMeters + back.distanceMeters,
    durationSeconds: outbound.durationSeconds + back.durationSeconds,
  };
}

/**
 * Desvío incremental respecto al trayecto directo. Una estación sobre la propia
 * ruta puede dar un valor ligeramente negativo por el redondeo del proveedor o
 * por el ajuste del punto a la vía; se acota a cero en lugar de presentarlo
 * como un atajo.
 */
export function detourLeg(
  direct: RoadLeg,
  toStation: RoadLeg,
  fromStation: RoadLeg,
): RoadLeg {
  return {
    distanceMeters: Math.max(
      0,
      toStation.distanceMeters +
        fromStation.distanceMeters -
        direct.distanceMeters,
    ),
    durationSeconds: Math.max(
      0,
      toStation.durationSeconds +
        fromStation.durationSeconds -
        direct.durationSeconds,
    ),
  };
}

export interface CandidateCost {
  /** Precio oficial, en la unidad del producto. */
  price: number;
  attributable: RoadLeg;
  fillCost: number;
  /** Combustible gastado en los kilómetros atribuibles, en la unidad del producto. */
  travelFuel: number;
  /**
   * Ese combustible se valora al precio de la propia estación, donde se repone.
   * Así el coste total equivale a lo pagado por acabar con el mismo depósito.
   */
  travelCost: number;
  totalCost: number;
}

export function costCandidate(
  price: number,
  attributable: RoadLeg,
  assumptions: RefuelAssumptions,
): CandidateCost {
  const fillCost = price * assumptions.quantity;
  const travelFuel =
    (attributable.distanceMeters / 1000) *
    (assumptions.consumptionPer100Km / 100);
  const travelCost = travelFuel * price;
  return {
    price,
    attributable,
    fillCost,
    travelFuel,
    travelCost,
    totalCost: fillCost + travelCost,
  };
}

/** Positivo: la estación sale más barata que la de referencia. */
export interface ReferenceComparison {
  /** Diferencia de precio por la cantidad repostada, sin contar el desplazamiento. */
  grossSaving: number;
  extraDistanceMeters: number;
  extraDurationSeconds: number;
  extraTravelCost: number;
  /** Ahorro bruto menos el coste adicional del desplazamiento. Puede ser negativo. */
  netSaving: number;
}

export function compareWithReference(
  candidate: CandidateCost,
  reference: CandidateCost,
  quantity: number,
): ReferenceComparison {
  const grossSaving = (reference.price - candidate.price) * quantity;
  const extraTravelCost = candidate.travelCost - reference.travelCost;
  return {
    grossSaving,
    extraDistanceMeters:
      candidate.attributable.distanceMeters -
      reference.attributable.distanceMeters,
    extraDurationSeconds:
      candidate.attributable.durationSeconds -
      reference.attributable.durationSeconds,
    extraTravelCost,
    netSaving: grossSaving - extraTravelCost,
  };
}

export type Profitability =
  | "reference"
  | "worthwhile"
  | "negligible"
  | "not-worthwhile";

/**
 * Margen por debajo del cual una diferencia no compensa el desplazamiento ni
 * es significativa frente a la precisión de las rutas. Supuesto de FuelShift,
 * pendiente de validar con el propietario.
 */
export const NEGLIGIBLE_SAVING_EUROS = 0.5;

export function classifyProfitability(
  netSaving: number,
  isReference: boolean,
): Profitability {
  if (isReference) return "reference";
  if (netSaving > NEGLIGIBLE_SAVING_EUROS) return "worthwhile";
  if (netSaving < -NEGLIGIBLE_SAVING_EUROS) return "not-worthwhile";
  return "negligible";
}

export interface RefuelEntry<T extends { id: string }> {
  station: T;
  price: number;
  attributable: RoadLeg;
}

export interface RefuelOption<T extends { id: string }> {
  station: T;
  cost: CandidateCost;
  versusReference: ReferenceComparison;
  profitability: Profitability;
}

export interface RefuelRanking<T extends { id: string }> {
  /** `nearest`: la de menor recorrido atribuible; `selected`: la elegida por el usuario. */
  referenceBasis: "nearest" | "selected";
  reference: RefuelOption<T>;
  /** Ordenadas por coste total ascendente, es decir, por ahorro neto descendente. */
  options: RefuelOption<T>[];
}

/**
 * Calcula coste, comparación y clasificación de cada estación con ruta y las
 * ordena. Sin estación elegida, la referencia es la más cercana por carretera:
 * la que se usaría sin comparar precios.
 */
export function rankRefuelOptions<T extends { id: string }>(
  entries: readonly RefuelEntry<T>[],
  assumptions: RefuelAssumptions,
  referenceStationId: string | null = null,
): RefuelRanking<T> | null {
  if (entries.length === 0) return null;

  const costed = entries.map((entry) => ({
    station: entry.station,
    cost: costCandidate(entry.price, entry.attributable, assumptions),
  }));

  const selected = referenceStationId
    ? costed.find(({ station }) => station.id === referenceStationId)
    : undefined;
  const nearest = costed.reduce((best, item) =>
    item.cost.attributable.distanceMeters <
      best.cost.attributable.distanceMeters ||
    (item.cost.attributable.distanceMeters ===
      best.cost.attributable.distanceMeters &&
      item.cost.price < best.cost.price)
      ? item
      : best,
  );
  const referenceItem = selected ?? nearest;

  const options = costed.map(({ station, cost }) => {
    const isReference = station.id === referenceItem.station.id;
    const versusReference = compareWithReference(
      cost,
      referenceItem.cost,
      assumptions.quantity,
    );
    return {
      station,
      cost,
      versusReference,
      profitability: classifyProfitability(
        versusReference.netSaving,
        isReference,
      ),
    };
  });
  options.sort(
    (left, right) =>
      left.cost.totalCost - right.cost.totalCost ||
      left.cost.attributable.distanceMeters -
        right.cost.attributable.distanceMeters,
  );

  return {
    referenceBasis: selected ? "selected" : "nearest",
    reference: options.find(
      ({ station }) => station.id === referenceItem.station.id,
    )!,
    options,
  };
}
