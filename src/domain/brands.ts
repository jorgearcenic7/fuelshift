import { normalizeSearch } from "./stations";

/**
 * Identidad visual local de las marcas presentes en los rótulos de MITECO.
 *
 * - Los logotipos se sirven desde `public/brands/` y nunca desde servicios
 *   externos. Solo se incluyen archivos con procedencia y régimen de
 *   reutilización verificados; el detalle está en `docs/brand-logos.md`.
 * - `color` se extrae del propio logotipo incorporado. Las marcas sin logotipo
 *   verificado usan el tono neutro para no atribuirles un color no acreditado.
 * - El rótulo de una estación no identifica a su propietario: se reconoce la
 *   marca comercial que aparece escrita en él, sin inferir grupos empresariales
 *   (por ejemplo, Campsa y Petronor no se muestran como Repsol).
 */
interface BrandDefinition {
  key: string;
  name: string;
  /** Secuencias de palabras normalizadas que identifican la marca. */
  aliases: readonly string[];
  /**
   * Solo reconoce la marca al inicio del rótulo. Se usa en nombres que también
   * aparecen como palabras comunes ("Virgen de las Nieves").
   */
  anchored?: boolean;
  mark: string;
  color?: string;
  logo?: string;
}

const BRANDS: readonly BrandDefinition[] = [
  // Con logotipo verificado (ordenadas por número de estaciones).
  {
    key: "repsol",
    name: "Repsol",
    aliases: ["repsol"],
    mark: "R",
    color: "#ff7816",
    logo: "/brands/repsol.svg",
  },
  {
    key: "moeve",
    name: "Moeve",
    aliases: ["moeve"],
    mark: "M",
    color: "#047dba",
    logo: "/brands/moeve.svg",
  },
  {
    key: "cepsa",
    name: "Cepsa",
    aliases: ["cepsa"],
    mark: "C",
    color: "#d52b1e",
    logo: "/brands/cepsa.svg",
  },
  {
    key: "galp",
    name: "Galp",
    aliases: ["galp"],
    mark: "G",
    color: "#ff5a00",
    logo: "/brands/galp.svg",
  },
  {
    key: "plenergy",
    name: "Plenergy",
    aliases: ["plenergy"],
    mark: "P",
    color: "#fd8204",
    logo: "/brands/plenergy.png",
  },
  {
    key: "petronor",
    name: "Petronor",
    aliases: ["petronor"],
    mark: "P",
    color: "#233771",
    logo: "/brands/petronor.png",
  },
  {
    key: "avia",
    name: "AVIA",
    aliases: ["avia"],
    mark: "A",
    color: "#ed1c24",
    logo: "/brands/avia.svg",
  },
  {
    key: "q8",
    name: "Q8",
    aliases: ["q8"],
    mark: "Q8",
    color: "#214199",
    logo: "/brands/q8.svg",
  },
  {
    key: "alcampo",
    name: "Alcampo",
    aliases: ["alcampo"],
    mark: "A",
    color: "#e0001a",
    logo: "/brands/alcampo.png",
  },
  {
    key: "eni",
    name: "Eni",
    aliases: ["eni"],
    mark: "eni",
    color: "#fab600",
    logo: "/brands/eni.svg",
  },
  {
    key: "eroski",
    name: "Eroski",
    aliases: ["eroski"],
    mark: "E",
    color: "#e42219",
    logo: "/brands/eroski.svg",
  },
  {
    key: "meroil",
    name: "Meroil",
    aliases: ["meroil"],
    mark: "M",
    color: "#47704c",
    logo: "/brands/meroil.png",
  },
  {
    key: "naturgy",
    name: "Naturgy",
    aliases: ["naturgy"],
    mark: "N",
    color: "#e57200",
    logo: "/brands/naturgy.svg",
  },
  {
    key: "costco",
    name: "Costco",
    aliases: ["costco"],
    mark: "C",
    color: "#005daa",
    logo: "/brands/costco.svg",
  },
  // Reconocidas sin logotipo verificado: monograma en tono neutro.
  { key: "bp", name: "BP", aliases: ["bp", "b p"], mark: "bp" },
  { key: "ballenoil", name: "Ballenoil", aliases: ["ballenoil"], mark: "B" },
  { key: "shell", name: "Shell", aliases: ["shell"], mark: "S" },
  { key: "petroprix", name: "Petroprix", aliases: ["petroprix"], mark: "P" },
  { key: "carrefour", name: "Carrefour", aliases: ["carrefour"], mark: "C" },
  { key: "esclatoil", name: "Esclatoil", aliases: ["esclatoil"], mark: "E" },
  {
    key: "bonarea",
    name: "bonÀrea",
    aliases: ["bonarea", "bon area"],
    mark: "bA",
  },
  { key: "campsa", name: "Campsa", aliases: ["campsa"], mark: "C" },
  { key: "agla", name: "Agla", aliases: ["agla"], mark: "A" },
  { key: "valcarce", name: "Valcarce", aliases: ["valcarce"], mark: "V" },
  { key: "gasexpress", name: "Gasexpress", aliases: ["gasexpress"], mark: "G" },
  { key: "ham", name: "HAM", aliases: ["ham"], anchored: true, mark: "H" },
  { key: "beroil", name: "Beroil", aliases: ["beroil"], mark: "B" },
  { key: "petrocat", name: "Petrocat", aliases: ["petrocat"], mark: "P" },
  { key: "tamoil", name: "Tamoil", aliases: ["tamoil"], mark: "T" },
  { key: "gmoil", name: "GM Oil", aliases: ["gm oil", "gmoil"], mark: "GM" },
  { key: "molgas", name: "Molgas", aliases: ["molgas"], mark: "M" },
  { key: "disa", name: "DISA", aliases: ["disa"], mark: "D" },
  {
    key: "nieves",
    name: "Nieves",
    aliases: ["nieves"],
    anchored: true,
    mark: "N",
  },
  { key: "ids", name: "IDS", aliases: ["ids"], anchored: true, mark: "I" },
  { key: "autonetoil", name: "Autonetoil", aliases: ["autonetoil"], mark: "A" },
  { key: "iberdoex", name: "Iberdoex", aliases: ["iberdoex"], mark: "I" },
  {
    key: "asc",
    name: "ASC Carburantes",
    aliases: ["asc carburantes"],
    mark: "ASC",
  },
  { key: "easygas", name: "Easygas", aliases: ["easygas"], mark: "E" },
  { key: "agropal", name: "Agropal", aliases: ["agropal"], mark: "A" },
  { key: "leclerc", name: "E.Leclerc", aliases: ["e leclerc"], mark: "E" },
  {
    key: "familyenergy",
    name: "Family Energy",
    aliases: ["family energy"],
    mark: "FE",
  },
  { key: "staroil", name: "Staroil", aliases: ["staroil"], mark: "S" },
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
  /** `null` cuando la marca no está registrada o el rótulo es ambiguo. */
  key: string | null;
  /** Nombre comercial registrado o, si no se conoce, el rótulo original. */
  name: string | null;
  mark: string | null;
  color: string;
  /** Color de texto legible sobre `color`. */
  onColor: string;
  /** Ruta local del logotipo verificado, si existe. */
  logo: string | null;
  known: boolean;
}

function words(value: string): string[] {
  return normalizeSearch(value)
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean);
}

const ALIASES = BRANDS.map((definition) => ({
  definition,
  sequences: definition.aliases.map(words),
}));

function containsSequence(
  haystack: readonly string[],
  sequence: readonly string[],
  anchored: boolean,
): boolean {
  const lastStart = anchored ? 0 : haystack.length - sequence.length;
  for (let start = 0; start <= lastStart; start++) {
    if (sequence.every((word, offset) => haystack[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

/**
 * Marca comercial escrita en el rótulo. Devuelve `null` si no hay ninguna
 * registrada o si el rótulo nombra varias (por ejemplo "CEPSA-MOEVE"), porque
 * no puede decidirse cuál muestra la estación.
 */
function resolveBrand(label: string): BrandDefinition | null {
  const labelWords = words(label);
  const matches = ALIASES.filter(({ definition, sequences }) =>
    sequences.some((sequence) =>
      containsSequence(labelWords, sequence, definition.anchored === true),
    ),
  );
  return matches.length === 1 ? matches[0].definition : null;
}

export function resolveBrandKey(brand: string | null): string | null {
  return brand === null ? null : (resolveBrand(brand)?.key ?? null);
}

/** Logotipos locales registrados, para comprobar que existen. */
export function getRegisteredLogos(): string[] {
  return BRANDS.flatMap((definition) =>
    definition.logo ? [definition.logo] : [],
  );
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

function computeIdentity(brand: string | null): BrandIdentity {
  // MITECO publica algunas estaciones con el rótulo literal "(SIN RÓTULO)".
  const label =
    brand === null || normalizeSearch(brand) === "(sin rotulo)" ? null : brand;
  const definition = label === null ? null : resolveBrand(label);
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

// Hay unos pocos miles de rótulos distintos: se resuelven una sola vez.
const identityCache = new Map<string | null, BrandIdentity>();

export function getBrandIdentity(brand: string | null): BrandIdentity {
  let identity = identityCache.get(brand);
  if (!identity) {
    identity = computeIdentity(brand);
    identityCache.set(brand, identity);
  }
  return identity;
}
