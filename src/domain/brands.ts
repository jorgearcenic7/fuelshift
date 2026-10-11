import { normalizeSearch } from "./stations";

/**
 * Identidad visual local de las marcas más frecuentes en los datos de MITECO.
 *
 * - No se cargan recursos externos: la marca visual es un monograma propio y,
 *   si en el futuro se dispone de logotipos oficiales con permiso de uso, se
 *   pueden servir desde `public/brands/` mediante `logo`.
 * - Los colores son aproximaciones de la identidad pública de cada marca para
 *   usarlos solo como acento. Cuando no se ha verificado un color fiable,
 *   `color` es `null` y se usa el tono neutro.
 */
interface BrandDefinition {
  key: string;
  name: string;
  /** Palabras completas (normalizadas) que identifican la marca en el rótulo. */
  match: readonly string[];
  mark: string;
  color: string | null;
  logo?: string;
}

const BRANDS: readonly BrandDefinition[] = [
  {
    key: "repsol",
    name: "Repsol",
    match: ["repsol"],
    mark: "R",
    color: "#f37021",
  },
  {
    key: "cepsa",
    name: "Cepsa",
    match: ["cepsa"],
    mark: "C",
    color: "#e2231a",
  },
  { key: "galp", name: "Galp", match: ["galp"], mark: "G", color: "#f2672a" },
  {
    key: "shell",
    name: "Shell",
    match: ["shell"],
    mark: "S",
    color: "#fbce07",
  },
  { key: "bp", name: "BP", match: ["bp"], mark: "bp", color: "#009b3a" },
  {
    key: "carrefour",
    name: "Carrefour",
    match: ["carrefour"],
    mark: "C",
    color: "#004e9f",
  },
  { key: "avia", name: "Avia", match: ["avia"], mark: "A", color: "#e30613" },
  {
    key: "alcampo",
    name: "Alcampo",
    match: ["alcampo"],
    mark: "A",
    color: "#e2001a",
  },
  {
    key: "eroski",
    name: "Eroski",
    match: ["eroski"],
    mark: "E",
    color: "#e30613",
  },
  { key: "eni", name: "Eni", match: ["eni"], mark: "eni", color: "#ffd100" },
  // Color oficial pendiente de verificar: se muestran con el tono neutro.
  { key: "moeve", name: "Moeve", match: ["moeve"], mark: "M", color: null },
  {
    key: "ballenoil",
    name: "Ballenoil",
    match: ["ballenoil"],
    mark: "B",
    color: null,
  },
  {
    key: "plenergy",
    name: "Plenergy",
    match: ["plenergy"],
    mark: "P",
    color: null,
  },
  {
    key: "petroprix",
    name: "Petroprix",
    match: ["petroprix"],
    mark: "P",
    color: null,
  },
  {
    key: "petronor",
    name: "Petronor",
    match: ["petronor"],
    mark: "P",
    color: null,
  },
];

export const NEUTRAL_BRAND_COLOR = "#5a6b7e";
const INK = "#0f1d2e";
const WHITE = "#ffffff";

// Palabras que no identifican a la marca: formas societarias y "E.S.".
const IGNORED_WORDS = new Set([
  "sl",
  "sa",
  "slu",
  "sau",
  "sc",
  "es",
  "de",
  "la",
  "el",
  "y",
]);

export interface BrandIdentity {
  /** `null` cuando la marca no está registrada. */
  key: string | null;
  /** Nombre de marca registrado o, si no se conoce, el rótulo original. */
  name: string | null;
  mark: string | null;
  color: string;
  /** Color de texto legible sobre `color`. */
  onColor: string;
  logo: string | null;
  known: boolean;
}

function words(value: string): string[] {
  return normalizeSearch(value)
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean);
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Blanco o tinta, el que ofrezca más contraste sobre el fondo indicado. */
export function readableTextColor(background: string): string {
  return contrast(background, WHITE) >= contrast(background, INK) ? WHITE : INK;
}

function initials(brand: string): string | null {
  const meaningful = words(brand).filter(
    (word) => word.length > 1 && !IGNORED_WORDS.has(word),
  );
  if (meaningful.length === 0) return null;
  return meaningful
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function getBrandIdentity(brand: string | null): BrandIdentity {
  // MITECO publica algunas estaciones con el rótulo literal "(SIN RÓTULO)".
  const label =
    brand === null || normalizeSearch(brand) === "(sin rotulo)" ? null : brand;
  if (label !== null) {
    const brandWords = new Set(words(label));
    const definition = BRANDS.find((candidate) =>
      candidate.match.some((word) => brandWords.has(word)),
    );
    if (definition) {
      const color = definition.color ?? NEUTRAL_BRAND_COLOR;
      return {
        key: definition.key,
        name: definition.name,
        mark: definition.mark,
        color,
        onColor: readableTextColor(color),
        logo: definition.logo ?? null,
        known: true,
      };
    }
  }

  return {
    key: null,
    name: label,
    mark: label === null ? null : initials(label),
    color: NEUTRAL_BRAND_COLOR,
    onColor: readableTextColor(NEUTRAL_BRAND_COLOR),
    logo: null,
    known: false,
  };
}
