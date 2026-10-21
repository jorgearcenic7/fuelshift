# Contrato de datos publicado

Fuente única del formato de los JSON que cruzan una frontera: los que genera el pipeline Python
y lee la web, y los del histórico, que se guardan en la rama `data/historico` y lee
«Estadísticas». Los esquemas usan JSON Schema 2020-12.

| Esquema                                | Archivo publicado                     | Productor                     | Consumidor                  |
| -------------------------------------- | ------------------------------------- | ----------------------------- | --------------------------- |
| `schemas/miteco-manifest.schema.json`  | `data/miteco/manifest.json`           | `pipeline/` (`generation.py`) | `src/data/miteco.ts`        |
| `schemas/miteco-province.schema.json`  | `data/miteco/provinces/NN.json`       | `pipeline/` (`generation.py`) | `src/data/miteco.ts`        |
| `schemas/history-record.schema.json`   | `diario/AAAA-MM-DD.json` (rama datos) | `scripts/price-history.mjs`   | `scripts/price-history.mjs` |
| `schemas/history-national.schema.json` | `data/historico/nacional.json`        | `scripts/price-history.mjs`   | `src/data/price-history.ts` |
| `schemas/history-province.schema.json` | `data/historico/provincias/NN.json`   | `scripts/price-history.mjs`   | `src/data/price-history.ts` |

`examples/` contiene un documento válido por esquema. Sus datos son ficticios y lo declaran en
`source.attribution`; no proceden de MITECO.

## Cómo se comprueba

Cada lado prueba su parte contra los mismos archivos:

- `pipeline/tests/test_contract.py`: los esquemas son válidos, los ejemplos los cumplen y el
  conjunto que publica el pipeline desde el fixture también.
- `scripts/price-history.test.mjs`: el registro diario y los JSON que publica el histórico
  cumplen sus esquemas, y `validateRecord` acepta el ejemplo.
- `src/data/contract.test.ts`: los lectores de la web aceptan los ejemplos, incluidos los campos
  anulables, y el manifiesto de ejemplo coincide en bytes y SHA-256 con su provincia.

Así, si un productor añade, renombra o anula un campo sin actualizar el esquema, falla su prueba;
si se actualiza el esquema y el ejemplo pero no el lector, falla la prueba de la web.

Los esquemas describen la forma de cada archivo. Las reglas entre archivos (recuentos, hashes,
identificadores únicos, fechas crecientes) siguen comprobándose en el código de cada lado.

## Versionado

Todos los archivos declaran `schema_version: "1.0.0"`. Los lectores actuales exigen
exactamente esa versión.

- Campo opcional nuevo o valor nuevo en un enumerado que los lectores ignoran: versión menor
  (`1.1.0`).
- Renombrar, eliminar o cambiar el tipo de un campo, o hacer obligatorio uno opcional: versión
  mayor (`2.0.0`), con lectores actualizados antes de publicar.
- Aclaraciones en descripciones sin cambiar la forma: no cambian la versión.

Un cambio de versión modifica a la vez el esquema, su ejemplo, el productor y el consumidor, en
la misma pull request.
