import { FUEL_LABELS, type FuelCode, type Station } from "@/domain/stations";

const SCHEMA_VERSION = "1.0.0";
const DEFAULT_DATA_ROOT = "/data/miteco/";

export interface ManifestProvince {
  id: string;
  name: string;
  file: string;
  station_count: number;
  bytes: number;
  sha256: string;
}

export interface MitecoManifest {
  schema_version: string;
  retrieved_at: string;
  station_count: number;
  province_count: number;
  provinces: ManifestProvince[];
  source: {
    attribution: string;
    catalog: string;
    documentation: string;
    license: { id: string; url: string };
    reported_at: {
      raw: string;
      local: string;
      timezone: null;
    };
    url: string;
  };
}

export interface ProvinceDataset {
  schema_version: string;
  province: { id: string; name: string };
  stations: Station[];
}

export class DataContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataContractError";
  }
}

const responseCache = new Map<string, unknown>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new DataContractError(`El campo ${field} no es una cadena válida.`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DataContractError(`El campo ${field} no es un número válido.`);
  }
  return value;
}

function parseNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

export function parseManifest(value: unknown): MitecoManifest {
  if (!isRecord(value)) {
    throw new DataContractError("El manifiesto no es un objeto JSON.");
  }
  if (value.schema_version !== SCHEMA_VERSION) {
    throw new DataContractError("La versión del manifiesto no es compatible.");
  }
  if (!Array.isArray(value.provinces) || !isRecord(value.source)) {
    throw new DataContractError(
      "El manifiesto no contiene provincias o fuente válidas.",
    );
  }

  const source = value.source;
  if (!isRecord(source.license) || !isRecord(source.reported_at)) {
    throw new DataContractError("La fuente del manifiesto está incompleta.");
  }
  if (source.reported_at.timezone !== null) {
    throw new DataContractError(
      "La zona horaria de MITECO debe permanecer sin atribuir.",
    );
  }

  const provinces = value.provinces.map((province, index) => {
    if (!isRecord(province)) {
      throw new DataContractError(`La provincia ${index} no es válida.`);
    }
    const file = requiredString(province.file, `provinces[${index}].file`);
    if (!/^provinces\/\d{2}\.json$/.test(file)) {
      throw new DataContractError(`La ruta provincial ${file} no es segura.`);
    }
    return {
      id: requiredString(province.id, `provinces[${index}].id`),
      name: requiredString(province.name, `provinces[${index}].name`),
      file,
      station_count: requiredNumber(
        province.station_count,
        `provinces[${index}].station_count`,
      ),
      bytes: requiredNumber(province.bytes, `provinces[${index}].bytes`),
      sha256: requiredString(province.sha256, `provinces[${index}].sha256`),
    };
  });

  const provinceCount = requiredNumber(value.province_count, "province_count");
  if (provinceCount !== provinces.length) {
    throw new DataContractError("El recuento de provincias no coincide.");
  }
  const stationCount = requiredNumber(value.station_count, "station_count");
  const provincialStationCount = provinces.reduce(
    (total, province) => total + province.station_count,
    0,
  );
  if (stationCount !== provincialStationCount) {
    throw new DataContractError(
      "El recuento nacional de estaciones no coincide.",
    );
  }

  return {
    schema_version: SCHEMA_VERSION,
    retrieved_at: requiredString(value.retrieved_at, "retrieved_at"),
    station_count: stationCount,
    province_count: provinceCount,
    provinces,
    source: {
      attribution: requiredString(source.attribution, "source.attribution"),
      catalog: requiredString(source.catalog, "source.catalog"),
      documentation: requiredString(
        source.documentation,
        "source.documentation",
      ),
      license: {
        id: requiredString(source.license.id, "source.license.id"),
        url: requiredString(source.license.url, "source.license.url"),
      },
      reported_at: {
        raw: requiredString(source.reported_at.raw, "source.reported_at.raw"),
        local: requiredString(
          source.reported_at.local,
          "source.reported_at.local",
        ),
        timezone: null,
      },
      url: requiredString(source.url, "source.url"),
    },
  };
}

export function parseProvince(value: unknown): ProvinceDataset {
  if (!isRecord(value) || value.schema_version !== SCHEMA_VERSION) {
    throw new DataContractError(
      "El archivo provincial no usa el contrato compatible.",
    );
  }
  if (!isRecord(value.province) || !Array.isArray(value.stations)) {
    throw new DataContractError("El archivo provincial está incompleto.");
  }

  const province = {
    id: requiredString(value.province.id, "province.id"),
    name: requiredString(value.province.name, "province.name"),
  };
  const seenIds = new Set<string>();

  const stations = value.stations.map((candidate, index): Station => {
    if (
      !isRecord(candidate) ||
      !isRecord(candidate.location) ||
      !isRecord(candidate.fuels)
    ) {
      throw new DataContractError(`La estación ${index} no es válida.`);
    }
    const id = requiredString(candidate.id, `stations[${index}].id`);
    if (seenIds.has(id)) {
      throw new DataContractError(
        `El identificador ${id} está duplicado en la provincia.`,
      );
    }
    seenIds.add(id);

    const fuels: Partial<Record<FuelCode, string>> = {};
    for (const [code, rawPrice] of Object.entries(candidate.fuels)) {
      if (!Object.hasOwn(FUEL_LABELS, code)) {
        throw new DataContractError(
          `El combustible ${code} no está definido en el contrato.`,
        );
      }
      const price = requiredString(
        rawPrice,
        `stations[${index}].fuels.${code}`,
      );
      if (!/^\d+(?:\.\d+)?$/.test(price) || Number(price) <= 0) {
        throw new DataContractError(`El precio de ${code} no es válido.`);
      }
      fuels[code as FuelCode] = price;
    }

    const latitude = requiredNumber(
      candidate.location.latitude,
      `stations[${index}].location.latitude`,
    );
    const longitude = requiredNumber(
      candidate.location.longitude,
      `stations[${index}].location.longitude`,
    );
    if (latitude < 27 || latitude > 44.5 || longitude < -19 || longitude > 5) {
      throw new DataContractError(
        `Las coordenadas de la estación ${id} están fuera de España.`,
      );
    }

    return {
      id,
      municipality_id: requiredString(
        candidate.municipality_id,
        `stations[${index}].municipality_id`,
      ),
      municipality: requiredString(
        candidate.municipality,
        `stations[${index}].municipality`,
      ),
      // El pipeline publica null si la localidad oficial está vacía.
      locality:
        candidate.locality === null
          ? null
          : requiredString(
              candidate.locality,
              `stations[${index}].locality`,
              true,
            ),
      postal_code: requiredString(
        candidate.postal_code,
        `stations[${index}].postal_code`,
        true,
      ),
      address: requiredString(candidate.address, `stations[${index}].address`),
      brand: parseNullableString(candidate.brand, `stations[${index}].brand`),
      opening_hours: parseNullableString(
        candidate.opening_hours,
        `stations[${index}].opening_hours`,
      ),
      location: { latitude, longitude },
      fuels,
      provinceId: province.id,
      provinceName: province.name,
    };
  });

  return { schema_version: SCHEMA_VERSION, province, stations };
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  if (responseCache.has(url)) return responseCache.get(url);

  // "no-cache" revalida con el servidor y reutiliza la copia HTTP si no cambió.
  const response = await fetch(url, { signal, cache: "no-cache" });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "No hay datos MITECO preparados para la web."
        : `No se pudo cargar ${url} (HTTP ${response.status}).`,
    );
  }
  const value: unknown = await response.json();
  responseCache.set(url, value);
  return value;
}

export async function loadMitecoManifest(
  signal: AbortSignal,
  dataRoot = DEFAULT_DATA_ROOT,
): Promise<MitecoManifest> {
  return parseManifest(await fetchJson(`${dataRoot}manifest.json`, signal));
}

export async function loadMitecoStations({
  manifest,
  signal,
  onProvince,
  dataRoot = DEFAULT_DATA_ROOT,
  concurrency = 4,
}: {
  manifest: MitecoManifest;
  signal: AbortSignal;
  onProvince: (province: ProvinceDataset, completed: number) => void;
  dataRoot?: string;
  concurrency?: number;
}): Promise<{ failed: string[] }> {
  let nextIndex = 0;
  let completed = 0;
  const failed: string[] = [];

  async function worker() {
    while (!signal.aborted) {
      const index = nextIndex++;
      const entry = manifest.provinces[index];
      if (!entry) return;
      try {
        const dataset = parseProvince(
          await fetchJson(`${dataRoot}${entry.file}`, signal),
        );
        if (
          dataset.province.id !== entry.id ||
          dataset.stations.length !== entry.station_count
        ) {
          throw new DataContractError(
            `La provincia ${entry.id} no coincide con el manifiesto.`,
          );
        }
        completed += 1;
        onProvince(dataset, completed);
      } catch (error) {
        if (signal.aborted) return;
        failed.push(
          error instanceof Error
            ? `${entry.name}: ${error.message}`
            : entry.name,
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), manifest.provinces.length) },
      worker,
    ),
  );
  return { failed };
}

export function clearMitecoCacheForTests(): void {
  responseCache.clear();
}
