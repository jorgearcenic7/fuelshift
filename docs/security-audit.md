# Auditoría de seguridad del frontend — 16/11/2026

Rama `redesign`, con todos los cambios locales conservados. Comparación real del export estático y `https://fuelshift.pages.dev` en Edge mediante Playwright instalado. Sin MCP de navegador disponible; el conector de GitHub falló al iniciar y se usó `gh` en lectura. Producción usa `main` (`fbb840cd`), sin los cambios locales del rediseño. No se ha desplegado ni escrito en GitHub.

## 1. Hallazgos y gravedad

No se han confirmado secretos expuestos, acceso no autorizado ni vulnerabilidades CRÍTICAS o ALTAS explotables desde el frontend. Esto describe el alcance probado, no garantiza ausencia absoluta de vulnerabilidades.

| Gravedad en FuelShift       | Evidencia                                                                                                                                                                                                                                 | Estado                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| MEDIO, herramientas         | `undici@7.29.1`, usado por Wrangler/Miniflare, tiene avisos de TLS, redirecciones y DoS. Wrangler también incluye código de esa versión en su CLI. No llega al export estático ni se ha demostrado explotación desde una visita a la web. | Pendiente actualizar y validar Wrangler. Un override de la dependencia no corrige necesariamente el código incluido en la CLI. |
| BAJO, herramientas          | `minimatch@10.2.6` en typescript-eslint: DoS con patrones controlados por un atacante y determinadas opciones. Los visitantes no controlan los patrones de lint.                                                                          | Pendiente actualización compatible de typescript-eslint; no se fuerza un cambio mayor de minimatch.                            |
| BAJO, defensa adicional     | CSP permite scripts y estilos `unsafe-inline`. No se ha encontrado una vía de inyección; reduce la defensa si apareciera una.                                                                                                             | Se conserva para la hidratación estática actual. Una CSP con hashes exige trabajo de build y validación adicional.             |
| BAJO, corregido             | El proceso de desarrollo existente escucha en `0.0.0.0:3000`; publica HMR y source maps de desarrollo. Accesibilidad desde otra máquina depende de la red/firewall y no se ha probado.                                                    | `npm run dev` limita futuros arranques a `127.0.0.1`. El proceso ya abierto requiere reinicio por el propietario.              |
| BAJO en este uso, corregido | `zod@4.6.5` tenía un aviso de agotamiento de memoria; solo lo consume el plugin de lint de React. La severidad del aviso upstream es alta.                                                                                                | Actualizado a `4.6.7` dentro del rango existente, sin añadir dependencias directas.                                            |

Avisos contrastados con las fuentes primarias: [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [Undici](https://github.com/advisories/GHSA-xjj6-f33q-929c), [Minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249). Next documenta las limitaciones de los nonces con renderizado estático en su [guía de CSP](https://nextjs.org/docs/app/guides/content-security-policy).

## 2. Secretos expuestos: NO detectados

Escaneo por patrones de tokens de GitHub, claves AWS, claves privadas PEM, JWT, credenciales en URLs y asignaciones literales de contraseñas/API keys/tokens, acompañado de revisión del código y workflows. No había Gitleaks/TruffleHog instalados; no se instalaron herramientas nuevas.

- Código/configuración del árbol de trabajo, incluidos cambios no versionados no ignorados; búsqueda explícita de `.env*` en la raíz (no hay archivos).
- Los 311 archivos de `public/` y los 369 de `out/` (unos 16 MB), incluidos JavaScript, CSS, HTML y JSON.
- Los 663 blobs únicos de los 149 commits alcanzables mediante las referencias locales de Git. No incluye objetos remotos no descargados ni commits inalcanzables.
- Los binarios de imagen/fuente no se analizaron como texto; se inventariaron. No hay archivos de claves, `.env`, symlinks ni source maps en el export.

Las únicas coincidencias son dos URLs ficticias de pruebas que comprueban precisamente el rechazo de credenciales, repetidas en distintas revisiones históricas. Evidencia enmascarada: `https://[REDACTED]@example.org`, `pipeline/tests/test_monthly_delivery.py:168`; `http://[REDACTED]@fuelshift.example`, `scripts/fetch-published-manifest.test.mjs:164`. No requieren rotación. No se encontraron variables `NEXT_PUBLIC_*` ni lectura de variables de entorno en el frontend. Hashes de integridad y metadatos públicos no son credenciales.

## 3. Qué ve un visitante con F12

Puede leer todo el JavaScript/CSS, cálculos del comparador, HTML, payloads de hidratación/RSC, valores introducidos, filtros y datos públicos descargados. Ocultar un elemento en el DOM no protege información; los atributos observados solo contienen estados de interfaz e identificadores públicos de estaciones. No hay controles privados o administrativos en el export.

En las tres páginas se registraron 128 respuestas locales y 167 de producción: todas HTTP 200, de FuelShift y `tiles.openfreemap.org`. No se observaron scripts externos, cabeceras de autenticación en las peticiones, cookies ni `Set-Cookie`. Sin claves de localStorage/sessionStorage, bases IndexedDB, CacheStorage o service workers en perfiles nuevos. La caché HTTP normal de recursos sí es legítima.

OpenFreeMap recibe las peticiones de teselas y, por tanto, IP y zona visualizada. La ubicación concedida con coordenadas de prueba no se guardó en almacenamiento ni apareció como coordenadas exactas en las nuevas peticiones observadas. El enlace voluntario de indicaciones sí puede comunicar coordenadas a OpenStreetMap. Los datos de estaciones incluyen direcciones y nombres comerciales oficiales; no son un fichero privado de usuarios.

No hubo errores de consola locales. Producción mostró tres advertencias de filtros cartográficos con valores nulos, sin datos sensibles. Las cancelaciones de teselas al cerrar páginas/cambiar selección son esperadas.

Además se descargaron y analizaron los 84 recursos de texto únicos observados de producción (6,76 MB), con los patrones completos de secretos: cero coincidencias y cero fallos. Un source map real de desarrollo devolvió HTTP 200 con `sourcesContent`, sin coincidencias de secretos; ese contenido no aparece en el export estático.

## 4. Archivos y rutas públicas

| Rutas                                                                                                                                         | Contenido y resultado                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/comparador/`, `/estadisticas/`                                                                                                         | Páginas públicas; HTTP 200 en local y producción.                                                                                                                |
| `/data/miteco/manifest.json`, `/data/miteco/provinces/NN.json`                                                                                | Estaciones, precios, coordenadas, fechas, fuente/licencia.                                                                                                       |
| `/data/estadisticas.json`, `/data/historico/nacional.json`                                                                                    | Estadísticas y observaciones oficiales públicas.                                                                                                                 |
| `/data/historico-miteco/manifest.json`, `/data/historico-miteco/sets/...`                                                                     | Histórico mensual, metadatos y series.                                                                                                                           |
| `/geo/provincias.json`                                                                                                                        | Geometría del rediseño local; no se solicitó en la versión actual de producción.                                                                                 |
| `/_next/static/*`, archivos `.txt` de Next, iconos y marcas                                                                                   | Código cliente, worker, fuente local y recursos/payloads públicos. Ningún `.map` en `out/`; el único mapa referenciado por el worker de producción devuelve 404. |
| `/.env`, `/.env.local`, `/.git/HEAD`, `/package.json`, `/next.config.ts`, `/AGENTS.md`, `/_headers`, `/src/app/page.tsx`, `/api/auth/session` | Las nueve rutas devuelven 404 en producción. Las comprobaciones locales equivalentes también devolvieron 404.                                                    |

`_headers` está en el directorio de exportación como configuración, pero [Cloudflare lo interpreta y no lo sirve como recurso](https://developers.cloudflare.com/pages/configuration/headers/). El servidor temporal de auditoría emuló esas reglas; las cabeceras de producción se observaron independientemente. `noindex` y CORS `*` para recursos públicos no son controles de autorización.

## 5. XSS y cabeceras

Revisado el código: no hay `dangerouslySetInnerHTML`, `eval`, `new Function` ni escritura de HTML no confiable. React renderiza los campos como texto; los popups de MapLibre usan `setText`. El contrato provincial limita rutas y coordenadas; los parámetros del comparador validan combustible, precio e identificador. Los enlaces de indicaciones se construyen con un destino conocido y los enlaces a pestañas nuevas usan `noreferrer`.

Prueba real solo local: intercepción de JSON provinciales con marcas `<img ... onerror=...>` y direcciones `<svg onload=...>`. Tanto listado como ficha mostraron el texto literal; cero elementos inyectados y cero ejecución. Parámetros maliciosos del comparador fueron ignorados, sin reflejo ejecutable.

Producción aplica CSP con orígenes restringidos, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri/form-action 'self'`, `worker-src 'self'` y sin `unsafe-eval`; además `nosniff`, `DENY`, `strict-origin-when-cross-origin`, COOP `same-origin` y Permissions-Policy restrictiva. No hubo bloqueos CSP en los recorridos. Permanece la limitación `unsafe-inline` descrita arriba.

## 6. GitHub Actions y Cloudflare

- Workflows revisados: CI, despliegue, histórico mensual, verificación MITECO y vigilancia. Acciones externas fijadas a SHA; no se encontró `pull_request_target` ni interpolación directa de títulos/ramas no confiables en comandos. Se pasan por variables de entorno y se citan.
- Permisos de lectura por defecto. `contents: write` se limita al job que persiste el histórico en `data/...`, con validación explícita que excluye `main`. `issues: write` está limitado a vigilancia y justifica las alertas.
- Secretos Cloudflare solo en el paso final de Wrangler; no están en el entorno del build. Se publica exclusivamente `out/`, con comprobación de ausencia de workers/servidor, symlinks y límites de archivos. Los artefactos declarados contienen JSON de históricos, no `.env`, `.next` ni el workspace.
- El disparador `workflow_run` comprueba éxito, rama `main` y repositorio de origen. Se validan los datos recuperados. GH_TOKEN del histórico mensual tiene alcance de lectura, aunque abarca todo el job: reducirlo a sus pasos consumidores sería endurecimiento adicional.
- Consulta real de GitHub: `main` protegido, ruleset activo con PR, conversaciones resueltas, historial lineal, bloqueo de borrado y force push. Solo `repo-hygiene` es check obligatorio; valorar exigir también `frontend` y `python`. No se modificaron reglas.
- El entorno `production` permite despliegues desde `main`. Última ejecución de despliegue consultada: [43802139117](https://github.com/jorgearcenic7/FuelShift/actions/runs/43802139117), correcta y sobre `fbb840cd`. Su artefacto declarado es `historico-43802139117`.
- No se recuperaron valores de Secrets. Los endpoints privados de permisos globales de Actions devolvieron 401; no se pudieron verificar logs privados, contenido descargable de artefactos ni scopes/rotación del token de Cloudflare. Revisar manualmente que el token se limite a Pages y a la cuenta/proyecto necesarios. No se afirma haber auditado esos valores/configuraciones privadas.

## 7. Correcciones y verificaciones

Archivos cambiados en esta auditoría: `package.json` (desarrollo en loopback), `package-lock.json` (solo parche Zod) y este informe. Diseño, cálculos, datos, workflows y despliegue conservados. La CLI reconoce el nuevo comando mediante `npm run dev -- --help`; no se reinició el servidor preexistente. [Next documenta `--hostname`](https://nextjs.org/docs/app/api-reference/cli/next#next-dev-options).

| Verificación ejecutada              | Resultado                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run lint`                      | PASS, cero advertencias.                                                                                                                                                                                           |
| `npm run typecheck`                 | PASS.                                                                                                                                                                                                              |
| `npm test`                          | PASS: 415 tests, 29 archivos.                                                                                                                                                                                      |
| `npm run build`                     | PASS, exportación estática; salida real nuevamente escaneada.                                                                                                                                                      |
| `npm run test:browser` sobre `out/` | PASS: tres páginas en 320/375/768/1024/1440 px, interacciones y movimiento reducido; cero errores de consola/red.                                                                                                  |
| Playwright de seguridad             | PASS: tres rutas locales con cabeceras emuladas y tres de producción, almacenamiento, DOM, peticiones, nueve rutas sensibles y pruebas XSS locales.                                                                |
| `npm audit --omit=dev --json`       | Cero alertas.                                                                                                                                                                                                      |
| `npm audit --json`                  | De 14 a 10 paquetes con alertas: 9 moderadas y 1 alta, todas en herramientas de desarrollo/despliegue, agrupadas en las cadenas minimatch/undici. No equivale a diez vulnerabilidades independientes del frontend. |

Evidencia local no publicada en `.screenshots/security/`: `browser.json` (URLs, estados, cabeceras seleccionadas, hashes de respuestas y almacenamiento), `secret-scan.json` (ubicaciones y huellas enmascaradas), `additional.json`, `assets.json`, auditorías npm, `e2e/e2e-report.json` y capturas de las tres páginas locales/de producción. Los scripts temporales de comprobación están en `.screenshots/` y no se incorporan al producto.

## 8. Acciones pendientes

Reiniciar el proceso `dev` existente para aplicar loopback; actualizar y probar Wrangler/typescript-eslint; comprobar scopes y logs privados con acceso del propietario. La revisión de CSP con hashes y de checks obligatorios puede hacerse aparte. No se ha encontrado evidencia que exija revocar credenciales. Ningún commit, push, PR, merge o cambio en `main` realizado.
