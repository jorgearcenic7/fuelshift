import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivacidadPage, { metadata } from "./page";

describe("página de privacidad", () => {
  const html = renderToStaticMarkup(<PrivacidadPage />);

  it("es una página pública con su URL canónica", () => {
    expect(metadata.alternates?.canonical).toBe("/privacidad/");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("muestra la identidad y el contacto del responsable", () => {
    expect(html).toContain("Jorge Arce Nicolás");
    expect(html).toContain("jorgearcenicolas7@gmail.com");
    expect(html).not.toContain("Pendiente: el titular de FuelShift");
  });

  it("nombra a cada destinatario real y los plazos publicados", () => {
    for (const text of [
      "Cloudflare, Inc.",
      "KEPTAGO LTD",
      "OpenFreeMap",
      "redondeado a unos 11 m",
      "Unas 48 h",
      "no más de 24 h",
      "Hasta 2 meses",
      "https://www.aepd.es/",
    ]) {
      expect(html).toContain(text);
    }
  });
});
