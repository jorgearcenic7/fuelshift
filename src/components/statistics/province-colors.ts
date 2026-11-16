import type { ProvinceStatistics } from "@/domain/fuel-statistics";

// Validados para daltonismo como pareja (ΔE 9,7); la dirección de la barra y
// el signo del valor también indican el sentido.
export const CHEAPER = "#0f8a5f";
export const PRICIER = "#d9442f";
// El texto necesita 4,5:1 sobre blanco; las barras, que son gráficos, 3:1.
export const PRICIER_TEXT = "#c93d29";
/** Centro de la escala del mapa: igual a la media nacional. */
export const NEUTRAL = "#ece6d6";
/** Provincias sin precio del combustible. */
export const MISSING = "#dfe3e8";

function mix(from: string, to: string, amount: number): string {
  const channel = (hex: string, index: number) =>
    Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const value = [0, 1, 2].map((index) =>
    Math.round(
      channel(from, index) +
        (channel(to, index) - channel(from, index)) * amount,
    ),
  );
  return `#${value.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Color de una provincia en el mapa: de la media (neutro) al verde o al rojo
 * según su diferencia, relativa a la mayor diferencia del combustible (la
 * misma referencia que usan las barras del ranking).
 */
export function provinceFill(
  province: ProvinceStatistics | undefined,
  largestGap: number,
): string {
  const difference = province?.differenceFromNational?.absolute;
  if (!province?.summary || difference === undefined) return MISSING;
  const amount = Math.min(1, Math.abs(difference) / Math.max(largestGap, 1e-9));
  return mix(NEUTRAL, difference < 0 ? CHEAPER : PRICIER, amount);
}
