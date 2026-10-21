# 0006. Estadísticas calculadas solo en TypeScript; histórico en `scripts/`

Estado: Aceptada.

## Contexto

Las medias nacionales y provinciales aparecen en dos sitios: en la página «Estadísticas» del día
y en el histórico diario. Si se calcularan con dos implementaciones (por ejemplo, una en Python
en el pipeline y otra en TypeScript en la web), podrían dar valores distintos para el mismo día.

El registro del histórico, además, lo guarda un job con permiso de escritura en el repositorio,
así que conviene que ese job descargue el mínimo código posible.

## Decisión

- Las estadísticas se calculan solo en `src/domain/fuel-statistics.ts`. El build publica la
  instantánea `/data/estadisticas.json` y `scripts/price-history.mjs` la convierte en el registro
  diario, sin volver a calcular medias.
- La lógica del histórico vive en `scripts/` como módulos de Node sin dependencias ni paso de
  compilación. El job `registrar-historico` obtiene solo esa carpeta (`sparse-checkout: scripts`)
  y no ejecuta `npm ci`.

## Alternativas descartadas

- **Generar el histórico en el pipeline Python**: obligaría a duplicar el cálculo estadístico o a
  trasladarlo entero a Python.
- **Mover la lógica del histórico a `src/`**: el job con permiso de escritura tendría que
  descargar y ejecutar código de la aplicación (y sus dependencias) en lugar de una sola carpeta
  autocontenida.

## Consecuencias

- `scripts/price-history.mjs` y `scripts/history-git.mjs` contienen reglas de negocio (validación,
  política diaria, umbrales) y no son simples utilidades. Se prueban con Vitest, pero
  `npm run test:coverage` solo mide `src/lib`, `src/domain` y `src/data`.
- `scripts/` no puede importar de `src/` sin romper el job de registro, que solo descarga
  `scripts/`.
- El formato del histórico lo escribe `scripts/` y lo lee `src/data/price-history.ts`; ambos lados
  deben mantenerse alineados ([0003](0003-contrato-json-publicado.md)).

## Revisar si

- El job de registro deja de necesitar permiso de escritura o se adopta un paso de compilación
  común para `scripts/`.
