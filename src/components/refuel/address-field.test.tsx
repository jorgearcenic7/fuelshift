import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AddressField } from "./address-field";

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
    expect(html).toContain('href="https://www.geoapify.com/"');
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
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
