import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  NEUTRAL_BRAND_COLOR,
  getBrandIdentity,
  getRegisteredLogos,
  readableTextColor,
  resolveBrandKey,
} from "./brands";

const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

describe("reconocimiento de marcas", () => {
  it.each([
    ["REPSOL", "repsol"],
    ["E.S. REPSOL BUTANO", "repsol"],
    ["GALP&GO", "galp"],
    ['"BP"', "bp"],
    ["BP OIL ESPAÑA, S.A.U.", "bp"],
    ["GAS RUNNER ( Q8)", "q8"],
    ["E.LECLERC LEON", "leclerc"],
    ["E-LECLERC", "leclerc"],
    ["GMOIL", "gmoil"],
    ["GM OIL ELCHE", "gmoil"],
    ["BONAREA", "bonarea"],
    ["NIEVES PARETS LLEVANTPARK", "nieves"],
    ["FUNDACION AIDA CEPSA", "cepsa"],
  ])("reconoce la variante %s", (label, key) => {
    expect(resolveBrandKey(label)).toBe(key);
  });

  it.each([
    "AVIAN",
    "SHELLY",
    "HAMBURGO",
    "VIRGEN DE LAS NIEVES",
    "AREA DE SERVICIO LAS NIEVES *",
  ])("no reconoce marcas dentro de otras palabras: %s", (label) => {
    expect(resolveBrandKey(label)).toBeNull();
  });

  it("no atribuye a Repsol las marcas comerciales propias de su grupo", () => {
    expect(resolveBrandKey("CAMPSA EXPRESS")).toBe("campsa");
    expect(resolveBrandKey("PETRONOR")).toBe("petronor");
    expect(getBrandIdentity("CAMPSA").logo).toBeNull();
  });

  it("no elige marca cuando el rótulo nombra varias", () => {
    expect(resolveBrandKey("CEPSA-MOEVE")).toBeNull();
    expect(resolveBrandKey("DISA_SHELL")).toBeNull();
    expect(getBrandIdentity("CEPSA-MOEVE")).toMatchObject({
      known: false,
      logo: null,
      name: "CEPSA-MOEVE",
    });
  });
});

describe("identidad visual", () => {
  it("usa el logotipo verificado y el color extraído de él", () => {
    expect(getBrandIdentity("REPSOL")).toMatchObject({
      key: "repsol",
      name: "Repsol",
      logo: "/brands/repsol.svg",
      color: "#ff7816",
    });
  });

  it("muestra monograma neutro si la marca no tiene logotipo verificado", () => {
    expect(getBrandIdentity("SHELL")).toMatchObject({
      key: "shell",
      known: true,
      logo: null,
      mark: "S",
      color: NEUTRAL_BRAND_COLOR,
    });
  });

  it("genera iniciales para rótulos desconocidos sin formas societarias", () => {
    expect(getBrandIdentity("CANARY OIL, S.L.")).toMatchObject({
      key: null,
      name: "CANARY OIL, S.L.",
      mark: "CO",
      logo: null,
      known: false,
    });
  });

  it("no inventa un nombre para estaciones sin rótulo", () => {
    for (const brand of [null, "(SIN RÓTULO)"]) {
      expect(getBrandIdentity(brand)).toMatchObject({
        name: null,
        mark: null,
        logo: null,
        color: NEUTRAL_BRAND_COLOR,
      });
    }
  });

  it("elige el color de texto con más contraste", () => {
    expect(readableTextColor("#fab600")).toBe("#0f1d2e");
    expect(readableTextColor("#233771")).toBe("#ffffff");
  });
});

describe("logotipos locales", () => {
  const files = readdirSync(`${publicDir}/brands`);

  it("cada logotipo registrado existe en public/brands", () => {
    for (const logo of getRegisteredLogos()) {
      expect(files).toContain(logo.replace("/brands/", ""));
    }
  });

  it("documenta la procedencia de cada logotipo", () => {
    const provenance = readFileSync(
      fileURLToPath(new URL("../../docs/brand-logos.md", import.meta.url)),
      "utf8",
    );
    for (const file of files) {
      expect(provenance).toContain(`\`${file}\``);
    }
  });

  it("no hay archivos de logotipo sin registrar", () => {
    expect([...files].sort()).toEqual(
      getRegisteredLogos()
        .map((logo) => logo.replace("/brands/", ""))
        .sort(),
    );
  });
});
