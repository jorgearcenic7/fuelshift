import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    coverage: {
      // Lógica sin React: dominio, contrato de datos y utilidades. Los scripts de
      // despliegue se prueban ejecutándolos como procesos, que v8 no mide aquí.
      include: ["src/lib/**/*.ts", "src/domain/**/*.ts", "src/data/**/*.ts"],
      exclude: ["**/*.test.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 85,
        functions: 95,
        lines: 90,
        statements: 90,
      },
    },
  },
});
