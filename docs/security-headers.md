# Cabeceras de seguridad

Cloudflare Pages aplica las cabeceras de [`public/_headers`](../public/_headers), que Next.js copia
a `out/` en el build. No requiere Pages Functions ni ningún servicio adicional y no tiene coste.
Límites del plan, según la
[documentación de Cloudflare](https://developers.cloudflare.com/pages/configuration/headers/):
100 reglas y 2.000 caracteres por línea. Una URL que coincide con varias reglas recibe las
cabeceras de todas.

## Valores y motivo

| Cabecera                                   | Valor                             | Motivo                                                                                       |
| ------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`                  | Ver la tabla siguiente            | Limita de dónde se cargan scripts, estilos, imágenes y conexiones.                           |
| `X-Content-Type-Options`                   | `nosniff`                         | El navegador no reinterpreta el tipo de los archivos.                                        |
| `X-Frame-Options`                          | `DENY`                            | Impide incrustar la web en marcos de otros sitios (clickjacking), junto a `frame-ancestors`. |
| `Referrer-Policy`                          | `strict-origin-when-cross-origin` | A otros sitios solo se envía el origen, nunca la ruta ni la búsqueda.                        |
| `Permissions-Policy`                       | `geolocation=(self)`, resto `()`  | Solo la propia web puede pedir la ubicación; cámara, micrófono, pagos y USB quedan vetados.  |
| `Cross-Origin-Opener-Policy`               | `same-origin`                     | Aísla la ventana de las que abra o la abran desde otros orígenes.                            |
| `X-Robots-Tag` (en `/data/*` y `/_next/*`) | `noindex`                         | Los JSON y archivos técnicos no aparecen como resultados de búsqueda.                        |

Directivas de la CSP:

| Directiva                   | Valor                                        | Por qué                                                                                                                                                                       |
| --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`               | `'self'`                                     | Todo lo no listado solo puede venir del propio sitio.                                                                                                                         |
| `script-src`                | `'self' 'unsafe-inline'`                     | La exportación estática de Next.js incrusta scripts en el HTML; sin servidor no hay nonces. Sin `'unsafe-inline'` la web no llega a hidratarse (comprobado).                  |
| `style-src`                 | `'self' 'unsafe-inline'`                     | Next.js y React escriben estilos en línea (barras de estadísticas, color de marca de la ficha).                                                                               |
| `img-src`                   | `'self' data: https://tiles.openfreemap.org` | Logotipos propios, iconos en `data:` de la hoja de estilos y recursos del mapa base.                                                                                          |
| `connect-src`               | `'self' data: https://tiles.openfreemap.org` | Datos publicados, estilo, teselas y fuentes del mapa. MapLibre carga con `fetch` las imágenes `data:` del mapa de calor: sin `data:` la superficie no se dibuja (comprobado). |
| `worker-src`                | `'self'`                                     | El worker de MapLibre se sirve desde `/_next/static/`.                                                                                                                        |
| `font-src`                  | `'self'`                                     | No se cargan fuentes externas; las del mapa llegan por `connect-src`.                                                                                                         |
| `frame-ancestors`           | `'none'`                                     | Equivalente moderno de `X-Frame-Options: DENY`.                                                                                                                               |
| `base-uri`, `form-action`   | `'self'`                                     | Evita cambiar la base de las URL o enviar formularios a otro sitio.                                                                                                           |
| `object-src`                | `'none'`                                     | Sin plugins.                                                                                                                                                                  |
| `upgrade-insecure-requests` | —                                            | Cualquier recurso `http:` se pide por HTTPS.                                                                                                                                  |

No se usa ningún comodín de dominio. Los enlaces a OpenStreetMap (indicaciones), al catálogo de
MITECO y a la licencia son navegaciones, no recursos, y no dependen de la CSP.

## Cómo se ha probado

El 21 de octubre de 2026, en local y antes de publicarlas, con un servidor que aplica `_headers`
como Cloudflare Pages (reglas con un splat, herencia y `404.html`) sobre el build estático y con
los datos publicados en producción:

- Recorrido completo en Edge: mapa, mapa de calor, selección de estación, zoom, geolocalización
  concedida, comparador, estadísticas, página 404, imagen `og-image.png` y JSON de datos. Sin
  ninguna violación de CSP (evento `securitypolicyviolation`) ni errores de consola.
- `npm run test:browser` completo con esas cabeceras: correcto.
- Con `blob:` en `img-src` no cambia nada: se retiró por innecesario.
- Sin `data:` en `connect-src` el mapa de calor deja de dibujarse; sin `'unsafe-inline'` en
  `script-src` la web no carga. Por eso se mantienen.

Falta comprobarlo en producción tras el despliegue (véase [`release.md`](release.md)).

## Limitaciones conocidas

- `script-src 'unsafe-inline'` reduce la protección frente a XSS: un script inyectado en el HTML
  se ejecutaría. El riesgo es bajo porque la web no tiene formularios que se guarden, sesiones ni
  contenido de usuarios, y todos los datos se escapan al renderizar. Mejora posible: calcular en
  el build los hashes de cada script en línea y escribirlos en `_headers`, a cambio de un paso de
  build más y de vigilar el límite de 2.000 caracteres por línea.
- Si se cambia de proveedor de mapa o se añade cualquier recurso externo, hay que añadir su
  origen exacto a `img-src` o `connect-src` y repetir las pruebas.
- `*.pages.dev` está en la lista de precarga HSTS del dominio `.dev`, así que no hace falta
  `Strict-Transport-Security`. Si se usa un dominio propio, conviene añadirla.
