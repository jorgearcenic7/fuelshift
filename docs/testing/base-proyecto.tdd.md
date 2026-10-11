# Evidencia TDD: base del proyecto

## Origen y recorridos

Los criterios proceden del encargo de la fase `feat/base-proyecto`, sin un plan externo:

1. Una persona visitante puede abrir una portada accesible que no presenta datos simulados.
2. Una persona desarrolladora puede validar y exportar el frontend como sitio estático.
3. El futuro pipeline puede representar campos publicados por MITECO y rechaza precios o
   registros normalizados inválidos.

No se hicieron los commits de checkpoint sugeridos por ECC porque el propietario prohibió
expresamente hacer commits sin autorización final.

## Ciclos RED/GREEN

| Comportamiento                            | RED observado                                             | GREEN observado                                                                 | Garantía                                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Composición de clases para componentes UI | `npm test`: fallo al resolver `@/lib/utils`               | `npm run test:coverage`: 1 test aprobado y 100 % de cobertura sobre la utilidad | Las clases condicionales se combinan y los conflictos de Tailwind conservan la última utilidad.                                    |
| Modelos normalizados de estación y precio | `python -m pytest`: `ModuleNotFoundError: fuelshift_data` | `python -m pytest`: 6 tests aprobados                                           | Se aceptan los campos normalizados documentados; se rechazan importes no positivos, fechas sin zona horaria y campos desconocidos. |

## Verificación final

- `npm run format:check`: aprobado.
- `npm run lint`: aprobado sin avisos.
- `npm run typecheck`: aprobado.
- `npm run test:coverage`: 1 test aprobado; 100 % en la utilidad incluida.
- `npm run build`: aprobado; rutas `/` y `/_not-found` prerenderizadas como contenido estático.
- `python -m ruff format --check pipeline`: 7 archivos formateados.
- `python -m ruff check pipeline`: aprobado.
- `python -m pytest`: 6 tests aprobados.
- Arranque local: respuesta HTTP 200, título `FuelShift` y aviso de ausencia de datos reales.

## Cobertura y límites conocidos

No se ha probado una ingesta ni una escritura de datos porque el contrato bruto de MITECO sigue
pendiente de verificación. Los puertos de descarga, normalización y generación no contienen una
implementación ficticia.

`npm audit --omit=dev` no detectó vulnerabilidades en producción. La auditoría completa detectó
`GHSA-vfj7-8cjw-p6xm` en `braces@3.0.3`, dependencia transitiva de las reglas ESLint de Next.js y
usada solo en desarrollo/CI. El advisory no ofrece versión corregida y la corrección forzada
degradaría `eslint-config-next`; debe actualizarse cuando exista una solución compatible.
