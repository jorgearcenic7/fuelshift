# 0007. Intermediario de rutas en Cloudflare Workers Free con presupuesto persistente

Estado: Aceptada (26 de noviembre de 2026). Condición económica cumplida el 27 de noviembre de
2026 con la [confirmación escrita de Geoapify](#confirmación-escrita-de-geoapify). La
[activación provisional](#historial-activación-provisional-retirada) queda finalizada y retirada
del código. Modifica la [ADR 0001](0001-exportacion-estatica.md) solo en un punto: añade un
Worker independiente para rutas, desplegado por el propietario en Workers Free
(`https://fuelshift-rutas.jorgearcenic7.workers.dev`). La web sigue siendo un sitio estático
en Cloudflare Pages.

## Contexto

FuelShift 1.2.0 necesita distancias y tiempos por carretera. Los precios de MITECO no dependen
de cada visita, pero las rutas sí, y los proveedores exigen una clave. AGENTS.md prohíbe poner
secretos en el navegador y exige 0 €/mes; para el proveedor de rutas, verificado antes de su
aprobación. Cualquier vía para generar costes con peticiones externas cuenta como
vulnerabilidad P0 y bloquea la publicación.

Condiciones consultadas el 2026-11-26 y revisadas el 2026-11-27:

- **Geoapify Free**
  ([precios](https://www.geoapify.com/pricing/),
  [detalle de créditos](https://www.geoapify.com/pricing-details/),
  [términos](https://www.geoapify.com/term-and-conditions/) (versión 5, 2 de febrero de 2024),
  [privacidad](https://www.geoapify.com/privacy-policy/),
  [DPA](https://www.geoapify.com/data-processing-agreement/) (revisión 2024/08/15)):
  - 3000 créditos al día, hasta 5 peticiones/s y sin tarjeta.
  - Coste ([matriz](https://apidocs.geoapify.com/docs/route-matrix/),
    [ruta](https://apidocs.geoapify.com/docs/routing/)): parte fija conocida antes de llamar
    (celdas de la matriz, pares de puntos, cada opción `avoid`, países excluidos, lugares y
    polígonos evitados, detalles y elevación) más 1 crédito por cada 500 km de **cada**
    distancia devuelta. Ese recargo depende de la ruta que calcule el proveedor.
  - No publica si cobra las peticiones fallidas ni a qué hora reinicia la cuota diaria.
  - Los términos generales permiten suspender el servicio o cobrar excesos sin excluir Free de
    forma expresa, y admiten Free en producción «con algunas limitaciones». La confirmación
    escrita del 27 de noviembre de 2026 resuelve ambas dudas para FuelShift.
  - Exige atribución a Geoapify y a OpenStreetMap.
  - Su DPA lo define como encargado del tratamiento (KEPTAGO LTD, Chipre). Trata los datos en
    la UE y conserva los datos identificativos de las peticiones 24 h en general, hasta 2 meses
    ante actividad sospechosa o fraudulenta. Entre sus subencargados figura Cloudflare
    (Cloudflare, Inc. y Cloudflare Germany GmbH) para `api.geoapify.com`; solo
    `api-eu.geoapify.com` se declara «strictly EU-bound».
- **openrouteservice:** no se han podido leer sus planes ni sus términos. Su política de
  privacidad menciona transferencias fuera de la UE y no trata las coordenadas.
- **Workers Free**
  ([precios](https://developers.cloudflare.com/workers/platform/pricing/),
  [límites](https://developers.cloudflare.com/workers/platform/limits/)):
  - 100 000 peticiones al día, 10 ms de CPU y 50 subpeticiones.
  - Al superar el límite devuelve el error 1027; no hay cargos por exceso.
  - [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
    registra la URL de cada invocación y la conserva 3 días en Free.
- **Durable Objects Free**
  ([precios](https://developers.cloudflare.com/durable-objects/platform/pricing/)):
  - Solo con almacenamiento SQLite.
  - 100 000 peticiones, 5 millones de filas leídas y 100 000 escritas al día.
  - Al superar un límite, las operaciones «fail with an error».
- **Cloudflare como encargado**
  ([política de privacidad](https://www.cloudflare.com/privacypolicy/), vigente desde el 4 de
  noviembre de 2025; [DPA de clientes](https://www.cloudflare.com/cloudflare-customer-dpa/),
  versión 6.4 de 3 de abril de 2026): encargado del contenido que transita por sus servicios y
  responsable de sus datos de red y seguridad. Transferencias a EE. UU. mediante el Marco de
  Privacidad de Datos UE-EE. UU. y, en su defecto, cláusulas contractuales tipo. No publica un
  plazo de conservación de las IP. El DPA forma parte del acuerdo principal; no dice de forma
  expresa cómo se aplica a las cuentas Free de autoservicio.

## Confirmación escrita de Geoapify

El 27 de noviembre de 2026 Alfiya Tarasenko, cofundadora de Geoapify, respondió por correo
electrónico a la consulta del propietario sobre la cuenta y el proyecto de FuelShift. El
propietario conserva el original; aquí solo se recoge su contenido, sin direcciones de correo:

- Superar los límites del plan Free nunca genera cargos, facturas ni obligaciones de pago,
  tampoco por un uso no autorizado de la clave. Por encima del límite, las peticiones se
  rechazan con HTTP 429.
- El plan Free nunca pasa automáticamente a una suscripción de pago.
- Ningún plan tiene cargos por exceso, así que no se aplican al proyecto gratuito.
- Se permite el uso público en producción con la atribución
  «Powered by Geoapify | © OpenStreetMap contributors».
- No existe un tope de crédito configurable; la respuesta 429 actúa como límite.
- El DPA estándar se aplica automáticamente a las cuentas del plan Free.
- El correo constituye su confirmación escrita.

**Alcance:** cubre la cuenta y el proyecto de Geoapify del Worker de producción de FuelShift en
el plan Free. No cubre otros planes, otras cuentas ni un cambio posterior de las condiciones.
Con ella se da por verificado el coste de 0 €/mes del proveedor de rutas que exige AGENTS.md y
desaparece la vía de costes que bloqueaba matriz y ruta.

## Decisión

- Un Worker (`workers/routing/`) es el único que habla con Geoapify. La clave y el secreto
  de seudonimización son secretos de Wrangler. El navegador solo conoce la URL del Worker.
- Un único Durable Object SQLite (`RoutingBudget`) lleva un presupuesto global, persistente y
  atómico:
  - Ventana móvil de 24 h, para no depender de la hora de reinicio del proveedor.
  - **2400 créditos** de Geoapify en cualquier ventana de 24 h, repartidos en matriz 1800,
    ruta 300 y autocompletado 300 (`DEFAULT_LIMITS` en `limits.ts`). Es el único presupuesto.
  - Antes de cada llamada se aplica una política económica (`costs.ts`):
    - Coste fijo (autocompletado, 1 crédito): se reserva exactamente.
    - Coste sin cota previa (matriz y ruta, por el recargo de distancia): **bloqueado** con
      el error `cost-unbounded`, sin reservar ni llamar, salvo que
      `GEOAPIFY_CHARGE_GUARANTEE` valga exactamente `"confirmada-por-escrito"`. Así un
      despliegue con los valores del repositorio sigue sin llamar.
    - Con ese valor se reserva el mínimo y se liquida el coste real con todos sus recargos;
      lo liquidado corta las peticiones siguientes.
  - No se usan estimaciones geográficas (línea recta × factor) como cota: un rodeo, un ferri o
    un corte pueden multiplicar la distancia sin límite conocido.
  - Cada reintento se reserva aparte y solo repite las llamadas fallidas. Se esperan
    todas las matrices y se liquidan individualmente, incluidos sus recargos.
    Una petición fallida cuenta como cobrada al menos por su reserva.
  - El diario `pending_settlements` persiste coste y pausa antes de aplicarlos juntos.
    Toda reserva sin liquidar bloquea operaciones nuevas, sin caducar su plaza de
    concurrencia. Se admite una operación atómica a la vez, con sus matrices en paralelo.
    Si el resultado no llegó a persistirse por una caída del almacenamiento o del
    transporte, se conserva el bloqueo hasta reconciliarlo con el consumo del proveedor.
  - No hay devoluciones; la liquidación solo puede subir el coste.
  - Pausa automática tras un 429 o una clave rechazada.
- Límites iniciales y revisables (`workers/routing/src/limits.ts`):
  - Por visitante: 3 operaciones de rutas/matrices por minuto y 10 al día. La geometría
    seleccionada cuenta como otra operación explícita; autocompletado tiene límites propios.
  - Global: 30 operaciones de rutas/matrices por minuto, hasta 4 llamadas en una operación
    y 5 llamadas por segundo en ventana móvil, incluidas matrices, autocompletado y reintentos.
  - 15 candidatas por búsqueda.
  - Un solo reintento, solo con una reserva nueva.
  - Autocompletado de 3 a 80 caracteres, con 5 resultados.
- Defensas complementarias: lista cerrada de tres rutas (`/v1/legs`, `/v1/route`,
  `/v1/autocomplete`), validación estricta, cuerpo máximo de 4 KB, puntos dentro de un mismo
  territorio español, detección de duplicados, CORS por origen e IP seudonimizada
  (IPv6 por red /64).
- Fail-closed: si el Durable Object falla o no responde, si falta un secreto o si un
  interruptor no vale exactamente `"true"`, no se consulta al proveedor.
- Si Geoapify se agota, no se cambia a otro proveedor. openrouteservice queda fuera del Worker.
- Las matrices no requieren un permiso consumible de la ruta: su presupuesto, duplicados
  y límites se comprueban en cada operación. Así una ruta directa en caché puede servir
  para comparar otro combustible sin repetirla. El botón «Mostrar recorrido» pide solo
  origen → estación seleccionada → destino (o regreso al origen), con perfil `drive`,
  tipo `balanced` y paradas `stopover`, iguales a las matrices. Antes de dibujar se
  contrasta distancia y tiempo con el cálculo (tolerancias de 1 %, mínimo 50 m y 60 s);
  si difieren, se pide recalcular. Cambiar de selección cancela la consulta y retira
  el trazado anterior; la caché vive únicamente en memoria.
- Una alarma persistente del Durable Object elimina los identificadores seudónimos
  al cumplir 48 h, también sin nuevas visitas. Cloudflare ejecuta alarmas con entrega
  al menos una vez y puede retrasarlas o reintentarlas durante una incidencia; no es
  una garantía de borrado al milisegundo. La deuda contable se conserva sin identificador
  tras ese plazo y sigue bloqueando hasta reconciliarse.
- Workers Logs desactivado en `wrangler.toml` (`[observability] enabled = false`): el texto
  de las direcciones viaja en la URL del autocompletado y no debe quedar registrado.
- Se descarta Turnstile por ahora. No añade garantía económica y exigiría un widget y una
  verificación más por búsqueda. Se reconsiderará si el abuso agota el presupuesto a menudo y
  deja el servicio sin disponibilidad.

## Qué garantiza el código y qué depende de cuentas y contratos

| Garantía                                                    | Depende de                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Las reservas de 24 h no superan 2400 créditos               | Código (pruebas de concurrencia y persistencia)                   |
| El contador sobrevive a despliegues y reinicios             | Código y Durable Objects SQLite (no borrar la clase)              |
| Sin consultas si hay dudas sobre el saldo                   | Código (fail-closed)                                              |
| Sin el valor de garantía, solo sale coste fijo ya reservado | Código (`chargePolicy`, pruebas con rodeos de 2, 5 y 10 veces)    |
| Con el valor de garantía, todo recargo real se contabiliza  | Código; el total puede superar el presupuesto por recargos        |
| Superar la cuota de Geoapify no genera cargos               | Confirmación escrita de Geoapify del 27-11-2026 para FuelShift    |
| Exceder Workers o Durable Objects no genera cargos          | Cuenta de Cloudflare en plan Free, sin Workers Paid ni tarjeta    |
| La clave no llega al navegador ni al repositorio            | Código y secreto de Wrangler cargado por el propietario           |
| Las peticiones del Worker no quedan en Workers Logs         | `wrangler.toml` desplegado; comprobar el panel tras el despliegue |

El presupuesto de 2400 créditos deja 600 de margen sobre la cuota. Ya no protege frente a
cargos, que Geoapify descarta por escrito, sino la disponibilidad: evita que el abuso agote la
cuota del día y deja hueco a los recargos por distancia, que pueden hacer que la última
operación admitida rebase el presupuesto antes de cortar las siguientes. Si aun así se agota
la cuota, Geoapify responde 429, el Worker pausa el proveedor y el resto de la web sigue.

## Privacidad y atribución

- Atribución con el texto exacto pedido por Geoapify,
  «Powered by Geoapify | © OpenStreetMap contributors», con enlaces a Geoapify y a los
  derechos de OpenStreetMap (`src/components/refuel/geoapify-attribution.tsx`). Aparece junto
  a las sugerencias de direcciones, mientras se muestre la dirección elegida y en los
  resultados de rutas.
- El Worker no reenvía cabeceras ni la IP del visitante (solo `Content-Type`); la petición
  sale desde Cloudflare hacia `api.geoapify.com`.
- FuelShift no guarda trayectos legibles. El Durable Object conserva el seudónimo de la
  conexión (hash con secreto) y la clave de cada operación (hash del seudónimo y de la
  consulta) hasta que la alarma los borra, unas 48 h.
- La ubicación se redondea a unos 11 m antes de enviarla, solo con permiso del navegador, y
  el autocompletado no envía la ubicación.
- La página de privacidad (`/privacidad/`, `src/app/privacidad/page.tsx`) describe este
  tratamiento y se enlaza desde el pie del mapa, el aviso del panel de repostaje, el
  comparador, las estadísticas y la página 404. Falta que el propietario complete la
  identidad y el contacto del responsable antes de publicar.

## Activar (lo hace el propietario)

1. Comprobar que la cuenta de Cloudflare sigue en plan Free, sin Workers Paid.
2. Desde `workers/routing/`, revisar sin publicar y después desplegar:

   ```sh
   npx wrangler deploy --dry-run --var ROUTING_ENABLED:true --var GEOAPIFY_ENABLED:true --var GEOAPIFY_CHARGE_GUARANTEE:confirmada-por-escrito
   npx wrangler deploy --var ROUTING_ENABLED:true --var GEOAPIFY_ENABLED:true --var GEOAPIFY_CHARGE_GUARANTEE:confirmada-por-escrito
   ```

3. Comprobar en el panel de Cloudflare que el Worker no tiene Workers Logs activo.
4. Probar una búsqueda en `https://fuelshift.pages.dev`, comprobar la atribución y revisar el
   consumo en el panel de Geoapify.

Los valores de `wrangler.toml` siguen desactivados: un despliegue sin `--var` vuelve al estado
seguro. Activar y desactivar siempre con `wrangler deploy`, que publica la versión al 100 %.

La clave y el proyecto de Geoapify siguen siendo **exclusivos del Worker de producción**. No se
usan en desarrollo local, pruebas ni otros entornos: el presupuesto interno solo ve las llamadas
del Worker y cualquier otro uso consumiría cuota sin contabilizarse. Las pruebas usan
proveedores simulados y claves ficticias.

## Desactivar o revertir

- Emergencia (deja de llamar a Geoapify en cuanto se publica la versión):

  ```sh
  npx wrangler deploy --var ROUTING_ENABLED:false --var GEOAPIFY_ENABLED:false --var GEOAPIFY_CHARGE_GUARANTEE:ninguna
  ```

  Un `npx wrangler deploy` sin `--var` produce el mismo estado, porque usa los valores del
  repositorio y conserva los secretos.

- Corte sin desplegar: `npx wrangler secret delete GEOAPIFY_API_KEY`. Sin clave, el Worker
  responde «no disponible».
- Restaurar la clave sin reactivar el servicio. `wrangler secret put` y
  `wrangler secret delete` crean una versión nueva que hereda los valores de la vigente. Por
  eso, en este orden:
  1. `npx wrangler deploy`, sin `--var`: publica los valores desactivados del repositorio.
  2. `npx wrangler deployments status`: comprobar que esa versión sirve el 100 %. Si la
     última versión no está desplegada, Wrangler rechaza `secret put`.
  3. `npx wrangler secret put GEOAPIFY_API_KEY`: la versión nueva hereda los valores
     desactivados.
  4. Reactivar solo con el comando de activación, si procede.

  `scripts/routing-runtime-smoke.mjs` comprueba en workerd que, con la clave presente y los
  valores de `wrangler.toml`, el Worker responde «no disponible» sin reservar ni llamar.

- El contador persiste entre despliegues: lo consumido sigue contando en su ventana de 24 h.

## Historial: activación provisional retirada

El 26 de noviembre de 2026 el propietario autorizó una excepción temporal mientras llegaba la
respuesta de Geoapify: el valor `GEOAPIFY_CHARGE_GUARANTEE = "provisional-sin-confirmacion"`
habilitaba matriz y ruta con un presupuesto reducido de 300 créditos por 24 h (matriz 220,
ruta 40, autocompletado 40), aceptando el riesgo económico residual (PR #59).

La excepción terminó con la confirmación del 27 de noviembre de 2026. Se retiró su código
(`CHARGE_GUARANTEE_PROVISIONAL`, `PROVISIONAL_LIMITS`, `chargeMode` y `limitsFor`) para dejar
un solo presupuesto y un solo valor de activación, y para que el Worker y el Durable Object no
puedan leer modos distintos durante un despliegue. Las demás protecciones no cambian. Si el
Worker siguiera desplegado con el valor provisional, la versión nueva bloquea matriz y ruta
con `cost-unbounded` hasta desplegar con `confirmada-por-escrito`; las pruebas y el smoke de
workerd lo comprueban.

## Alternativas descartadas

- **Clave de Geoapify en el navegador restringida por origen**: el origen se puede falsificar
  fuera del navegador y no hay contador global.
- **Contador en memoria o en KV**: la memoria se pierde al reiniciar y no es global; KV no es
  atómico.
- **openrouteservice como respaldo automático**: no se han verificado sus condiciones ni su
  privacidad.
- **Mantener el modo provisional como reserva**: duplicaba presupuestos, pruebas y
  procedimientos sin aportar protección tras la confirmación; el comando de emergencia cubre
  la vuelta atrás.
- **Retirar `GEOAPIFY_CHARGE_GUARANTEE`**: haría que `ROUTING_ENABLED` y `GEOAPIFY_ENABLED`
  bastaran para llamar. Se conserva como tercer interruptor explícito, que deja constancia en
  cada despliegue de en qué se apoya la activación.

## Consecuencias

- Hay que mantener un segundo despliegue, que hace el propietario a mano. Ningún workflow
  despliega el Worker.
- El Worker está desplegado con `workers_dev = true` y `preview_urls = false`. Los valores
  del repositorio mantienen las consultas desactivadas (`ROUTING_ENABLED` y
  `GEOAPIFY_ENABLED` valen `"false"`, `GEOAPIFY_CHARGE_GUARANTEE = "ninguna"`). Los secretos
  ya están cargados. La web se compila con `NEXT_PUBLIC_ROUTING_URL` (en los workflows de CI
  y despliegue; `.env.local` en local) y el origen del Worker figura en `connect-src` de
  `public/_headers`; mientras siga desactivado, cada búsqueda responde «no disponible» sin
  consultar a Geoapify.
- Los límites de Workers y Durable Objects y la cuota de Geoapify pueden agotarse por abuso. En
  ese caso se pierde disponibilidad de rutas, no dinero, y el mapa, los filtros, el comparador y
  las estadísticas siguen funcionando.

## Revisar si

- Geoapify cambia sus planes, créditos, atribución o condiciones del plan Free, o FuelShift
  cambia de cuenta, proyecto o plan: la confirmación escrita solo cubre el caso actual.
- Geoapify publica su hora de reinicio o un parámetro que acote el recargo por distancia.
- Se decide usar `api-eu.geoapify.com` para que todo el tratamiento de Geoapify quede en la UE.
- Cloudflare cambia los límites de Workers Free o de Durable Objects Free.
- El presupuesto se agota de forma habitual.
