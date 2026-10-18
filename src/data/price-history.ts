import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  HistoryEntry,
  HistoryFuel,
  PriceHistory,
} from "@/domain/price-history";
import { PRIMARY_FUELS } from "@/domain/stations";

import { DataContractError } from "./miteco";

const HISTORY_SCHEMA_VERSION = "1.0.0";

/**
 * Ubicación esperada en el build. Hoy no existe: se creará solo cuando se
 * autorice la recogida automática descrita en docs/price-history.md.
 */
export const PRICE_HISTORY_FILE = path.join(
  process.cwd(),
  "public",
  "data",
  "history",
  "precios.json",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new DataContractError(`El campo ${field} no es un número positivo.`);
  }
  return value;
}

function count(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DataContractError(`El campo ${field} no es un recuento válido.`);
  }
  return value as number;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new DataContractError(`El campo ${field} no es una cadena.`);
  }
  return value;
}

function parseFuel(value: unknown, field: string): HistoryFuel {
  if (
    !isRecord(value) ||
    !isRecord(value.national) ||
    !isRecord(value.provinces)
  ) {
    throw new DataContractError(`El campo ${field} está incompleto.`);
  }
  const { national } = value;
  return {
    national: {
      mean: positive(national.mean, `${field}.national.mean`),
      min: positive(national.min, `${field}.national.min`),
      max: positive(national.max, `${field}.national.max`),
      count: count(national.count, `${field}.national.count`),
    },
    provinces: Object.fromEntries(
      Object.entries(value.provinces).map(([id, province]) => {
        if (!/^\d{2}$/.test(id) || !isRecord(province)) {
          throw new DataContractError(
            `La provincia ${id} de ${field} no es válida.`,
          );
        }
        return [
          id,
          {
            mean: positive(province.mean, `${field}.${id}.mean`),
            count: count(province.count, `${field}.${id}.count`),
          },
        ];
      }),
    ),
  };
}

export function parsePriceHistory(value: unknown): PriceHistory {
  if (!isRecord(value) || value.schema_version !== HISTORY_SCHEMA_VERSION) {
    throw new DataContractError("La versión del histórico no es compatible.");
  }
  if (!isRecord(value.source) || !Array.isArray(value.entries)) {
    throw new DataContractError("El histórico está incompleto.");
  }
  let previousDate = "";
  const entries = value.entries.map((raw, index): HistoryEntry => {
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
    const fuels = raw.fuels;
    return {
      date,
      retrieved_at: text(raw.retrieved_at, `${date}.retrieved_at`),
      reported_at: text(raw.reported_at, `${date}.reported_at`),
      station_count: count(raw.station_count, `${date}.station_count`),
      province_count: count(raw.province_count, `${date}.province_count`),
      fuels: Object.fromEntries(
        PRIMARY_FUELS.filter((fuel) => fuel in fuels).map((fuel) => [
          fuel,
          parseFuel(fuels[fuel], `${date}.${fuel}`),
        ]),
      ),
    };
  });
  return {
    source: {
      attribution: text(value.source.attribution, "source.attribution"),
      catalog: text(value.source.catalog, "source.catalog"),
      license_url: text(value.source.license_url, "source.license_url"),
    },
    entries,
  };
}

/** Solo para el servidor durante el build; `null` si aún no hay histórico. */
export async function loadPriceHistory(
  file = PRICE_HISTORY_FILE,
): Promise<PriceHistory | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return null;
    throw error;
  }
  return parsePriceHistory(JSON.parse(bytes.toString("utf8")));
}
