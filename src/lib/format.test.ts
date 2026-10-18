import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatLongDate,
  formatPrice,
  formatRetrievedAt,
  formatShortDate,
  formatSignedPercent,
  formatSignedPrice,
} from "./format";

describe("formatos en español", () => {
  it("muestra los precios con los tres decimales de MITECO", () => {
    expect(formatPrice(1.5)).toBe("1,500");
    expect(formatPrice(1.4589)).toBe("1,459");
  });

  it("indica el signo de las diferencias salvo cuando son cero", () => {
    expect(formatSignedPrice(0.0123)).toBe("+0,012");
    expect(formatSignedPrice(-0.05)).toBe("-0,050");
    expect(formatSignedPrice(0)).toBe("0,000");
    expect(formatSignedPercent(2.5)).toBe("+2,5 %");
    expect(formatSignedPercent(-1.24)).toBe("-1,2 %");
  });

  it("agrupa los recuentos con separador de miles", () => {
    expect(formatCount(12345)).toBe("12.345");
  });

  // Comprueban el comportamiento (zona horaria y día), no el texto literal de
  // ICU, cuya puntuación puede variar entre versiones de Node.
  it("muestra la descarga en hora peninsular", () => {
    const text = formatRetrievedAt("2026-10-12T14:08:32Z");

    // 14:08 UTC son las 16:08 en Madrid en horario de verano.
    expect(text).toMatch(/\b16:08\b/);
    expect(text).toMatch(/\b12\b/);
    expect(text).toMatch(/oct/i);
    expect(text).toMatch(/2026/);
  });

  it("no desplaza de día las fechas del histórico", () => {
    const short = formatShortDate("2026-10-05");
    const long = formatLongDate("2026-10-05");

    expect(short).toMatch(/^5\D/);
    expect(short).toMatch(/oct/i);
    expect(long).toMatch(/^5\D/);
    expect(long).toMatch(/octubre/i);
    expect(long).toMatch(/2026/);
  });
});
