# Publicación de versiones

FuelShift usa [Versionado Semántico](https://semver.org/lang/es/) y registra los cambios en
[`CHANGELOG.md`](../CHANGELOG.md). Una versión es un commit de `main` con su etiqueta `vX.Y.Z` y
un GitHub Release. Publicar una versión no despliega nada por sí solo: el despliegue sigue siendo
el workflow de Cloudflare Pages ([`deployment-cloudflare.md`](deployment-cloudflare.md)).

Ningún paso de publicación se ejecuta sin autorización expresa del propietario.

## Qué cambia cada número

| Cambio                                                                                 | Versión |
| -------------------------------------------------------------------------------------- | ------- |
| Corrección que no cambia el comportamiento esperado (errores, textos, accesibilidad)   | parche  |
| Funcionalidad nueva compatible, o campo nuevo opcional en el contrato de datos         | menor   |
| Cambio incompatible: contrato de datos `2.0.0`, URL públicas que desaparecen o cambian | mayor   |

El número del contrato de datos (`schema_version`, [`contracts/`](../contracts/README.md)) es
independiente del de la aplicación.

## Cómo subir la versión

Las versiones de `package.json` y `pyproject.toml` se suben en una PR propia
(`chore(release): …`) **después** de fusionar todo lo que entra en la versión, para que el commit
etiquetado contenga exactamente lo publicado. Esa PR solo cambia las versiones y el
`CHANGELOG.md` (pasa «Sin publicar» a la versión con su fecha).

## Estado de v1.0.0: publicada

FuelShift 1.0.0 se publicó el 15 de noviembre de 2026. Etiqueta anotada `v1.0.0` sobre
`58a5b02` (PR #32), [GitHub Release](https://github.com/jorgearcenic7/fuelshift/releases/tag/v1.0.0)
y despliegue de ese mismo commit en Cloudflare Pages. Evidencias del 15 de noviembre de 2026:

- [x] Fusionadas las PR de preparación (#25–#28), la de cierre (#31) y la de versión (#32).
- [x] CI en verde en `main` para `58a5b02`: `repo-hygiene`, `frontend` y `python`.
- [x] Despliegue manual con `force_deploy` de `58a5b02`: correcto. La última ejecución programada
      anterior también fue correcta y los datos publicados tienen menos de 48 horas.
- [x] Histórico: `/data/historico/nacional.json` responde, con 28 días seguidos hasta el 15 de
      noviembre.
- [x] `npm run test:browser` contra producción (`58a5b02`): correcto en escritorio y móvil.
- [x] Vigilancia: el simulacro con `simular_fallo` abrió la incidencia #34 y la ejecución normal
      siguiente la cerró sola ([monitoring.md](monitoring.md)).
- [ ] Notificación de la incidencia de alerta recibida por el propietario (correo o campana de
      GitHub): solo puede confirmarla el propietario.
- [x] `CHANGELOG.md` revisado: cada entrada corresponde a una PR fusionada.

## Publicar una versión

1. Fusionar la PR de versión con **Squash and merge**.
2. Publicar el código: **Actions > Actualización MITECO en Cloudflare Pages > Run workflow**,
   rama `main`, `force_deploy` activado y `allow_missing_published_manifest` desactivado.
3. Hacer la verificación posterior (siguiente apartado). Si falla, vuelta atrás.
4. Crear la etiqueta sobre el commit fusionado y el release (en PowerShell):

   ```powershell
   git switch main
   git pull --ff-only
   git tag -a v1.0.0 -m "FuelShift 1.0.0"
   git push origin v1.0.0
   gh release create v1.0.0 --title "FuelShift 1.0.0" --notes-file docs/release-notes-v1.0.0.md
   ```

   El archivo de notas está en [`release-notes-v1.0.0.md`](release-notes-v1.0.0.md).

## Verificación posterior al despliegue

Sobre `https://fuelshift.pages.dev` (o el dominio vigente):

- El mapa carga las estaciones, el mapa de calor se dibuja y la ficha de una estación muestra
  «€/L». Sin errores en la consola del navegador ni violaciones de CSP.
- `/comparador/` y `/estadisticas/` cargan; el histórico se dibuja.
- Una ruta inexistente (por ejemplo `/no-existe/`) responde 404 con la página en español.
- Cabeceras: `curl.exe -sI https://fuelshift.pages.dev/` muestra `content-security-policy`,
  `x-frame-options`, `x-content-type-options`, `referrer-policy` y `permissions-policy`.
- `curl.exe -sI https://fuelshift.pages.dev/data/miteco/manifest.json` incluye
  `x-robots-tag: noindex`.
- `/og-image.png` responde `image/png`; `/sitemap.xml` lista las tres páginas.
- `/robots.txt` es el de FuelShift (con la línea `Sitemap:`). Si Cloudflare sirve su
  `robots.txt` gestionado en su lugar, revisar la opción de robots.txt gestionado en el panel de
  Cloudflare antes de dar el release por terminado.
- Las etiquetas `og:image` y `twitter:image` apuntan a la URL absoluta de `/og-image.png`.

Para v1.0.0 se comprobaron todos estos puntos sobre `58a5b02` el 15 de noviembre de 2026, con
`npm run test:browser` y `curl`. La vista previa en un validador externo de Open Graph no se
probó.

## Vuelta atrás

- **Despliegue defectuoso:** en **Cloudflare > Workers & Pages > Deployments**, elegir el último
  despliegue de producción correcto y **Rollback to this deployment**
  ([documentación](https://developers.cloudflare.com/pages/configuration/rollbacks/)). Después,
  revertir en `main` la PR causante con `git revert` en una rama y PR nuevas.
- **Cabeceras que rompen algo:** quitar o corregir la línea concreta de `public/_headers` en una
  PR y volver a desplegar con `force_deploy`; mientras tanto, el rollback de Cloudflare restaura
  las cabeceras anteriores, porque viajan con el despliegue.
- **Release publicado por error:** `gh release delete v1.0.0` y
  `git push origin :refs/tags/v1.0.0`. Las etiquetas publicadas no se reutilizan: corregir y
  publicar `v1.0.1`.

## Notas del GitHub Release

El texto del release está en [`release-notes-v1.0.0.md`](release-notes-v1.0.0.md).
