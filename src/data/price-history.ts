import type {
  HistoryObservation,
  HistoryTimeline,
} from "@/domain/price-history";
import { PRIMARY_FUELS, type FuelCode } from "@/domain/stations";

import { DataContractError } from "./miteco";

const HISTORY_SCHEMA_VERSION = "1.0.0";

/**
 * JSON estáticos que genera `scripts/price-history.mjs publish` a partir de
 * la rama de datos `data/historico`. Se descargan en el navegador al abrir
 * «Estadísticas»: el histórico no forma parte del HTML.
 */
export const HISTORY_BASE_PATH = "/data/historico";

export interface NationalHistoryEntry {
  date: string;
  retrieved_at: string;
  station_count: number;
  fuels: Partial<
    Record<
      FuelCode,
      {
        mean: number;
        min: number;
        max: number;
        count: number;
        excluded: number;
      }
    >
  >;
}

export interface NationalHistory {
  /** Registros diarios descartados al publicar por no superar la validación. */
  discarded: number;
  entries: NationalHistoryEntry[];
}

export interface ProvinceHistory {
  provinceId: string;
  entries: {
    date: string;
    fuels: Partial<Record<FuelCode, { mean: number; count: number }>>;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new DataContractError(`El campo ${field} no es un número positivo.`);
  }
  return value;
}

function count(value: unknown, field: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new DataContractError(`El campo ${field} no es un recuento válido.`);
  }
  return value as number;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new DataContractError(`El campo ${field} no es una cadena.`);
  }
  return value;
}

/** Comprueba la cabecera común y devuelve las entradas en bruto. */
function parseEntries(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || value.schema_version !== HISTORY_SCHEMA_VERSION) {
    throw new DataContractError("La versión del histórico no es compatible.");
  }
  if (!Array.isArray(value.entries)) {
    throw new DataContractError("El histórico está incompleto.");
  }
  let previousDate = "";
  return value.entries.map((raw, index) => {
    if (!isRecord(raw) || !isRecord(raw.fuels)) {
      throw new DataContractError(`La observación ${index} no es válida.`);
    }
    const date = text(raw.date, `entries[${index}].date`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= previousDate) {
      throw new DataContractError(
        `Las fechas del histórico no son únicas y crecientes (${date}).`,
      );
    }
    previousDate = date;
    return raw;
  });
}

/** Aplica `parse` a cada combustible presente; ignora claves desconocidas. */
function parseFuels<T>(
  fuels: Record<string, unknown>,
  parse: (value: Record<string, unknown>, field: string) => T,
  field: string,
): Partial<Record<FuelCode, T>> {
  return Object.fromEntries(
    PRIMARY_FUELS.filter((fuel) => fuel in fuels).map((fuel) => {
      const value = fuels[fuel];
      if (!isRecord(value)) {
        throw new DataContractError(`El campo ${field}.${fuel} no es válido.`);
      }
      return [fuel, parse(value, `${field}.${fuel}`)];
    }),
  );
}

const parseMean = (value: Record<string, unknown>, field: string) => ({
  mean: positive(value.mean, `${field}.mean`),
  count: count(value.count, `${field}.count`),
});

export function parseNationalHistory(value: unknown): NationalHistory {
  const entries = parseEntries(value).map((raw): NationalHistoryEntry => {
    const date = raw.date as string;
    return {
      date,
      retrieved_at: text(raw.retrieved_at, `${date}.retrieved_at`),
      station_count: count(raw.station_count, `${date}.station_count`),
      fuels: parseFuels(
        raw.fuels as Record<string, unknown>,
        (fuel, field) => {
          const min = positive(fuel.min, `${field}.min`);
          const max = positive(fuel.max, `${field}.max`);
          if (max < min) {
            throw new DataContractError(`${field} tiene el máximo invertido.`);
          }
          return {
            ...parseMean(fuel, field),
            min,
            max,
            excluded: count(fuel.excluded, `${field}.excluded`, 0),
          };
        },
        date,
      ),
    };
  });
  return {
    discarded: count(
      (value as { discarded?: unknown }).discarded,
      "discarded",
      0,
    ),
    entries,
  };
}

export function parseProvinceHistory(
  value: unknown,
  provinceId: string,
): ProvinceHistory {
  const entries = parseEntries(value).map((raw) => {
    const date = raw.date as string;
    return {
      date,
      fuels: parseFuels(raw.fuels as Record<string, unknown>, parseMean, date),
    };
  });
  if ((value as { province_id?: unknown }).province_id !== provinceId) {
    throw new DataContractError(
      `El histórico no corresponde a la provincia ${provinceId}.`,
    );
  }
  return { provinceId, entries };
}

export function historyTimeline(
  history: NationalHistory,
): HistoryTimeline | null {
  const first = history.entries[0]?.date;
  const last = history.entries.at(-1)?.date;
  return first && last ? { first, last } : null;
}

/** Observaciones de un combustible, nacionales o de una provincia. */
export function historyObservations(
  history: NationalHistory | ProvinceHistory,
  fuel: FuelCode,
): HistoryObservation[] {
  return history.entries.flatMap(({ date, fuels }) => {
    const value = fuels[fuel];
    return value ? [{ date, mean: value.mean, count: value.count }] : [];
  });
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** `null` si el archivo no está publicado (404): todavía no hay histórico. */
async function fetchHistoryJson(
  file: string,
  fetchImpl: Fetch,
): Promise<unknown | null> {
  const response = await fetchImpl(`${HISTORY_BASE_PATH}/${file}`, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new DataContractError(
      `No se pudo descargar el histórico (HTTP ${response.status}).`,
    );
  }
  return response.json();
}

export async function fetchNationalHistory(
  fetchImpl: Fetch = fetch,
): Promise<NationalHistory | null> {
  const value = await fetchHistoryJson("nacional.json", fetchImpl);
  return value === null ? null : parseNationalHistory(value);
}

export async function fetchProvinceHistory(
  provinceId: string,
  fetchImpl: Fetch = fetch,
): Promise<ProvinceHistory | null> {
  if (!/^\d{2}$/.test(provinceId)) {
    throw new DataContractError(`La provincia ${provinceId} no es válida.`);
  }
  const value = await fetchHistoryJson(
    `provincias/${provinceId}.json`,
    fetchImpl,
  );
  return value === null ? null : parseProvinceHistory(value, provinceId);
}
