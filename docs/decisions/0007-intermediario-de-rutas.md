# 0007. Intermediario de rutas en Cloudflare Workers Free con presupuesto persistente

Estado: Aceptada la arquitectura (26 de noviembre de 2026); confirmación económica de
Geoapify pendiente. El propietario autoriza una excepción temporal: la
[activación provisional](#activación-provisional-sin-confirmación-escrita) con presupuesto
reducido mientras llega la respuesta. Modifica la [ADR 0001](0001-exportacion-estatica.md) solo en un
punto: añade un Worker independiente para rutas, desplegado por el propietario en Workers Free
(`https://fuelshift-rutas.jorgearcenic7.workers.dev`). La web sigue siendo un sitio estático
en Cloudflare Pages.

## Contexto

FuelShift 1.2.0 necesita distancias y tiempos por carretera. Los precios de MITECO no dependen
de cada visita, pero las rutas sí, y los proveedores exigen una clave. AGENTS.md prohíbe poner
secretos en el navegador y exige 0 €/mes; para el proveedor de rutas, verificado antes de su
aprobación. Cualquier vía para generar costes con peticiones externas cuenta como
vulnerabilidad P0 y bloquea la publicación. La única excepción es la
[activación provisional](#activación-provisional-sin-confirmación-escrita), autorizada
expresamente por el propietario, temporal y con riesgo aceptado. No deroga esta regla ni
AGENTS.md, y no da por verificado el coste de 0 €/mes.

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
  - Presupuesto según el modo económico (`limitsFor` en `limits.ts`):
    - 2400 créditos de Geoapify, repartidos en matriz 1800, ruta 300 y autocompletado 300,
      solo con `GEOAPIFY_CHARGE_GUARANTEE = "confirmada-por-escrito"`.
    - 300 créditos (matriz 220, ruta 40 y autocompletado 40) con cualquier otro valor,
      incluidos el modo provisional y el bloqueado.
  - Antes de cada llamada se aplica una política económica (`costs.ts`):
    - Coste fijo (autocompletado, 1 crédito): se reserva exactamente.
    - Coste sin cota previa (matriz y ruta, por el recargo de distancia): **bloqueado** con
      el error `cost-unbounded`, sin reservar ni llamar, salvo que
      `GEOAPIFY_CHARGE_GUARANTEE` valga exactamente `"confirmada-por-escrito"` o, durante la
      excepción temporal, `"provisional-sin-confirmacion"`.
    - En esos dos modos se reserva el mínimo y se liquida el coste real con todos sus
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
| Las reservas de 24 h no superan 2400 créditos (300 sin confirmación escrita) | Código (pruebas de concurrencia y persistencia)                |
| El contador sobrevive a despliegues y reinicios                              | Código y Durable Objects SQLite (no borrar la clase)           |
| Sin consultas si hay dudas sobre el saldo                                    | Código (fail-closed)                                           |
| Sin garantía ni modo provisional, solo sale coste fijo ya reservado          | Código (`chargePolicy`, pruebas con rodeos de 2, 5 y 10 veces) |
| Con garantía o en modo provisional, todo recargo real se contabiliza         | Código; el total puede superar el presupuesto por recargos     |
| Superar la cuota de Geoapify no genera cargos                                | **Solo** una confirmación escrita de Geoapify                  |
| Activar sin confirmación escrita no genera cargos                            | Nada: riesgo aceptado temporalmente por el propietario         |
| Exceder Workers o Durable Objects no genera cargos                           | Cuenta de Cloudflare en plan Free, sin Workers Paid ni tarjeta |
| La clave no llega al navegador ni al repositorio                             | Código y secreto de Wrangler cargado por el propietario        |

No hay garantía económica de matriz ni ruta basada en el código: su coste no tiene cota antes
de la petición. Una cuenta sin tarjeta tampoco es garantía contractual, porque los términos
permiten cobrar excesos. El margen sobre la cuota (600 créditos con confirmación, 2700 en
modo provisional) es solo disponibilidad.

La [guía oficial de Geoapify](https://www.geoapify.com/get-started-with-maps-api/)
sí afirma ahora que Free nunca se cobra ni se convierte automáticamente en pago. Sus
términos generales mantienen la cláusula de recargos sin exclusión expresa de Free.
Por esta discrepancia, el coste de 0 €/mes no está verificado. La activación definitiva sigue
pendiente de una confirmación aplicable a la cuenta; hasta entonces solo cabe la excepción
provisional descrita a continuación.

## Activación provisional sin confirmación escrita

Excepción temporal autorizada expresamente por el propietario el 26 de noviembre de 2026,
mientras se espera la respuesta de Geoapify. **No es una confirmación escrita ni la sustituye,
y no existe garantía económica**: el propietario acepta temporalmente el riesgo económico
residual descrito arriba. Es una excepción a la regla P0 del contexto y a la verificación
previa de 0 €/mes que exige AGENTS.md, que no se modifica. Termina cuando Geoapify responda.

- Modo explícito: `GEOAPIFY_CHARGE_GUARANTEE = "provisional-sin-confirmacion"`
  (`CHARGE_GUARANTEE_PROVISIONAL` en `costs.ts`). Es un valor distinto de
  `"confirmada-por-escrito"`. Cualquier valor que no sea uno de esos dos, aunque solo difiera
  en mayúsculas o espacios, bloquea matriz y ruta con `cost-unbounded`.
- Presupuesto reducido (`PROVISIONAL_LIMITS` en `limits.ts`): **300 créditos** en cualquier
  ventana móvil de 24 h, repartidos en matriz 220, ruta 40 y autocompletado 40. El Worker y el
  Durable Object lo eligen a partir del mismo valor. Solo `"confirmada-por-escrito"` usa los
  2400 créditos iniciales; ante cualquier otro valor se aplica el reducido.
- Se mantienen sin cambios la reserva atómica, el diario de liquidaciones, la deuda sin
  reconciliar como bloqueo, una operación a la vez, los límites por visitante y globales, las
  pausas tras 429 o clave rechazada, el reintento único, CORS, la validación, la
  seudonimización, el borrado por alarma, el fail-closed y los interruptores
  `ROUTING_ENABLED` y `GEOAPIFY_ENABLED`.
- Los valores de `wrangler.toml` siguen desactivados. La activación se pasa con `--var` al
  desplegar; un despliegue sin esas opciones vuelve al estado seguro.
- La clave y el proyecto de Geoapify son **exclusivos del Worker de producción de
  FuelShift**. No se usan en desarrollo local, pruebas, otras aplicaciones ni otros
  entornos. El presupuesto interno solo ve las llamadas del Worker; cualquier otro uso
  consumiría el margen sin contabilizarse. Las páginas consultadas no aclaran si la cuota se
  cuenta por proyecto o por cuenta, así que tampoco se crean otros proyectos en la misma
  cuenta mientras dure la excepción. Las pruebas usan proveedores simulados y claves ficticias.
- Activar y desactivar siempre con `wrangler deploy`, que publica la versión al 100 %. Con un
  despliegue gradual (`wrangler versions deploy` por porcentajes), el Worker y el Durable
  Object podrían leer modos distintos durante la transición.

### Riesgos aceptados

- Superar la cuota podría generar cargos, porque los términos lo permiten y no hay
  exclusión escrita para la cuenta. Con 300 créditos internos sobre una cuota de 3000, hacen
  falta unos 2700 créditos de recargos no previstos para rebasarla, siempre que la clave y el
  proyecto no se usen fuera del Worker. Las pruebas comprueban
  que solo la última operación admitida puede pasar del presupuesto, porque su coste real se
  liquida al terminar y bloquea las siguientes. No es una cota garantizada: el recargo por
  distancia no tiene cota previa.
- Si el almacenamiento falla después de una llamada, la reserva queda bloqueando hasta
  reconciliarla (sin nuevas consultas). El coste real de esa llamada puede no quedar
  registrado.
- Pocas búsquedas al día: unas 7 de «Repostar cerca de mí» (30 créditos cada una) si nadie
  más consume. Al agotarse, la web muestra el límite y el resto de funciones siguen.
- Uso en producción «con algunas limitaciones» sin detallar en los términos, aunque la
  página de precios lo admite si se respetan cuota, límites y atribución.

### Privacidad y atribución comprobadas antes del tráfico público

Lectura del 26 de noviembre de 2026 de los
[términos](https://www.geoapify.com/term-and-conditions/), los
[precios](https://www.geoapify.com/pricing/) y la
[privacidad](https://www.geoapify.com/privacy-policy/) de Geoapify:

- La atribución a Geoapify es obligatoria en Free y la de OpenStreetMap siempre, «near the
  map or information provided by the service». El panel de resultados ya la mostraba. Ahora
  también aparece junto a las sugerencias de direcciones y mientras se muestre la dirección
  elegida, porque ambas son datos de Geoapify.
- Según su política, Geoapify aloja en la UE y «generally» conserva no más de 24 h el
  cuerpo, las cabeceras, la IP y la hora de las peticiones correctas. Es un plazo publicado,
  no una garantía. No publica cuánto conserva las fallidas ni si actúa como encargado del
  tratamiento. El Worker no reenvía cabeceras ni la IP del visitante (solo `Content-Type`);
  la petición sale desde Cloudflare.
- FuelShift no guarda trayectos legibles. El Durable Object conserva el seudónimo de la
  conexión (hash con secreto) y la clave de cada operación (hash del seudónimo y de la
  consulta) hasta que la alarma los borra, unas 48 h. La alarma se entrega al menos una vez y
  puede retrasarse, así que el plazo no es exacto.
- La nota del panel avisa, antes de calcular, de qué se envía y de esos plazos, presentados
  como aproximados o según la política de Geoapify.
- La ubicación se redondea a unos 11 m antes de enviarla, solo con permiso del navegador, y
  el autocompletado no envía la ubicación.

### Activar (lo hace el propietario)

1. Comprobar que la cuenta de Cloudflare sigue en plan Free, sin Workers Paid.
2. Desde `workers/routing/`, revisar sin publicar y después desplegar:

   ```sh
   npx wrangler deploy --dry-run --var ROUTING_ENABLED:true --var GEOAPIFY_ENABLED:true --var GEOAPIFY_CHARGE_GUARANTEE:provisional-sin-confirmacion
   npx wrangler deploy --var ROUTING_ENABLED:true --var GEOAPIFY_ENABLED:true --var GEOAPIFY_CHARGE_GUARANTEE:provisional-sin-confirmacion
   ```

3. Probar una búsqueda en `https://fuelshift.pages.dev` y revisar el consumo en el panel de
   Geoapify.

### Desactivar o revertir

- Emergencia (deja de llamar a Geoapify en cuanto se publica la versión):

  ```sh
  npx wrangler deploy --var ROUTING_ENABLED:false --var GEOAPIFY_ENABLED:false --var GEOAPIFY_CHARGE_GUARANTEE:ninguna
  ```

  Un `npx wrangler deploy` sin `--var` produce el mismo estado, porque usa los valores del
  repositorio y conserva los secretos.

- Corte sin desplegar: `npx wrangler secret delete GEOAPIFY_API_KEY`. Sin clave, el Worker
  responde «no disponible».
- Restaurar la clave sin reactivar el servicio. `wrangler secret put` y
  `wrangler secret delete` crean una versión nueva que hereda los valores de la vigente.
  Cargar la clave con el modo provisional aún activo reactivaría el tráfico al instante. Por
  eso, en este orden:
  1. `npx wrangler deploy`, sin `--var`: publica los valores desactivados del repositorio.
  2. `npx wrangler deployments status`: comprobar que esa versión sirve el 100 %. Si la
     última versión no está desplegada, Wrangler rechaza `secret put`.
  3. `npx wrangler secret put GEOAPIFY_API_KEY`: la versión nueva hereda los valores
     desactivados.
  4. Reactivar solo con el comando de activación, si procede.

  `scripts/routing-runtime-smoke.mjs` comprueba en workerd que, con la clave presente y los
  valores de `wrangler.toml`, el Worker responde «no disponible» sin reservar ni llamar.

- El contador persiste entre despliegues: lo consumido en modo provisional sigue contando en
  su ventana de 24 h aunque cambie el modo.
- Cuando Geoapify responda:
  - Si confirma por escrito que no puede haber cargos, se pasa a
    `GEOAPIFY_CHARGE_GUARANTEE:confirmada-por-escrito` (presupuesto de 2400) y se actualiza
    esta ADR con la fecha y la referencia de la respuesta.
  - Si no lo confirma o confirma que puede cobrar, se desactiva con el comando de emergencia.
    Después se valora retirar el modo provisional del código.

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
- El Worker está desplegado con `workers_dev = true` y `preview_urls = false`. Los valores
  del repositorio mantienen las consultas desactivadas (`ROUTING_ENABLED` y
  `GEOAPIFY_ENABLED` valen `"false"`, `GEOAPIFY_CHARGE_GUARANTEE = "ninguna"`). Los secretos
  ya están cargados. La web se compila
  con `NEXT_PUBLIC_ROUTING_URL` (en los workflows de CI y despliegue; `.env.local` en local) y el origen del
  Worker figura en `connect-src` de `public/_headers`; mientras siga desactivado, cada
  búsqueda responde «no disponible» sin consultar a Geoapify. Hay dos formas de activarlo:
  - **Provisional**, mientras dure la excepción: se sigue la
    [sección anterior](#activación-provisional-sin-confirmación-escrita).
  - **Definitiva**:
    1. Obtener de Geoapify por escrito que la cuenta, sin tarjeta, no puede generar cargos
       al superar la cuota, y confirmar las «limitaciones» del uso en producción.
    2. Comprobar que la cuenta de Cloudflare sigue en plan Free.
    3. Desplegar con `GEOAPIFY_CHARGE_GUARANTEE:confirmada-por-escrito` en lugar del valor
       provisional, con los mismos `--var` de activación, y anotar aquí la respuesta.
    4. Comprobar la atribución a Geoapify y OpenStreetMap.

    Sin uno de los dos modos, «Repostar cerca de mí» y «Repostar durante un viaje» siguen
    desactivados aunque el Worker esté activo.

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
- Geoapify responde a la consulta económica, o el consumo de su panel se acerca a la cuota:
  termina o se revisa la excepción provisional.
