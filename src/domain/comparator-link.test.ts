import { describe, expect, it } from "vitest";

import { buildComparatorHref, parseComparatorParams } from "./comparator-link";

describe("buildComparatorHref", () => {
  it("enlaza con la ruta exportada del comparador y conserva el precio", () => {
    expect(buildComparatorHref("1234", "gasoline_98_e5", 1.699)).toBe(
      "/comparador/?fuel=gasoline_98_e5&price=1.699&station=1234",
    );
  });

  it("no enlaza combustibles que el comparador no modela", () => {
    expect(buildComparatorHref("1234", "liquefied_petroleum_gas", 0.9)).toBe(
      null,
    );
  });

  it("no enlaza precios no finitos", () => {
    expect(buildComparatorHref("1234", "diesel_a", Number.NaN)).toBe(null);
  });
});

describe("parseComparatorParams", () => {
  it("recupera el precio enviado desde el mapa", () => {
    const href = buildComparatorHref("1234", "diesel_a", 1.459)!;
    expect(parseComparatorParams(href.slice(href.indexOf("?")))).toEqual({
      fuel: "diesel_a",
      field: "dieselPrice",
      price: 1.459,
      stationId: "1234",
    });
  });

  it("asigna las gasolinas 95 y 98 al precio de gasolina", () => {
    expect(parseComparatorParams("?fuel=gasoline_95_e5&price=1.5")?.field).toBe(
      "gasolinePrice",
    );
    expect(parseComparatorParams("?fuel=gasoline_98_e5&price=1.7")?.field).toBe(
      "gasolinePrice",
    );
  });

  it("descarta un identificador de estación con formato inesperado", () => {
    expect(
      parseComparatorParams("?fuel=diesel_a&price=1.4&station=<script>")
        ?.stationId,
    ).toBe(null);
  });

  it.each([
    "",
    "?price=1.5",
    "?fuel=diesel_a",
    "?fuel=constructor&price=1.5",
    "?fuel=hydrogen&price=1.5",
    "?fuel=diesel_a&price=abc",
    "?fuel=diesel_a&price=1e2",
    "?fuel=diesel_a&price=-1",
    "?fuel=diesel_a&price=0",
    "?fuel=diesel_a&price=11",
  ])("ignora parámetros inválidos: %s", (search) => {
    expect(parseComparatorParams(search)).toBe(null);
  });
});
