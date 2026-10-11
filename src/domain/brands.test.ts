import { describe, expect, it } from "vitest";

import {
  NEUTRAL_BRAND_COLOR,
  getBrandIdentity,
  readableTextColor,
} from "./brands";

describe("identidad de marca", () => {
  it("reconoce la marca como palabra completa dentro del rótulo", () => {
    expect(getBrandIdentity("REPSOL").key).toBe("repsol");
    expect(getBrandIdentity("E.S. REPSOL BUTANO").key).toBe("repsol");
    expect(getBrandIdentity("BP OIL").name).toBe("BP");
    // "AVIAN" no es Avia.
    expect(getBrandIdentity("AVIAN").key).toBeNull();
  });

  it("usa el tono neutro para marcas sin color verificado", () => {
    const identity = getBrandIdentity("BALLENOIL");

    expect(identity).toMatchObject({ key: "ballenoil", known: true });
    expect(identity.color).toBe(NEUTRAL_BRAND_COLOR);
  });

  it("genera iniciales para rótulos desconocidos sin formas societarias", () => {
    const identity = getBrandIdentity("CANARY OIL, S.L.");

    expect(identity).toMatchObject({
      key: null,
      name: "CANARY OIL, S.L.",
      mark: "CO",
      known: false,
    });
  });

  it("no inventa un nombre para estaciones sin rótulo", () => {
    for (const brand of [null, "(SIN RÓTULO)"]) {
      expect(getBrandIdentity(brand)).toMatchObject({
        name: null,
        mark: null,
        color: NEUTRAL_BRAND_COLOR,
      });
    }
  });

  it("elige el color de texto con más contraste", () => {
    expect(readableTextColor("#fbce07")).toBe("#0f1d2e");
    expect(readableTextColor("#004e9f")).toBe("#ffffff");
    expect(getBrandIdentity("SHELL").onColor).toBe("#0f1d2e");
  });
});
