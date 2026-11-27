import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AddressField } from "./address-field";
import {
  GEOAPIFY_ATTRIBUTION_TEXT,
  GeoapifyAttribution,
} from "./geoapify-attribution";

const visibleText = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

describe("atribución de Geoapify", () => {
  it("muestra el texto exacto pedido por Geoapify, con sus enlaces", () => {
    const html = renderToStaticMarkup(<GeoapifyAttribution />);
    expect(GEOAPIFY_ATTRIBUTION_TEXT).toBe(
      "Powered by Geoapify | © OpenStreetMap contributors",
    );
    expect(visibleText(html)).toBe(GEOAPIFY_ATTRIBUTION_TEXT);
    expect(html).toContain('href="https://www.geoapify.com/"');
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
  });
});

// Geoapify exige su atribución y la de OpenStreetMap mientras se muestren sus datos.
describe("atribución de las direcciones", () => {
  it("se mantiene visible con una dirección elegida de Geoapify", () => {
    const html = renderToStaticMarkup(
      <AddressField
        label="Destino"
        value={{
          label: "Calle Mayor, Madrid",
          location: { latitude: 40.4153, longitude: -3.7074 },
        }}
        onChange={() => {}}
        search={async () => []}
      />,
    );
    expect(html).toContain("Calle Mayor, Madrid");
    expect(visibleText(html)).toContain(GEOAPIFY_ATTRIBUTION_TEXT);
  });

  it("no aparece mientras no se muestra ningún dato de Geoapify", () => {
    const html = renderToStaticMarkup(
      <AddressField
        label="Destino"
        value={null}
        onChange={() => {}}
        search={async () => []}
      />,
    );
    expect(html).not.toContain("geoapify.com");
  });
});
