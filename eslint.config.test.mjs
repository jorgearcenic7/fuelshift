import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * Comprueba que las fronteras entre capas de eslint.config.mjs se aplican de
 * verdad: una regla mal ubicada en la configuración dejaría de fallar en
 * silencio.
 */
const eslint = new ESLint();

async function restrictedImports(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter(({ ruleId }) => ruleId === "no-restricted-imports")
    .map(({ message }) => message);
}

describe("fronteras entre capas", () => {
  it.each([
    ["src/domain/x.ts", 'import { parseProvince } from "@/data/miteco";'],
    ["src/domain/x.ts", 'import { useState } from "react";'],
    ["src/domain/x.ts", 'import { readFile } from "node:fs/promises";'],
    ["src/domain/x.ts", 'import { parseProvince } from "../data/miteco";'],
    [
      "src/data/x.ts",
      'import { StationMap } from "@/components/map/station-map";',
    ],
    ["src/components/map/x.tsx", 'import Home from "@/app/page";'],
    ["src/lib/x.ts", 'import { PRIMARY_FUELS } from "@/domain/stations";'],
  ])(
    "%s rechaza «%s»",
    async (filePath, code) => {
      expect(await restrictedImports(filePath, code)).toHaveLength(1);
    },
    30_000,
  );

  it.each([
    ["src/data/x.ts", 'import { PRIMARY_FUELS } from "@/domain/stations";'],
    [
      "src/components/map/x.tsx",
      'import { parseProvince } from "@/data/miteco";',
    ],
    ["src/domain/x.ts", 'import { formatPrice } from "@/lib/format";'],
    ["src/domain/x.test.ts", 'import { parseProvince } from "@/data/miteco";'],
  ])(
    "%s permite «%s»",
    async (filePath, code) => {
      expect(await restrictedImports(filePath, code)).toEqual([]);
    },
    30_000,
  );
});
