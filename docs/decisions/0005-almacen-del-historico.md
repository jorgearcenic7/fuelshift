# 0005. Histórico diario en la rama huérfana `data/historico`

Estado: Aceptada. La funcionalidad se activa con la variable de repositorio `HISTORY_ENABLED`.

## Contexto

MITECO solo publica los precios vigentes. Para mostrar la evolución, FuelShift debe guardar una
observación diaria de forma permanente. `AGENTS.md` prohíbe escribir en `main` y desprotegerla
para automatizar ingestas, y exige que los datos persistentes usen un mecanismo separado,
aprobado y probado.

## Decisión

- Una rama huérfana `data/historico` del mismo repositorio, sin código, con un archivo por día
  (`diario/AAAA-MM-DD.json`).
- Solo escribe en ella un job aparte (`registrar-historico`) con `contents: write` como único
  permiso, usando el `GITHUB_TOKEN` del workflow: no hacen falta secretos nuevos.
- Cada despliegue publica también una copia validada de cada registro, que sirve de respaldo para
  reconstruir la rama si fuera necesario.

Comparativa completa y datos verificados: [`docs/price-history.md`](../price-history.md).

## Alternativas descartadas

| Opción                       | Motivo                                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| Artefactos de GitHub Actions | Caducan (máximo 90 días); solo se usan como traspaso entre jobs      |
| Caché de GitHub Actions      | Se borra tras 7 días sin uso                                         |
| Commits en `main`            | Prohibidos por `AGENTS.md` y por el ruleset                          |
| Solo en Cloudflare Pages     | Una reversión o un despliegue defectuoso lo perderían                |
| Repositorio de datos aparte  | `GITHUB_TOKEN` no escribe en otro repositorio; exigiría un PAT o App |
| Releases, R2 o KV            | Más superficie, cuentas o secretos sin ventaja clara                 |

## Consecuencias

- Un archivo por día hace que cada ejecución toque como mucho un archivo y que el repositorio
  crezca de forma lineal.
- El historial de la rama permite revisar o revertir cualquier día con Git.
- La rama necesita su propio ruleset contra borrado y force-push.

## Revisar si

- El volumen diario crece tanto que el historial de Git deja de ser manejable, o se necesita un
  almacén con consultas.
