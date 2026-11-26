import { describe, expect, it } from "vitest";

import {
  assertMatrixRequest,
  coarsenCoordinates,
  isValidCoordinates,
  RoutingError,
  toRoadLeg,
} from "./road-routing";

const madrid = { latitude: 40.4168, longitude: -3.7038 };

describe("coordenadas", () => {
  it("acepta WGS84 y rechaza rangos imposibles, NaN y (0, 0)", () => {
    expect(isValidCoordinates(madrid)).toBe(true);
    expect(isValidCoordinates({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinates({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidCoordinates({ latitude: Number.NaN, longitude: 1 })).toBe(
      false,
    );
    expect(isValidCoordinates({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it("reduce la precisión de la ubicación enviada a cuatro decimales", () => {
    expect(
      coarsenCoordinates({ latitude: 40.416_812_3, longitude: -3.703_789_9 }),
    ).toEqual({ latitude: 40.4168, longitude: -3.7038 });
  });
});

describe("validación de matrices", () => {
  it("exige orígenes, destinos, celdas dentro del límite y coordenadas válidas", () => {
    const check = (sources: (typeof madrid)[], targets: (typeof madrid)[]) => {
      try {
        assertMatrixRequest({ sources, targets }, 2, "geoapify");
        return null;
      } catch (error) {
        return error instanceof RoutingError ? error.kind : "otro";
      }
    };
    expect(check([madrid], [madrid, madrid])).toBeNull();
    expect(check([], [madrid])).toBe("invalid-request");
    expect(check([madrid], [madrid, madrid, madrid])).toBe("invalid-request");
    expect(check([madrid], [{ latitude: 0, longitude: 0 }])).toBe(
      "invalid-request",
    );
  });

  it("convierte una celda sin valores finitos y no negativos en ruta inexistente", () => {
    expect(toRoadLeg(1200, 90)).toEqual({
      distanceMeters: 1200,
      durationSeconds: 90,
    });
    expect(toRoadLeg(null, 90)).toBeNull();
    expect(toRoadLeg(1200, undefined)).toBeNull();
    expect(toRoadLeg(-1, 90)).toBeNull();
    expect(toRoadLeg(Infinity, 90)).toBeNull();
  });
});
