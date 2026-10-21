import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const LAYERS = {
  app: "app: rutas y páginas de Next.js",
  components: "components: interfaz React",
  data: "data: carga y validación de los JSON publicados",
  domain: "domain: reglas puras",
};

/** Prohíbe importar las capas indicadas, por alias o saliendo de la carpeta. */
function forbidLayers(layers, extra = []) {
  return [
    ...layers.map((layer) => ({
      group: [`@/${layer}`, `@/${layer}/**`],
      message: `Dependencia no permitida hacia ${LAYERS[layer]}.`,
    })),
    {
      group: ["../*"],
      message:
        "Importa otras capas con el alias @/ para que se apliquen las fronteras.",
    },
    ...extra,
  ];
}

const FRAMEWORKS = {
  group: [
    "react",
    "react-dom",
    "react/*",
    "next",
    "next/*",
    "maplibre-gl",
    "node:*",
  ],
  message:
    "El dominio no depende de React, Next.js, MapLibre ni Node: debe poder usarse en cualquier capa.",
};

/**
 * Fronteras entre capas de src/. Las dependencias solo avanzan hacia la
 * derecha en app → components → data → domain, pudiendo saltar capas, y
 * cualquier capa puede usar lib. Las pruebas quedan fuera porque pueden
 * combinar capas para preparar datos.
 */
const layerBoundaries = [
  ["src/domain/**", forbidLayers(["app", "components", "data"], [FRAMEWORKS])],
  ["src/data/**", forbidLayers(["app", "components"])],
  ["src/components/**", forbidLayers(["app"])],
].map(([files, patterns]) => ({
  files: [files],
  ignores: ["**/*.test.ts", "**/*.test.tsx"],
  rules: { "no-restricted-imports": ["error", { patterns }] },
}));

const libBoundary = {
  files: ["src/lib/**"],
  ignores: ["**/*.test.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [
              "@/app/**",
              "@/components/**",
              "@/data/**",
              "@/domain/**",
              "../*",
            ],
            message:
              "lib contiene utilidades genéricas y no depende de ninguna capa.",
          },
        ],
      },
    ],
  },
};

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  ...layerBoundaries,
  libBoundary,
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    ".edge-profile*/**",
    ".screenshots/**",
    "next-env.d.ts",
    "pipeline/**",
  ]),
]);
