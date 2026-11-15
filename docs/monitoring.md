# Vigilancia de producción y alertas

FuelShift se vigila con un workflow de GitHub Actions,
[`vigilancia-produccion.yml`](../.github/workflows/vigilancia-produccion.yml), que cada hora
comprueba la web **tal como la ve un visitante** en <https://fuelshift.pages.dev>. No mira solo si
los workflows terminaron bien: descarga las páginas y los datos publicados y los valida. No usa
servicios externos, cuentas nuevas ni secretos: solo el `GITHUB_TOKEN` de la propia ejecución.

## Qué comprueba

La lógica está en [`scripts/monitor-production.mjs`](../scripts/monitor-production.mjs) y sus
pruebas en `scripts/monitor-production.test.mjs`.

| Comprobación                                  | Falla si…                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Páginas `/`, `/comparador/`, `/estadisticas/` | no responden 200 o la respuesta no es la web de FuelShift                                      |
| Recursos estáticos                            | algún JS o CSS de `/_next/static/` enlazado desde la portada no responde (despliegue a medias) |
| Manifiesto MITECO                             | no es JSON válido o no cumple el contrato (mismo validador que usa el despliegue)              |
| Antigüedad de los datos                       | `retrieved_at` tiene más de **14 h** o está en el futuro                                       |
| Archivos provinciales                         | el hash SHA-256 o el tamaño de alguna provincia no coincide con el manifiesto                  |
| Estadísticas                                  | `/data/estadisticas.json` es de otra descarga distinta a la del manifiesto                     |
| Histórico diario                              | el último día de `/data/historico/nacional.json` es anterior a ayer (hora de Madrid)           |
| Ejecuciones de la ingesta                     | las **2** últimas ejecuciones terminadas de la ingesta han fallado                             |

### Por qué 14 horas y 2 fallos

El cron de la ingesta pide una ejecución cada 4 h, pero GitHub las retrasa o descarta con carga
alta. Con las 134 ejecuciones reales del 12 de octubre al 15 de noviembre de 2026, la separación
entre ejecuciones correctas fue de 6,3 h de mediana, 9,3 h en el percentil 90 y **11,6 h como
máximo**. Un umbral de 12 h habría dado falsas alarmas; 14 h deja margen y equivale a perder al
menos dos ejecuciones seguidas. Un único fallo de la ingesta no se avisa: la siguiente ejecución
lo suele resolver y la web sigue sirviendo el último conjunto válido.

Los umbrales están en `DEFAULTS` dentro del script.

## Cómo llega la alerta

- Si algo falla, el workflow abre **una** incidencia con la etiqueta `alerta-produccion` y una
  tabla con cada comprobación. GitHub notifica la incidencia nueva al propietario del
  repositorio (correo y campana), que lo vigila por defecto.
- Mientras el fallo siga, cada hora se **reescribe** el texto de esa misma incidencia. Editar no
  vuelve a notificar, así que no llegan avisos repetidos.
- Cuando todo vuelve a estar bien, la incidencia se cierra sola con un comentario de
  recuperación (que sí notifica).
- Si el propio script se rompe, se trata igual que un fallo: incidencia con el enlace a la
  ejecución.

Permisos del job: `contents: read`, `actions: read` (leer las ejecuciones de la ingesta) e
`issues: write`. No tiene acceso a los secretos de Cloudflare.

### Probar que la alerta llega

1. **Actions > Vigilancia de producción > Run workflow**, rama `main`, con `simular_fallo`
   activado. Añade una comprobación «Simulacro» que falla siempre.
2. Debe abrirse una incidencia `alerta-produccion` y llegar la notificación.
3. Lanzar el workflow otra vez **sin** `simular_fallo`: la incidencia se cierra sola.

## Diagnóstico y recuperación

Lo primero es mirar qué fila de la tabla falla:

| Fallo                              | Qué hacer                                                                                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Páginas o recursos estáticos       | Revisar el último despliegue en **Cloudflare > Workers & Pages > fuelshift > Deployments**. Si está roto, **Rollback to this deployment** al último correcto. Mirar también el estado de Cloudflare.                        |
| Antigüedad de los datos            | Ver **Actions > Actualización MITECO**: ¿se está ejecutando? Si GitHub desactivó el cron (60 días sin actividad en el repositorio), volver a habilitarlo. Si solo hay retraso, lanzarlo a mano.                             |
| Ejecuciones de la ingesta          | Abrir la ejecución fallida y ver el paso: MITECO caído o con datos incompletos (se reintenta solo), tests, build o Wrangler (credenciales). Ver [deployment-cloudflare.md](deployment-cloudflare.md#fallos-y-recuperación). |
| Manifiesto o archivos provinciales | Publicación incoherente: rollback en Cloudflare al último despliegue correcto y relanzar la ingesta.                                                                                                                        |
| Estadísticas                       | Igual que el anterior: el build se publicó a medias o mezclado.                                                                                                                                                             |
| Histórico diario                   | Ver el job `registrar-historico` y la rama `data/historico`. Ver [price-history.md](price-history.md#errores-y-recuperación).                                                                                               |

### Conservación de los datos válidos

Ningún fallo de la ingesta borra lo publicado: si MITECO responde mal, la validación falla o el
build no termina, el workflow se detiene **antes** de Wrangler y la web sigue con el último
conjunto correcto. Por eso, ante una alerta de antigüedad, los datos que se ven son reales pero
viejos, y la web ya avisa al visitante cuando superan 48 h.

### Rollback

- **Web:** rollback en Cloudflare Pages (lo anterior). Es inmediato y no necesita GitHub.
- **Código:** revertir la PR causante con `git revert` en una rama nueva y PR. El código nuevo no
  se publica hasta la siguiente ingesta que despliegue o un `force_deploy` manual.
- **Histórico:** la rama `data/historico` conserva todo su historial Git; ver
  [price-history.md](price-history.md).

## Coste y límites

Los runners estándar de GitHub Actions son gratuitos en repositorios públicos (comprobado el 15 de
noviembre de 2026). La vigilancia hace unas 720 ejecuciones al mes de menos de un minuto y
descarga unos 5 MB por ejecución desde Cloudflare Pages, cuyas peticiones a activos estáticos son
gratuitas e ilimitadas. Si el repositorio pasara a privado, habría que revisar el cron.

Limitación conocida: GitHub desactiva los workflows programados de un repositorio público tras 60
días sin actividad, y eso afectaría a la vez a la ingesta y a la vigilancia. GitHub avisa por
correo antes de hacerlo; basta con volver a habilitarlos desde **Actions**.
