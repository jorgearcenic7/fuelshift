import {
  MONTHLY_FUELS,
  type MonthlyFuel,
  type MonthlyObservation,
} from "@/domain/monthly-history";

import { DataContractError } from "./miteco";

const ROOT = "/data/historico-miteco";
export const MITECO_HISTORY_SOURCE =
  "https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/help";
export interface MonthlyManifest {
  generation: string;
  firstDate: string;
  lastDate: string;
  retrievedAt: string;
  scopes: { id: string; name: string }[];
  sampleCount: number;
  expectedCount: number;
}
export interface MonthlyHistory {
  points: MonthlyObservation[];
  missingDates: string[];
  firstDate: string;
  lastDate: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DataContractError("Objeto de histórico inválido.");
  return value as Record<string, unknown>;
}

function month(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value) ||
    value < "2007-01-01"
  )
    throw new DataContractError("Fecha mensual inválida.");
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new DataContractError("Recuento de muestras inválido.");
  return value;
}

function nextMonth(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

export function parseMonthlyManifest(value: unknown): MonthlyManifest {
  const raw = record(value);
  if (
    raw.schema_version !== "1.0.0" ||
    raw.frequency !== "monthly-snapshot" ||
    raw.unit !== "EUR/L" ||
    raw.sample_day !== 1 ||
    raw.source_url !== MITECO_HISTORY_SOURCE
  )
    throw new DataContractError("Contrato del histórico mensual incompatible.");
  if (
    typeof raw.generation !== "string" ||
    !/^[a-f0-9]{20}$/.test(raw.generation)
  )
    throw new DataContractError("Generación del histórico inválida.");
  if (
    !Array.isArray(raw.fuels) ||
    raw.fuels.length !== MONTHLY_FUELS.length ||
    !MONTHLY_FUELS.every(
      (fuel) => raw.fuels instanceof Array && raw.fuels.includes(fuel),
    )
  )
    throw new DataContractError("Combustibles del histórico inválidos.");
  const firstDate = month(raw.first_date),
    lastDate = month(raw.last_date);
  if (
    lastDate < firstDate ||
    !Array.isArray(raw.scopes) ||
    raw.scopes.length !== 53
  )
    throw new DataContractError("Cobertura del histórico inválida.");
  const ids = new Set<string>();
  const scopes = raw.scopes.map((item) => {
    const scope = record(item);
    if (
      typeof scope.id !== "string" ||
      !/^(ES|0[1-9]|[1-4][0-9]|5[0-2])$/.test(scope.id) ||
      ids.has(scope.id) ||
      typeof scope.name !== "string" ||
      !scope.name.trim()
    )
      throw new DataContractError("Ámbito del histórico inválido.");
    ids.add(scope.id);
    return { id: scope.id, name: scope.name };
  });
  if (
    typeof raw.retrieved_at !== "string" ||
    !/T.*(Z|[+-]\d{2}:\d{2})$/.test(raw.retrieved_at) ||
    !Number.isFinite(Date.parse(raw.retrieved_at)) ||
    raw.retrieved_at.slice(0, 10) < lastDate
  )
    throw new DataContractError("Actualización del histórico inválida.");
  const sampleCount = count(raw.sample_count),
    expectedCount = count(raw.expected_count);
  const expected =
    (Number(lastDate.slice(0, 4)) - Number(firstDate.slice(0, 4))) * 12 +
    Number(lastDate.slice(5, 7)) -
    Number(firstDate.slice(5, 7)) +
    1;
  if (
    expectedCount !== expected ||
    sampleCount < 1 ||
    sampleCount > expectedCount
  )
    throw new DataContractError("Cobertura de muestras inconsistente.");
  return {
    generation: raw.generation,
    firstDate,
    lastDate,
    retrievedAt: raw.retrieved_at,
    scopes,
    sampleCount,
    expectedCount,
  };
}

export function parseMonthlyHistory(
  value: unknown,
  manifest: MonthlyManifest,
  scope: string,
  fuel: MonthlyFuel,
): MonthlyHistory {
  const raw = record(value);
  if (
    raw.schema_version !== "1.0.0" ||
    raw.frequency !== "monthly-snapshot" ||
    raw.unit !== "EUR/L" ||
    raw.scope !== scope ||
    raw.fuel !== fuel ||
    !manifest.scopes.some((s) => s.id === scope)
  )
    throw new DataContractError("Serie mensual incompatible con la selección.");
  if (
    !Array.isArray(raw.observations) ||
    raw.observations.length !== manifest.expectedCount
  )
    throw new DataContractError("Cobertura mensual incompleta.");
  const points: MonthlyObservation[] = [],
    missingDates: string[] = [];
  let expected = manifest.firstDate;
  for (const item of raw.observations) {
    if (
      !Array.isArray(item) ||
      item.length !== 3 ||
      month(item[0]) !== expected
    )
      throw new DataContractError("Fechas mensuales desordenadas o ausentes.");
    const [date, price, rawCount] = item;
    const n = count(rawCount);
    if (price === null && n === 0) missingDates.push(date);
    else if (
      typeof price === "number" &&
      Number.isFinite(price) &&
      price >= 0.1 &&
      price <= 10 &&
      n > 0
    )
      points.push({ date, price, count: n });
    else
      throw new DataContractError(
        "Precio o cobertura de la muestra inválidos.",
      );
    expected = nextMonth(expected);
  }
  return {
    points,
    missingDates,
    firstDate: manifest.firstDate,
    lastDate: manifest.lastDate,
  };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export async function fetchMonthlyManifest(
  fetchImpl: Fetch = fetch,
): Promise<MonthlyManifest | null> {
  const response = await fetchImpl(`${ROOT}/manifest.json`, {
    cache: "no-cache",
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new DataContractError("No se pudo cargar el histórico mensual.");
  return parseMonthlyManifest(await response.json());
}
export async function fetchMonthlyHistory(
  manifest: MonthlyManifest,
  scope: string,
  fuel: MonthlyFuel,
  fetchImpl: Fetch = fetch,
): Promise<MonthlyHistory> {
  if (
    !manifest.scopes.some((s) => s.id === scope) ||
    !MONTHLY_FUELS.includes(fuel)
  )
    throw new DataContractError("Selección de histórico inválida.");
  const response = await fetchImpl(
    `${ROOT}/sets/${manifest.generation}/${scope}/${fuel}.json`,
  );
  if (!response.ok)
    throw new DataContractError("No se pudo cargar la serie mensual.");
  return parseMonthlyHistory(await response.json(), manifest, scope, fuel);
}
