import type { FilterSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import { BASE_COLORS, customizeBaseStyle, SPANISH_NAME } from "./map-style";

const style: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "rgb(242,243,240)" },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      paint: { "fill-color": "rgb(194, 200, 202)", "fill-antialias": true },
    },
    {
      id: "label_country_1",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: { "text-field": ["get", "name:latin"], "text-size": 12 },
      paint: { "text-color": "#000" },
    },
    {
      id: "label_village",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      layout: { "text-field": ["get", "name:latin"] },
      paint: { "text-color": "#000" },
    },
    {
      id: "highway-shield-non-us",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      layout: { "text-field": ["to-string", ["get", "ref"]] },
    },
    {
      id: "building",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "building",
      paint: { "fill-color": "rgb(234, 234, 229)" },
    },
  ],
};

describe("customizeBaseStyle", () => {
  const result = customizeBaseStyle(undefined, style);
  const layer = (id: string) => result.layers.find((item) => item.id === id)!;

  it("aclara la tierra y vuelve gris azulado el mar", () => {
    expect(layer("background").paint).toEqual({
      "background-color": BASE_COLORS.land,
    });
    expect(layer("water").paint).toEqual({
      "fill-color": BASE_COLORS.water,
      "fill-antialias": true,
    });
  });

  it("muestra los nombres de lugar en español si existen", () => {
    const country = layer("label_country_1");
    expect(country.type === "symbol" && country.layout?.["text-field"]).toEqual(
      SPANISH_NAME,
    );
    expect(country.type === "symbol" && country.layout?.["text-size"]).toBe(12);
  });

  it("atenúa las etiquetas secundarias y marca algo más países y ciudades", () => {
    const village = layer("label_village");
    const country = layer("label_country_1");
    expect(village.type === "symbol" && village.paint?.["text-color"]).toBe(
      BASE_COLORS.labelSoft,
    );
    expect(country.type === "symbol" && country.paint?.["text-color"]).toBe(
      BASE_COLORS.labelStrong,
    );
  });

  it("no toca escudos de carretera ni edificios", () => {
    expect(layer("highway-shield-non-us")).toBe(style.layers[4]);
    expect(layer("building")).toBe(style.layers[5]);
  });

  it("no modifica el estilo original", () => {
    expect(style.layers[0].paint).toEqual({
      "background-color": "rgb(242,243,240)",
    });
  });

  it.each([
    "highway-shield-non-us",
    "highway-shield-us-interstate",
    "road_shield_us",
  ])(
    "conserva los filtros de %s y excluye referencias ausentes sin avisos",
    (id) => {
      const filter: FilterSpecification = [
        "all",
        ["<=", ["get", "ref_length"], 6],
        ["==", ["geometry-type"], "LineString"],
      ];
      const original: StyleSpecification = {
        version: 8,
        sources: {},
        layers: [{ id, type: "symbol", source: "roads", filter }],
      };
      const updated = customizeBaseStyle(undefined, original).layers[0];
      if (updated.type !== "symbol" || original.layers[0].type !== "symbol") {
        throw new Error("La capa de referencias debe seguir siendo symbol");
      }
      expect(updated.filter).toEqual([
        "all",
        ["<=", ["number", ["get", "ref_length"], 7], 6],
        filter[2],
      ]);
      expect(original.layers[0].filter).toBe(filter);
      expect(original.layers[0].filter).toEqual(filter);
    },
  );
});
