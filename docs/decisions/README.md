# Decisiones de arquitectura (ADR)

Cada ADR recoge una decisión que condiciona el diseño: el contexto, lo que se decidió, las
alternativas descartadas y sus consecuencias. Explican **por qué** el sistema es como es; el
**cómo** sigue en el resto de `docs/` y en el código.

| ADR                                           | Decisión                                                            | Estado   |
| --------------------------------------------- | ------------------------------------------------------------------- | -------- |
| [0001](0001-exportacion-estatica.md)          | Exportación estática de Next.js en Cloudflare Pages Free            | Aceptada |
| [0002](0002-sin-base-de-datos.md)             | Sin base de datos ni backend: JSON estáticos validados              | Aceptada |
| [0003](0003-contrato-json-publicado.md)       | Contrato JSON versionado entre el pipeline y la web                 | Aceptada |
| [0004](0004-proveedor-de-mapa.md)             | MapLibre GL JS con la instancia pública de OpenFreeMap              | Aceptada |
| [0005](0005-almacen-del-historico.md)         | Histórico diario en la rama huérfana `data/historico`               | Aceptada |
| [0006](0006-estadisticas-en-un-solo-lugar.md) | Estadísticas calculadas solo en TypeScript; histórico en `scripts/` | Aceptada |

Las ADR 0001 a 0006 se registraron el 21 de octubre de 2026 a partir de decisiones ya aplicadas
y documentadas en el repositorio.

## Cómo añadir una ADR

1. Copiar la estructura de una existente con el siguiente número libre: `NNNN-titulo-corto.md`.
2. Rellenar **Contexto**, **Decisión**, **Alternativas descartadas**, **Consecuencias** y
   **Revisar si**. Citar solo hechos comprobados y enlazar la documentación que los sostiene.
3. Añadirla a la tabla en la misma pull request que aplica la decisión.

Una ADR aceptada no se reescribe. Si la decisión cambia, se crea otra que la sustituye y la
antigua pasa a «Sustituida por NNNN».
