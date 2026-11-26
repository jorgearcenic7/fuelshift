import type { FuelCode, Station } from "@/domain/stations";

/** Estación mínima para pruebas: datos simulados, nunca se muestran en la web. */
export function testStation(
  id: string,
  latitude: number,
  longitude: number,
  fuels: Partial<Record<FuelCode, string>> = {},
): Station {
  return {
    id,
    municipality_id: "0000",
    municipality: `Municipio ${id}`,
    locality: null,
    postal_code: "00000",
    address: `Calle ${id}`,
    brand: null,
    opening_hours: null,
    location: { latitude, longitude },
    fuels,
    provinceId: "00",
    provinceName: "Prueba",
  };
}
