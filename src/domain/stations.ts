export const FUEL_LABELS = {
  adblue: "AdBlue",
  ammonia: "Amoniaco",
  biodiesel: "Biodiésel",
  bioethanol: "Bioetanol",
  compressed_natural_biogas: "Biogás natural comprimido",
  liquefied_natural_biogas: "Biogás natural licuado",
  renewable_diesel: "Diésel renovable",
  compressed_natural_gas: "Gas natural comprimido",
  liquefied_natural_gas: "Gas natural licuado",
  liquefied_petroleum_gas: "Gases licuados del petróleo",
  diesel_a: "Gasóleo A",
  diesel_b: "Gasóleo B",
  premium_diesel: "Gasóleo premium",
  gasoline_95_e10: "Gasolina 95 E10",
  gasoline_95_e25: "Gasolina 95 E25",
  gasoline_95_e5: "Gasolina 95 E5",
  premium_gasoline_95_e5: "Gasolina 95 E5 premium",
  gasoline_95_e85: "Gasolina 95 E85",
  gasoline_98_e10: "Gasolina 98 E10",
  gasoline_98_e5: "Gasolina 98 E5",
  renewable_gasoline: "Gasolina renovable",
  hydrogen: "Hidrógeno",
  methanol: "Metanol",
} as const;

export type FuelCode = keyof typeof FUEL_LABELS;

export const PRIMARY_FUELS = [
  "gasoline_95_e5",
  "gasoline_98_e5",
  "diesel_a",
] as const satisfies readonly FuelCode[];

export interface Station {
  id: string;
  municipality_id: string;
  municipality: string;
  locality: string;
  postal_code: string;
  address: string;
  brand: string | null;
  opening_hours: string | null;
  location: {
    latitude: number;
    longitude: number;
  };
  fuels: Partial<Record<FuelCode, string>>;
  provinceId: string;
  provinceName: string;
}

export interface StationFilters {
  fuel: FuelCode;
  search: string;
  brand: string;
  minPrice: number | null;
  maxPrice: number | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type StationSort = "price" | "distance";

export interface StationResult extends Station {
  distanceKm: number | null;
}

export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

export function getStationPrice(
  station: Station,
  fuel: FuelCode,
): number | null {
  const rawPrice = station.fuels[fuel];
  if (rawPrice === undefined) return null;

  const price = Number(rawPrice);
  return Number.isFinite(price) ? price : null;
}

export function distanceInKm(a: Coordinates, b: Coordinates): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const originLatitude = toRadians(a.latitude);
  const targetLatitude = toRadians(b.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(targetLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    earthRadiusKm *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function filterAndSortStations(
  stations: readonly Station[],
  filters: StationFilters,
  sort: StationSort,
  userLocation: Coordinates | null,
): StationResult[] {
  const query = normalizeSearch(filters.search);

  const filtered = stations.flatMap((station): StationResult[] => {
    const price = getStationPrice(station, filters.fuel);
    if (price === null) return [];
    if (filters.brand && station.brand !== filters.brand) return [];
    if (filters.minPrice !== null && price < filters.minPrice) return [];
    if (filters.maxPrice !== null && price > filters.maxPrice) return [];

    if (query) {
      const searchable = normalizeSearch(
        [station.municipality, station.locality, station.brand, station.address]
          .filter(Boolean)
          .join(" "),
      );
      if (!searchable.includes(query)) return [];
    }

    return [
      {
        ...station,
        distanceKm: userLocation
          ? distanceInKm(userLocation, station.location)
          : null,
      },
    ];
  });

  return filtered.sort((left, right) => {
    if (sort === "distance" && userLocation) {
      return (left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity);
    }

    return (
      (getStationPrice(left, filters.fuel) ?? Infinity) -
        (getStationPrice(right, filters.fuel) ?? Infinity) ||
      left.municipality.localeCompare(right.municipality, "es")
    );
  });
}

export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function isWithinBounds(
  location: Coordinates,
  bounds: MapBounds,
): boolean {
  return (
    location.latitude >= bounds.south &&
    location.latitude <= bounds.north &&
    location.longitude >= bounds.west &&
    location.longitude <= bounds.east
  );
}

export interface RankedStation<T extends Station = Station> {
  station: T;
  price: number;
  /** Puesto con empates: estaciones con el mismo precio comparten posición. */
  position: number;
}

export interface PriceRanking<T extends Station = Station> {
  entries: RankedStation<T>[];
  /** Estaciones con precio para el combustible dentro del ámbito. */
  total: number;
}

/**
 * Ordena por precio ascendente las estaciones recibidas (ya filtradas) y
 * devuelve las `limit` más baratas, opcionalmente limitadas a una zona.
 */
export function rankByPrice<T extends Station>(
  stations: readonly T[],
  fuel: FuelCode,
  limit: number,
  bounds: MapBounds | null = null,
): PriceRanking<T> {
  const priced = stations.flatMap((station) => {
    if (bounds && !isWithinBounds(station.location, bounds)) return [];
    const price = getStationPrice(station, fuel);
    return price === null ? [] : [{ station, price }];
  });
  priced.sort(
    (left, right) =>
      left.price - right.price ||
      left.station.municipality.localeCompare(right.station.municipality, "es"),
  );

  const entries: RankedStation<T>[] = [];
  for (const [index, item] of priced.slice(0, limit).entries()) {
    const previous = entries[index - 1];
    entries.push({
      ...item,
      position:
        previous && previous.price === item.price
          ? previous.position
          : index + 1,
    });
  }
  return { entries, total: priced.length };
}

export function getBrands(
  stations: readonly Station[],
  fuel: FuelCode,
): string[] {
  return Array.from(
    new Set(
      stations
        .filter((station) => getStationPrice(station, fuel) !== null)
        .map((station) => station.brand)
        .filter((brand): brand is string => Boolean(brand)),
    ),
  ).sort((left, right) => left.localeCompare(right, "es"));
}
