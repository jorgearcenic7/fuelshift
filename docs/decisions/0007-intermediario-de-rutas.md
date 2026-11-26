# 0007. Intermediario de rutas en Cloudflare Workers Free con presupuesto persistente

Estado: Aceptada la arquitectura (26 de noviembre de 2026); activación de Geoapify pendiente
de confirmación económica. Modifica la [ADR 0001](0001-exportacion-estatica.md) solo en un
punto: añade un Worker independiente para rutas, desplegado por el propietario en Workers Free
(`https://fuelshift-rutas.jorgearcenic7.workers.dev`). La web sigue siendo un sitio estático
en Cloudflare Pages.

## Contexto

FuelShift 1.2.0 necesita distancias y tiempos por carretera. Los precios de MITECO no dependen
de cada visita, pero las rutas sí, y los proveedores exigen una clave. AGENTS.md prohíbe poner
secretos en el navegador y exige 0 €/mes. Cualquier vía para generar costes con peticiones
externas cuenta como vulnerabilidad P0 y bloquea la publicación.

Condiciones consultadas el 2026-11-26:

- **Geoapify Free**
  ([precios](https://www.geoapify.com/pricing/),
  [detalle de créditos](https://www.geoapify.com/pricing-details/),
  [términos](https://www.geoapify.com/term-and-conditions/),
  [privacidad](https://www.geoapify.com/privacy-policy/)):
  - 3000 créditos al día, hasta 5 peticiones/s y sin tarjeta.
  - Coste ([matriz](https://apidocs.geoapify.com/docs/route-matrix/),
    [ruta](https://apidocs.geoapify.com/docs/routing/)): parte fija conocida antes de llamar
    (celdas de la matriz, pares de puntos, cada opción `avoid`, países excluidos, lugares y
    polígonos evitados, detalles y elevación) más 1 crédito por cada 500 km de **cada**
    distancia devuelta. Ese recargo depende de la ruta que calcule el proveedor.
  - No publica si cobra las peticiones fallidas.
  - Los límites son «blandos»: avisan y pueden bloquear la cuenta. Su FAQ dice que no
    bloquean de inmediato al superar el uso, sino que contactan; no aclara si cobran.
  - Los términos permiten suspender el servicio o cobrar excesos, sin aclarar si esto último
    se aplica al plan gratuito.
  - El uso en producción se admite «con algunas limitaciones» sin detallar.
  - Exige atribución a Geoapify y a OpenStreetMap.
  - Aloja en la UE y conserva las peticiones correctas 24 h como máximo.
  - No publica a qué hora reinicia la cuota diaria.
- **openrouteservice:** no se han podido leer sus planes ni sus términos. Su política de
  privacidad menciona transferencias fuera de la UE y no trata las coordenadas.
- **Workers Free**
  ([precios](https://developers.cloudflare.com/workers/platform/pricing/),
  [límites](https://developers.cloudflare.com/workers/platform/limits/)):
  - 100 000 peticiones al día, 10 ms de CPU y 50 subpeticiones.
  - Al superar el límite devuelve el error 1027; no hay cargos por exceso.
- **Durable Objects Free**
  ([precios](https://developers.cloudflare.com/durable-objects/platform/pricing/)):
  - Solo con almacenamiento SQLite.
  - 100 000 peticiones, 5 millones de filas leídas y 100 000 escritas al día.
  - Al superar un límite, las operaciones «fail with an error».

## Decisión

- Un Worker (`workers/routing/`) es el único que habla con Geoapify. La clave y el secreto
  de seudonimización son secretos de Wrangler. El navegador solo conoce la URL del Worker.
- Un único Durable Object SQLite (`RoutingBudget`) lleva un presupuesto global, persistente y
  atómico:
  - Ventana móvil de 24 h, para no depender de la hora de reinicio del proveedor.
  - 2400 créditos de Geoapify, repartidos en matriz 1800, ruta 300 y autocompletado 300.
  - Antes de cada llamada se aplica una política económica (`costs.ts`):
    - Coste fijo (autocompletado, 1 crédito): se reserva exactamente.
    - Coste sin cota previa (matriz y ruta, por el recargo de distancia): **bloqueado** con
      el error `cost-unbounded`, sin reservar ni llamar, mientras
      `GEOAPIFY_CHARGE_GUARANTEE` no valga exactamente `"confirmada-por-escrito"`.
    - Con esa garantía se reserva el mínimo y se liquida el coste real con todos sus
      recargos; lo liquidado corta las peticiones siguientes.
  - No se usan estimaciones geográficas (línea recta × factor) como cota económica: un
    rodeo, un ferri o un corte pueden multiplicar la distancia sin límite conocido.
  - Cada reintento se reserva aparte y solo repite las llamadas fallidas. Se esperan
    todas las matrices y se liquidan individualmente, incluidos sus recargos.
    Una petición fallida cuenta como cobrada al menos por su reserva.
  - El diario `pending_settlements` persiste coste y pausa antes de aplicarlos juntos.
    Toda reserva sin liquidar bloquea operaciones nuevas, sin caducar su plaza de
    concurrencia. Se admite una operación atómica a la vez, con sus matrices en paralelo.
    Si el resultado no llegó a persistirse por una caída del almacenamiento o del
    transporte, se conserva el bloqueo hasta reconciliarlo con el consumo del proveedor;
    no se presupone que el mínimo reservado cubra sus recargos.
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
- Se descarta Turnstile por ahora. No añade garantía económica (la dan la política económica y
  el presupuesto global, no la identidad del visitante) y exigiría un widget y una verificación más por búsqueda. Se reconsiderará
  si el abuso agota el presupuesto a menudo y deja el servicio sin disponibilidad.

## Qué garantiza el código y qué depende de cuentas y contratos

| Garantía                                                                     | Depende de                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Las reservas de cualquier ventana de 24 h no superan 2400 créditos           | Código (pruebas de concurrencia y persistencia)                |
| El contador sobrevive a despliegues y reinicios                              | Código y Durable Objects SQLite (no borrar la clase)           |
| Sin consultas si hay dudas sobre el saldo                                    | Código (fail-closed)                                           |
| Sin garantía del proveedor, solo salen peticiones de coste fijo ya reservado | Código (`chargePolicy`, pruebas con rodeos de 2, 5 y 10 veces) |
| Con garantía, todo recargo real se contabiliza                               | Código; el total sí puede superar 2400 créditos por recargos   |
| Superar la cuota de Geoapify no genera cargos                                | **Solo** una confirmación escrita de Geoapify                  |
| Exceder Workers o Durable Objects no genera cargos                           | Cuenta de Cloudflare en plan Free, sin Workers Paid ni tarjeta |
| La clave no llega al navegador ni al repositorio                             | Código y secreto de Wrangler cargado por el propietario        |

No hay garantía económica de matriz ni ruta basada en el código: su coste no tiene cota antes
de la petición. Una cuenta sin tarjeta tampoco es garantía contractual, porque los términos
permiten cobrar excesos. El margen de 600 créditos sobre la cuota es solo disponibilidad.

La [guía oficial de Geoapify](https://www.geoapify.com/get-started-with-maps-api/)
sí afirma ahora que Free nunca se cobra ni se convierte automáticamente en pago. Sus
términos generales mantienen la cláusula de recargos sin exclusión expresa de Free.
Esta discrepancia sigue bloqueando la activación hasta confirmación aplicable a la cuenta.

## Alternativas descartadas

- **Clave de Geoapify en el navegador restringida por origen**: el origen se puede falsificar
  fuera del navegador y no hay contador global.
- **Contador en memoria o en KV**: la memoria se pierde al reiniciar y no es global; KV no es
  atómico.
- **openrouteservice como respaldo automático**: no se han verificado sus condiciones ni su
  privacidad.

## Consecuencias

- Hay que mantener un segundo despliegue, que hace el propietario a mano. Ningún workflow
  despliega el Worker.
- El Worker está desplegado con `workers_dev = true` y `preview_urls = false`, pero las
  consultas siguen desactivadas (`ROUTING_ENABLED` y `GEOAPIFY_ENABLED` valen `"false"`,
  `GEOAPIFY_CHARGE_GUARANTEE = "ninguna"`). Los secretos ya están cargados. La web se compila
  con `NEXT_PUBLIC_ROUTING_URL` (`.env.production` y `.env.development`) y el origen del
  Worker figura en `connect-src` de `public/_headers`; mientras siga desactivado, cada
  búsqueda responde «no disponible» sin consultar a Geoapify. Antes de activarlo hay que:
  1. Obtener de Geoapify por escrito que la cuenta, sin tarjeta, no puede generar cargos al
     superar la cuota, y confirmar las «limitaciones» del uso en producción. Solo entonces se
     asigna `GEOAPIFY_CHARGE_GUARANTEE = "confirmada-por-escrito"`; sin ella, «Repostar cerca
     de mí» y «Repostar durante un viaje» siguen desactivados aunque el Worker esté activo.
  2. Comprobar que la cuenta de Cloudflare sigue en plan Free.
  3. Cambiar `ROUTING_ENABLED` y `GEOAPIFY_ENABLED` a `"true"` y volver a desplegar el Worker.
  4. Comprobar la atribución a Geoapify y OpenStreetMap que ya muestra el panel de
     resultados.
- Los límites de Workers y Durable Objects pueden agotarse por abuso. En ese caso se pierde
  disponibilidad de rutas, no dinero, y el mapa, los filtros, el comparador y las estadísticas
  siguen funcionando.

## Revisar si

- Geoapify publica su hora de reinicio, cambia sus créditos o aclara los cargos del plan
  gratuito.
- Geoapify ofrece un tope de gasto o un parámetro que limite el recargo por distancia antes de
  la petición: permitiría una cota verificable sin depender de la garantía.
- Cloudflare cambia los límites de Workers Free o de Durable Objects Free.
- El presupuesto se agota de forma habitual.
