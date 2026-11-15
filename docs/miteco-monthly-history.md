# Histórico mensual MITECO — v1.1.0 en preparación

Serie independiente del [histórico diario](price-history.md), sin cambios en su
ingesta, almacenamiento ni despliegue. No se usa el histórico de la Comisión Europea.

## Fuente comprobada

Peticiones reales realizadas el **15 de noviembre de 2026**. Documentación:
[API oficial de MITECO](https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/help).
Resultados resumidos en [la evidencia de verificación](evidence/miteco-history-api-2026-11-15.json).

La API ofrece `EstacionesTerrestresHist/{FECHA}` y filtros por comunidad autónoma,
provincia, municipio y producto, también combinados con producto. La fecha usa
`dd-mm-aaaa`. No hay endpoint documentado por `IDEESS`, intervalo ni paginación.
El pipeline usa una respuesta nacional por fecha para evitar 52 consultas provinciales.

- Primera fecha verificable: **01/01/2007**. Las consultas de 31/12/2006 y 01/01/2006
  devuelven HTTP 400 indicando expresamente ese límite. No hay 20 años completos en noviembre de 2026.
- Nacional: 7.202 registros en enero de 2007 (7.729.132 bytes), 10.400 en julio de 2020
  (11.190.703 bytes) y 11.427 en noviembre de 2026 (12.302.351 bytes), con 52 ámbitos en las tres fechas.
- Madrid: verificados enero de 2007 y julio de 2010, 2015, 2020 y noviembre de 2026.
  La carga mensual posterior verifica cada mes individualmente; no deduce continuidad de estos sondeos.
- Base completada: **239/239 muestras nacionales**, enero de 2007–noviembre de 2026,
  y 159 series (España y 52 ámbitos, tres combustibles). Los huecos provinciales se
  concentran en Melilla: un mes de gasóleo A y 225 meses sin gasolina 98 E5.
  El [informe de cobertura](evidence/miteco-history-coverage-2026-11-15.json) conserva los recuentos.
  Se eliminaron dos filas duplicadas idénticas y un precio de gasolina 95 fuera de rango.
  La base completa ocupa 3.279.846 bytes, incluida la procedencia; la mayor serie,
  descargada individualmente por el navegador, ocupa 6.881 bytes.
- JSON UTF-8, precios decimales con coma y vacíos como `""`. Exigir `ResultadoConsulta=OK`
  y fecha devuelta igual a la solicitada. Los errores de fecha pueden llegar como HTTP 400.
- Productos: `1` = gasolina 95 E5, `3` = gasolina 98 E5 y `4` = gasóleo A habitual.
  Disponibles ya en enero de 2007; se conserva la nomenclatura actual que la API aplica
  retrospectivamente. No se infiere la composición química de los productos antiguos.
  Los endpoints filtrados por producto devuelven **`PrecioProducto`**, no los campos
  de precio de la respuesta nacional; el pipeline no mezcla ambos contratos.
- `IDEESS`, `IDMunicipio`, `IDProvincia` e `IDCCAA` son cadenas. Provincia conserva
  dos dígitos; el catálogo tiene la clave oficial `IDPovincia`. Los municipios son
  identificadores internos de la API, no se equiparan a códigos INE.
- No se ha encontrado una cuota documentada ni garantía de cobertura, disponibilidad,
  inmutabilidad o permanencia de identificadores. Los límites de descarga son propios.

## Metodología y contrato

Una fotografía del **día 1 de cada mes a las 00:00 según `Fecha` de la API**. No
es una media mensual de días ni una serie de transacciones. Periodos de 1, 5, 10,
15, 20 años y Todo: solo se habilitan los que cubre realmente la serie seleccionada.

Media aritmética por estación con `Tipo Venta=P`. Cada estación pesa una vez. España
incluye los 52 ámbitos: Península, Baleares, Canarias, Ceuta y Melilla, con sus
diferencias fiscales. El precio comunicado incorpora su fiscalidad territorial;
no se incorporan descuentos o bonificaciones externos al precio de la API.
La media nacional se calcula sobre estaciones, nunca sobre medias provinciales.

Se toman exclusivamente `Precio Gasolina 95 E5`, `Precio Gasolina 98 E5` y
`Precio Gasoleo A`. Se excluyen vacíos y precios fuera de 0,1–10 €/L. Los registros
con el mismo `IDEESS` e idéntico contenido se cuentan una vez (caso real: estación
9111 en marzo de 2007). Duplicados con diferencias bloquean la publicación.
Se registra el número de duplicados y precios excluidos. Un mes necesita 52 ámbitos,
al menos 5.000 estaciones y no más del 5 % de precios fuera de rango por combustible.
Los cambios en las estaciones y sus productos afectan a la comparabilidad temporal.

Cada observación es `[fecha, media redondeada a 5 decimales, estaciones con precio]`.
Sin precio: `[fecha, null, 0]`. El gráfico corta las líneas en meses ausentes y sus
puntos y tooltip representan solo observaciones reales. No se inventan valores.
Las variaciones comparan primera y última observación disponible y muestran ambas fechas.

La web carga un manifiesto pequeño y **solo un ámbito y combustible cada vez**.
El contrato está en [monthly-history.schema.json](../contracts/schemas/monthly-history.schema.json).
La procedencia de cada muestra conserva URL, fecha solicitada/devuelta, recuperación,
bytes, SHA-256 de la respuesta original, recuentos nacionales y provinciales, medias
sin redondear y exclusiones. No se conservan ni envían al navegador las respuestas
íntegras nacionales; su hash permite contrastarlas con una futura descarga.

## Reproducción y recuperación

```powershell
$env:PYTHONPATH = 'pipeline/src'
# Incremental: recupera la base estática y descarga como máximo 3 meses pendientes.
.\.venv\Scripts\python.exe -m fuelshift_data.monthly_history

# Primera reconstrucción completa: 239 consultas mensuales hasta noviembre de 2026.
# Solo necesaria sin base publicada ni caché. Secuencial, con pausas y sin datos diarios.
.\.venv\Scripts\python.exe -m fuelshift_data.monthly_history --end 2026-11-15 --max-downloads 240

# Volver a generar usando únicamente muestras locales; los meses ausentes quedan explícitos.
.\.venv\Scripts\python.exe -m fuelshift_data.monthly_history --offline --end 2026-11-15
```

Caché ignorada: `data/cache/miteco-monthly/AAAA-MM-01.json`. La salida inicial real
queda en `public/data/historico-miteco/`, lista para exportación estática y para que
el propietario la revise e incluya en su commit. También sirve de base si se pierde
la caché. No es una fixture ni necesita consultar MITECO durante los tests o el build.

Descargas limitadas a 50 MiB, timeout de 60 segundos, tres intentos para fallos de
red, HTTP 429 y 5xx; backoff y `Retry-After` numérico (máximo 120 segundos).
Pausa predeterminada de dos segundos entre fechas (mínimo uno, usado en el backfill local).
Los errores de contrato no se reintentan. Un fallo conserva la caché de meses correctos
y el manifiesto anterior. Las generaciones son inmutables y el manifiesto se sustituye
atómicamente al terminar. No se permite reducir el número de muestras publicadas ni
retroceder su fecha final. No se revisan automáticamente meses ya recuperados.

## Automatización y publicación

[update-miteco-history.yml](../.github/workflows/update-miteco-history.yml) define
una ejecución mensual, el día 3, y manual. Solo se ejecuta desde `main`, con permisos
de lectura y `MITECO_MONTHLY_ENABLED=true`. Recupera la base versionada, la última
copia publicada en Pages y el artefacto más reciente disponible entre las últimas
20 ejecuciones del mismo workflow en `main`. También permite recuperar el artefacto
de un intento anterior de la propia ejecución al reintentar un job. Valida manifiesto,
procedencia, fechas, recuentos, medias y los
159 JSON antes de combinarlos. Los meses coincidentes deben ser idénticos; un conflicto
bloquea la entrega. Descarga solo los meses pendientes (máximo tres) y conserva el resultado
validado como artefacto `miteco-monthly` durante 90 días. Un fallo no reemplaza el último válido.
Si faltan más de tres meses, se requiere una reconstrucción manual con un límite explícito.

La ejecución mensual correcta activa mediante `workflow_run` el
[despliegue existente de Cloudflare](../.github/workflows/deploy-cloudflare.yml).
Solo se aceptan ejecuciones correctas de `main` en el propio repositorio; se ejecuta
código de `main`, nunca código incluido en artefactos. La serialización del despliegue
existente sigue vigente. El nuevo histórico puede forzar la publicación aunque no cambien
los precios actuales ni el diario. La observación diaria y su guardado conservan su mecanismo.

**Cada despliegue**, también los ordinarios cada cuatro horas y aunque la actualización
mensual esté desactivada, recupera y valida la copia publicada y el último artefacto:
no vuelve a la base inicial. El build debe incluir exactamente la generación seleccionada;
se comprueban los 159 archivos de `out/` antes de ejecutar Wrangler. No se añaden escrituras
en ramas, permisos Git de escritura ni servicios de pago para el histórico mensual.

Persistencia: el artefacto conserva los meses nuevos incluso si falla después el despliegue;
la copia de Pages conserva lo ya publicado aunque expire el artefacto. Si el artefacto no
está disponible se recupera Pages. Solo un HTTP 404 del manifiesto permite la primera
publicación desde la base inicial; una caída de red, otro HTTP o datos corruptos bloquean
el despliegue y mantienen el sitio anterior. No se ocultan esos fallos publicando una base antigua.
Los huecos por combustible y provincia se mantienen como `[fecha, null, 0]` en todas las copias.
La recuperación de Pages lee solo el manifiesto y la procedencia agregada; no vuelve
a consultar los meses históricos en MITECO ni descarga las 159 series por la red.

Tras el merge, configurar en **Settings → Secrets and variables → Actions → Variables**
la variable de repositorio `MITECO_MONTHLY_ENABLED=true`. Se reutilizan las credenciales
de Cloudflare, el entorno `production` y los permisos de lectura de Actions. No hacen falta
secretos nuevos ni otra rama de datos. `CLOUDFLARE_PAGES_URL` debe apuntar al mismo proyecto;
el actualizador mensual usa por defecto `https://fuelshift.pages.dev` si no existe la variable
a nivel de repositorio. Si se cambia de proyecto, configurar también esa variable allí.
Actions debe estar habilitado y cualquier aprobación ya exigida por `production` sigue aplicando.
Opcionalmente ejecutar el workflow mensual desde `main` para comprobar la primera entrega
sin esperar al día 3; su finalización correcta solicitará el despliegue ordinario automáticamente.
No se han activado variables, ejecutado workflows remotos ni desplegado durante esta revisión local.

Referencia: [evento `workflow_run` de GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

## Histórico individual de estaciones

El `IDEESS=3118` aparece en Ajalvir (`IDMunicipio=4277`, provincia `28`) tanto en
enero de 2007 como en los sondeos posteriores hasta noviembre de 2026. El filtro
municipal histórico devuelve sus precios. Esto demuestra viabilidad para ese caso,
sin probar estabilidad universal de identificadores, titularidad o marca.

No se incorpora todavía a la ficha: no existe consulta documentada por estación
ni por intervalo, y los agregados estáticos no permiten recuperar precios individuales.
Conservar 20 años de todas las estaciones multiplicaría el volumen y el trabajo de
actualización; consultar la API desde cada navegador carece de caché y control global
de carga. Ampliación posible: seleccionar estaciones y generar series mensuales
estáticas por `IDEESS`, usando respuestas municipales cacheadas, comprobando identidad,
cambios de ubicación y cobertura, y publicándolas con carga diferida desde la ficha.

## Validación

Pytest y Vitest usan fixtures locales. Cubren contratos, fechas, deduplicación,
filtros de venta pública, medias y recuentos, huecos, periodos, fallos de red simulados,
caché incremental, geometría, respuesta vacía y conservación del conjunto anterior.
El script `scripts/monthly-history-browser.mjs` comprueba interacción en escritorio
y móvil con datos estáticos reales y estados de error/vacío aislados mediante rutas locales.

Comprobaciones locales iniciales del 15/11/2026: 65 tests de Python y 383 de Vitest correctos;
cobertura del frontend del 98,36 % de líneas y 95,37 % de ramas. ESLint, Ruff,
typecheck, build estático y los 159 JSON contra su esquema, correctos. El histórico
mensual pasa en Chromium a 320, 390, 768, 1024 y 1440 px, también sobre la exportación
estática, sin desbordamiento ni errores de página. La regresión de navegador existente
del mapa, mapa de calor, filtros, estadísticas e histórico diario pasa igualmente
(28 observaciones diarias recuperadas de la copia pública solo para esa prueba).
El formato de los archivos modificados se comprobó por rutas explícitas: el comando
global de Prettier no puede recorrer ciertas cachés preexistentes por permisos locales.
La entrega automática tiene pruebas locales de recuperación, conflictos, corrupción, fallos
de red, caducidad del artefacto y concordancia del build. Su ejecución remota queda pendiente
de la activación tras el merge.
En la revisión de entrega se ejecutaron los tests afectados (31 de Python y 37 de Vitest),
ESLint, Ruff, typecheck y build, todos correctos. También se verificaron los 159 JSON
de la exportación contra la generación inicial completa, sin modificar sus huecos.
