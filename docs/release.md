# Publicación de versiones

FuelShift usa [Versionado Semántico](https://semver.org/lang/es/) y registra los cambios en
[`CHANGELOG.md`](../CHANGELOG.md). Una versión es un commit de `main` con su etiqueta `vX.Y.Z` y
un GitHub Release. Publicar una versión no despliega nada por sí solo: el despliegue sigue siendo
el workflow de Cloudflare Pages ([`deployment-cloudflare.md`](deployment-cloudflare.md)).

Ningún paso de este documento se ejecuta sin autorización expresa del propietario.

## Qué cambia cada número

| Cambio                                                                                 | Versión |
| -------------------------------------------------------------------------------------- | ------- |
| Corrección que no cambia el comportamiento esperado (errores, textos, accesibilidad)   | parche  |
| Funcionalidad nueva compatible, o campo nuevo opcional en el contrato de datos         | menor   |
| Cambio incompatible: contrato de datos `2.0.0`, URL públicas que desaparecen o cambian | mayor   |

El número del contrato de datos (`schema_version`, [`contracts/`](../contracts/README.md)) es
independiente del de la aplicación.

## Cuándo pasar de 0.1.0 a 1.0.0

`package.json` y `pyproject.toml` están en `0.1.0` desde la base del proyecto y no se han
actualizado. Conviene subirlos a `1.0.0` en una PR propia (`chore(release): publicar la versión
1.0.0`) **después** de fusionar todas las PR de preparación, para que el commit etiquetado
contenga exactamente lo publicado. Esa PR solo cambia las dos versiones y el `CHANGELOG.md`
(sustituye «Sin publicar» por la versión y la fecha y quita las marcas «Pendiente de fusión»).

## Checklist de v1.0.0

Antes de la PR de versión:

- [x] Fusionadas las PR de preparación (unidades y accesibilidad, SEO, cabeceras, documentación).
- [ ] Fusionada la PR de cierre (vigilancia, limpieza y documentación operativa).
- [ ] Vigilancia de producción probada: simulacro con `simular_fallo` abre la incidencia, llega
      la notificación y la siguiente ejecución normal la cierra ([monitoring.md](monitoring.md)).
- [ ] CI en verde en `main`: `repo-hygiene`, `frontend` y `python`.
- [ ] `npm run test:browser` ejecutado en local contra un build con datos reales: correcto.
- [ ] Último despliegue programado correcto y datos de menos de 48 horas.
- [ ] Histórico: `/data/historico/nacional.json` responde y tiene la observación de ayer.
- [ ] Revisado `CHANGELOG.md`: cada entrada corresponde a una PR fusionada.

Publicación:

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

- [ ] El mapa carga las estaciones, el mapa de calor se dibuja y la ficha de una estación muestra
      «€/L». Sin errores en la consola del navegador ni violaciones de CSP.
- [ ] `/comparador/` y `/estadisticas/` cargan; el histórico se dibuja.
- [ ] Una ruta inexistente (por ejemplo `/no-existe/`) responde 404 con la página en español.
- [ ] Cabeceras: `curl.exe -sI https://fuelshift.pages.dev/` muestra `content-security-policy`,
      `x-frame-options`, `x-content-type-options`, `referrer-policy` y `permissions-policy`.
- [ ] `curl.exe -sI https://fuelshift.pages.dev/data/miteco/manifest.json` incluye
      `x-robots-tag: noindex`.
- [ ] `/og-image.png` responde `image/png`; `/sitemap.xml` lista las tres páginas.
- [ ] `/robots.txt` es el de FuelShift (con la línea `Sitemap:`). Si Cloudflare sirve su
      `robots.txt` gestionado en su lugar, revisar la opción de robots.txt gestionado en el
      panel de Cloudflare antes de dar el release por terminado.
- [ ] Compartir el enlace en una vista previa (por ejemplo, un validador de Open Graph) muestra
      la imagen y el título.

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
