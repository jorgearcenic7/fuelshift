# Despliegue estático en Cloudflare Pages

## Alcance

FuelShift se publica como una exportación estática de Next.js mediante **Direct Upload**. GitHub
Actions descarga y valida MITECO, prepara los JSON, construye `out/` y solo entonces llama a
Wrangler. No se despliegan Pages Functions, Workers, servidores, bases de datos ni servicios de
pago.

El workflow [`.github/workflows/deploy-cloudflare.yml`](../.github/workflows/deploy-cloudflare.yml)
se ejecuta cada cuatro horas y también admite `workflow_dispatch`. Solo opera sobre `main` y
serializa los despliegues de producción. Un fallo anterior al último paso no llama a Cloudflare
y, por tanto, la publicación vigente permanece intacta. Cloudflare conserva además despliegues
de producción anteriores para recuperación.

## Configuración inicial

1. Crear una cuenta en el plan **Cloudflare Free**. No activar Workers Paid, R2 ni complementos
   facturables.
2. Crear un proyecto de Pages de tipo **Direct Upload**, con la rama de producción `main`. Puede
   hacerse localmente con autenticación OAuth, sin copiar el token a la línea de comandos:

   ```powershell
   npx wrangler login
   npx wrangler pages project create <proyecto> --production-branch=main
   ```

   No conectar la integración Git de Cloudflare: el único camino de publicación previsto es el
   workflow manual de GitHub Actions. Si ya existe un proyecto conectado a Git, desactivar los
   despliegues automáticos de producción y preview antes de usar Wrangler.

3. En Cloudflare, crear un API Token personalizado limitado a la cuenta elegida y con un único
   permiso: `Account > Cloudflare Pages > Edit`. No usar la Global API Key.
4. En GitHub, crear el entorno `production` y restringir sus ramas de despliegue a `main`. Añadir
   dentro del entorno estos secretos:
   - `CLOUDFLARE_API_TOKEN`: token limitado de Pages.
   - `CLOUDFLARE_ACCOUNT_ID`: identificador de la cuenta.

   Los secretos solo se inyectan en el paso final de Wrangler; la ingesta, los tests y el build
   no tienen acceso a ellos. No deben guardarse en variables, archivos `.env`, logs ni comandos
   versionados.

5. Añadir estas variables de Actions, que no son secretas:
   - `CLOUDFLARE_PAGES_PROJECT_NAME`: nombre exacto del proyecto, por ejemplo `fuelshift`.
   - `CLOUDFLARE_PAGES_URL`: origen HTTPS publicado, sin ruta, por ejemplo
     `https://fuelshift.pages.dev` o el dominio propio.

La guía oficial de [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
y la de [CI con Wrangler](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
describen el mismo modelo y las credenciales requeridas.

## Frecuencia y decisión de publicación

El cron `0 */4 * * *` solicita una comprobación a las 00:00, 04:00, 08:00, 12:00, 16:00 y
20:00 UTC. GitHub Actions no garantiza puntualidad: las ejecuciones programadas pueden retrasarse
y, con carga alta, alguna ejecución en cola puede descartarse. El inicio de cada hora es un periodo
de carga frecuente, pero se conserva el minuto cero porque forma parte de la frecuencia aprobada.
En repositorios públicos, GitHub desactiva los workflows programados tras 60 días sin actividad;
hay que volver a habilitarlo desde Actions si ocurre. Véase la documentación de GitHub sobre el
evento [`schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Observación del 13 al 17 de octubre de 2026: se ejecutaron entre 3 y 5 comprobaciones diarias de
las 6 solicitadas, con retrasos de hasta unas 2 h 30 min (por ejemplo, la franja de las 12:00 UTC
empezó entre las 14:44 y las 16:16). Todas terminaron correctamente y todas detectaron cambios de
precios reales, así que publicaron; no hubo fallos de MITECO en ese periodo. Si la antigüedad de los
datos llega a ser un problema, la opción más sencilla y sin coste es mover el cron a un minuto
distinto de cero (por ejemplo, `17 */4 * * *`), lo que requiere aprobar el cambio de frecuencia.

Cada ejecución recupera y valida primero el manifiesto publicado. La ingesta genera el candidato
con el pipeline habitual y compara los hashes SHA-256 de los archivos provinciales, ordenados por
identificador. Esos archivos contienen el contenido normalizado de las estaciones, incluidos los
precios; el manifiesto mantiene por separado fechas de descarga y métricas de ejecución. Por eso:

- un cambio en una estación o precio activa pruebas, preparación de JSON, build y despliegue;
- un cambio solo en `retrieved_at`, fecha comunicada por la fuente o métricas de ejecución no
  activa una publicación;
- un conjunto idéntico termina correctamente como comprobación sin cambios, antes del build y de
  Wrangler, salvo que una ejecución manual solicite expresamente publicar cambios de código.

La opción manual `force_deploy` permite publicar una nueva versión del código cuando los datos de
MITECO son idénticos. No evita ninguna protección: el manifiesto publicado debe recuperarse y
validarse, MITECO debe responder con un conjunto válido y se ejecutan las mismas pruebas,
preparación de datos, build y controles previos a Wrangler. El workflow y la política ejecutada en
Node comprueban de forma independiente que el evento sea `workflow_dispatch`; una ejecución
programada nunca puede forzar la publicación.

El máximo teórico es de 6 comprobaciones diarias: entre 168 y 186 ejecuciones en un mes de 28 a
31 días. Solo las que detectan cambios consumen un despliegue de Pages, por lo que el máximo de
186 queda por debajo del límite documentado de 500 despliegues mensuales del plan Free. Los
runners estándar son gratuitos mientras el repositorio sea público; si pasa a privado, las
ejecuciones consumirán la cuota de minutos de la cuenta y deberán revisarse antes de mantener el
cron. No se conservan artefactos de estas ejecuciones ni se añade almacenamiento de pago.

## Ejecución manual

El botón **Run workflow** solo aparecerá cuando el archivo del workflow esté en la rama por
defecto. Después de fusionar la PR con autorización expresa:

1. Abrir **Actions > Actualización MITECO en Cloudflare Pages > Run workflow**.
2. Seleccionar `main`.
3. En el primer despliegue, y solo si todavía no existe
   `/data/miteco/manifest.json`, activar `allow_missing_published_manifest`.
4. En todos los despliegues posteriores dejar esa opción desactivada.
5. Activar `force_deploy` solo cuando sea necesario publicar cambios de código aunque el contenido
   de MITECO sea idéntico. Dejarlo desactivado para una comprobación ordinaria.
6. Revisar el resultado de la comparación. Si hay cambios o se solicitó el forzado manual, deben
   terminar correctamente los controles, la preparación de datos, el build y el control de límites
   antes de Wrangler. Si no hay cambios, el workflow finaliza correctamente sin esos pasos.

GitHub exige que un workflow manual exista en la rama por defecto; por eso esta PR prepara el
mecanismo pero no puede publicarlo por sí sola. El workflow no responde a `push` ni a
`pull_request`.

## Protección de los datos publicados

Antes de la ingesta se descarga el manifiesto vigente desde `CLOUDFLARE_PAGES_URL`. Se exige
HTTPS, `application/json`, contrato `1.0.0`, un `station_count` positivo y un tamaño máximo de
1 MiB. Si la URL está configurada y la descarga o la validación falla, el workflow termina sin
desplegar.

La ingesta reutiliza ese recuento como referencia y aplica los controles documentados: al menos
10 000 estaciones válidas, como máximo un 2 % de rechazos y como máximo un 20 % de descenso
respecto a la versión publicada. Después, `npm run data:prepare` vuelve a validar rutas,
recuentos, identificadores, tamaños y hashes. El build debe producir el manifiesto dentro de
`out/`, no puede contener funciones ni enlaces simbólicos y debe respetar los límites de Pages
Free.

La excepción del primer despliegue es deliberadamente manual. La expresión del workflow solo la
admite cuando el evento es `workflow_dispatch`; una ejecución programada ignora esa opción y
bloquea la publicación si el manifiesto está ausente, corrupto, es incompatible o no se puede
descargar. Permitir su ausencia cuando ya debería existir eliminaría la comparación histórica y
debe considerarse un error operativo.

`force_deploy` no modifica esta regla: forzar una publicación no permite continuar con un
manifiesto ausente, corrupto o inaccesible, salvo la excepción independiente y exclusivamente
manual del primer despliegue.

## Fallos y recuperación

- Si falla MITECO, cualquier validación, los tests o el build, corregir la causa y volver a
  ejecutar el workflow. No hay que borrar ni reemplazar el despliegue vigente.
- Si GitHub retrasa o descarta una ejecución programada, lanzar una ejecución manual sin activar
  la excepción de primer despliegue. La siguiente ejecución programada también vuelve a comparar
  contra la versión que siga publicada.
- Si el manifiesto no se puede recuperar o validar, comprobar primero la URL pública y el estado
  de Cloudflare. No activar la excepción manual salvo para el primer despliegue real.
- Si Wrangler falla durante la carga, comprobar credenciales, nombre de proyecto y límites. Un
  despliegue fallido no debe usarse como producción; verificar la URL vigente antes de reintentar.
- Si una publicación completada presenta un problema no detectado, abrir el proyecto en
  **Cloudflare > Workers & Pages > Deployments**, localizar el último despliegue de producción
  válido y elegir **Rollback to this deployment**. Los previews no son destinos de rollback.
- Tras recuperar, confirmar que `/data/miteco/manifest.json` corresponde al despliegue restaurado
  antes de volver a ejecutar la ingesta.
- Revocar y regenerar inmediatamente el token si pudiera haberse expuesto. Actualizar solo el
  secreto del entorno de GitHub; no registrar su valor en incidencias o logs.

Cloudflare documenta el procedimiento de
[rollback de Pages](https://developers.cloudflare.com/pages/configuration/rollbacks/).

## Coste y límites del plan gratuito

Comprobado el 12 de octubre de 2026 contra la documentación oficial:

- Pages Free admite 500 despliegues al mes, 20 000 archivos por sitio, 25 MiB por archivo, un
  despliegue concurrente, 100 dominios personalizados por proyecto y 100 proyectos por cuenta.
- Las solicitudes a activos estáticos son gratuitas e ilimitadas. Añadir Pages Functions haría
  aplicable la cuota de Workers, por lo que este workflow las rechaza explícitamente.
- El repositorio público puede usar runners estándar de GitHub Actions sin coste de minutos. Si
  el repositorio se vuelve privado, se aplicará la cuota y la facturación configurada en la
  cuenta de GitHub.
- No se suben artefactos del workflow ni se usan productos de almacenamiento persistente. Los
  datos vigentes forman parte del propio despliegue estático.

Referencias: [límites de Pages](https://developers.cloudflare.com/pages/platform/limits/),
[precios de activos estáticos](https://developers.cloudflare.com/pages/functions/pricing/) y
[facturación de GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Los límites y precios pueden cambiar. Se comprobaron por última vez el 12 de octubre de 2026 y
deben revisarse si cambia la visibilidad del repositorio, el plan o la frecuencia.
