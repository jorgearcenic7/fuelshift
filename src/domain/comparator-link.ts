import { INPUT_LIMITS } from "./energy-comparison";
import type { FuelCode } from "./stations";

/** Con `trailingSlash: true`, la exportación estática sirve la ruta con barra final. */
export const COMPARATOR_PATH = "/comparador/";

const PRICE_FIELD_BY_FUEL = {
  gasoline_95_e5: "gasolinePrice",
  gasoline_98_e5: "gasolinePrice",
  diesel_a: "dieselPrice",
} as const satisfies Partial<Record<FuelCode, "gasolinePrice" | "dieselPrice">>;

export type ComparableFuel = keyof typeof PRICE_FIELD_BY_FUEL;

export interface StationPriceParams {
  fuel: ComparableFuel;
  field: (typeof PRICE_FIELD_BY_FUEL)[ComparableFuel];
  price: number;
  stationId: string | null;
}

function isComparableFuel(fuel: string): fuel is ComparableFuel {
  return Object.hasOwn(PRICE_FIELD_BY_FUEL, fuel);
}

export function buildComparatorHref(
  stationId: string,
  fuel: FuelCode,
  price: number,
): string | null {
  if (!isComparableFuel(fuel) || !Number.isFinite(price)) return null;

  const params = new URLSearchParams({
    fuel,
    price: String(price),
    station: stationId,
  });
  return `${COMPARATOR_PATH}?${params}`;
}

/** Lee un precio enviado desde el mapa; ignora cualquier valor no esperado. */
export function parseComparatorParams(
  search: string,
): StationPriceParams | null {
  const query = new URLSearchParams(search);
  const fuel = query.get("fuel");
  const rawPrice = query.get("price");
  if (!fuel || !isComparableFuel(fuel) || !rawPrice) return null;
  if (!/^\d{1,2}(?:\.\d{1,4})?$/.test(rawPrice)) return null;

  const field = PRICE_FIELD_BY_FUEL[fuel];
  const price = Number(rawPrice);
  const { min, max } = INPUT_LIMITS[field];
  if (price < min || price > max) return null;

  const station = query.get("station");
  return {
    fuel,
    field,
    price,
    stationId: station && /^\d{1,10}$/.test(station) ? station : null,
  };
}
