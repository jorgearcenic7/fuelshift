import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import { parseManifest, parseProvince } from "./miteco";
import { parseNationalHistory, parseProvinceHistory } from "./price-history";

/**
 * Los ejemplos de contracts/ cumplen sus esquemas y los lectores de la web los
 * aceptan. Las pruebas del pipeline y de scripts/price-history.mjs comprueban,
 * por su parte, que lo que generan cumple los mismos esquemas.
 */
const contracts = new URL("../../contracts/", import.meta.url);
const readText = (file: string) =>
  readFileSync(new URL(file, contracts), "utf8").replace(/\r\n/g, "\n");
const readJson = (file: string): unknown => JSON.parse(readText(file));

const ajv = new Ajv2020({ allErrors: true });
const EXAMPLES = [
  ["miteco/manifest.json", "miteco-manifest"],
  ["miteco/provinces/28.json", "miteco-province"],
  ["historico/diario/2026-10-11.json", "history-record"],
  ["historico/nacional.json", "history-national"],
  ["historico/provincias/28.json", "history-province"],
] as const;

describe("contrato compartido (contracts/)", () => {
  it.each(EXAMPLES)("%s cumple el esquema %s", (example, schema) => {
    const validate = ajv.compile(
      readJson(`schemas/${schema}.schema.json`) as object,
    );

    expect(validate(readJson(`examples/${example}`))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it("el manifiesto de ejemplo describe el archivo provincial real", () => {
    const manifest = parseManifest(readJson("examples/miteco/manifest.json"));
    const bytes = Buffer.from(readText("examples/miteco/provinces/28.json"));

    expect(manifest.provinces[0]).toMatchObject({
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("la web acepta la provincia de ejemplo, también con campos nulos", () => {
    const province = parseProvince(
      readJson("examples/miteco/provinces/28.json"),
    );

    expect(province.stations).toHaveLength(2);
    expect(province.stations[1]).toMatchObject({
      brand: null,
      locality: null,
      opening_hours: null,
    });
  });

  it("la web acepta el histórico nacional y provincial de ejemplo", () => {
    const national = parseNationalHistory(
      readJson("examples/historico/nacional.json"),
    );
    const madrid = parseProvinceHistory(
      readJson("examples/historico/provincias/28.json"),
      "28",
    );

    expect(national.entries.map(({ date }) => date)).toEqual(["2026-10-11"]);
    expect(madrid.entries[0].fuels.diesel_a).toEqual({
      mean: 1.4498,
      count: 805,
    });
  });
});
