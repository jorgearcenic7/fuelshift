# Auditoría final del rediseño

16 de noviembre de 2026. Rama `redesign`, base local `fbb840c`, compartida con
`main`. Se conservaron los cambios locales previos y la dirección visual de
Claude. Sin commits, publicaciones, dependencias nuevas ni cambios del pipeline.

## Defectos y correcciones

| Prioridad | Hallazgo comprobado                                                                                       | Corrección                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P1        | Desbordamiento del comparador a 320 px; números inválidos largos podían ampliar el campo indefinidamente. | Controles que pueden saltar de línea y anchura máxima de los campos.                                               |
| P1        | El foco podía entrar en contenido recortado de la hoja móvil.                                             | La hoja se amplía al enfocar su contenido; se conserva el botón de reducción y el retorno del foco desde la ficha. |
| P1        | El mapa provincial solo ofrecía interacción de puntero.                                                   | Un punto de tabulación, flechas, Inicio/Fin y Escape; anuncio del precio, muestra y diferencia nacional.           |
| P2        | Precargas RSC devolvían 404 al servir la exportación con un servidor de archivos.                         | Enlaces HTML en la navegación, con rutas terminadas en `/`. Se ha probado la navegación entre las tres secciones.  |
| P2        | Avisos de MapLibre en escudos de carretera sin `ref_length`.                                              | Filtro numérico seguro en las tres capas afectadas; se conservan los demás filtros y referencias válidas.          |
| P2        | El tooltip se remontaba en cada movimiento sobre el mismo marcador.                                       | Reutilización del popup abierto, verificada conservando su elemento DOM durante el hover.                          |
| P2        | Etiquetas de combustible comprimidas, provincias truncadas e indicadores mensuales muy estrechos.         | Etiquetas con salto de línea, nombres completos e indicadores apilados por debajo de 375 px.                       |
| P2        | Los filtros saltaban al aparecer la fecha del conjunto.                                                   | Espacio reservado para los metadatos durante la carga.                                                             |
| P3        | Barras de resultado de 380 ms y flecha decorativa al volver de la ficha.                                  | Transición de 200 ms en `transform`, flecha estable y tooltip sin animación con movimiento reducido.               |

Se corrigieron también el icono repetido de atribución y su solapamiento con el
texto al ampliar el objetivo táctil a 44 px.

Se mantienen el mapa protagonista, filtros, ranking, selección, precios enviados
al comparador, ejemplos identificados, cálculos, histórico diario y mensual.
Las geometrías no intervienen en ninguna agregación ni en el filtrado geográfico.

## Archivos del refinamiento

- `src/app/globals.css`.
- `src/components/layout/site-header.tsx`.
- `src/components/comparison/energy-calculator.tsx`.
- `src/components/map/fuel-map-app.tsx`, `station-map.tsx`, `station-detail.tsx`,
  `price-heatmap-legend.tsx`, `map-style.ts` y `map-style.test.ts`.
- `src/components/statistics/province-map.tsx`, `province-ranking.tsx` y
  `monthly-history-panel.tsx`.
- `scripts/browser-smoke.mjs`: adapta la comprobación al panel actual y añade
  comparador, navegación estática, interacción táctil y regresiones de foco/hover.
- Este documento. Los artefactos visuales y la copia de referencia inicial están
  bajo `.screenshots/`, ignorado por Git.

## Verificación ejecutada

- `npm run lint`: correcto, sin avisos.
- `npm run typecheck`: correcto; el build final vuelve a comprobar TypeScript.
- `npm run test:coverage`: 415 pruebas, 29 archivos; 98,47 % de líneas en el ámbito
  configurado (dominio, acceso a datos y utilidades, no componentes React).
- `npm run build`: correcto, diez salidas estáticas.
- `npm run test:browser`, contra `out/` servido localmente: tres páginas a 320,
  375, 768, 1024 y 1440 px; sin desbordamiento, errores JS, avisos de consola ni
  respuestas de red fallidas. Prueba clústeres, tooltip estable, estación, filtros,
  zoom, escala del calor, foco, Escape, cálculo, validación, deslizador,
  provincias, histórico diario y navegación.
- `node scripts/monthly-history-browser.mjs`: cinco anchos, cambios de ámbito y
  combustible, tooltip, teclado y estados vacío, huecos, corrupto, HTTP y ausente.
- `prettier --check src scripts`: correcto. `git diff --check`: correcto.
- `npm run format:check`: falla por `EPERM` al recorrer
  `data/processed/miteco`; no es una incidencia de formato del código revisado.
- Impeccable: contexto del proyecto cargado y detector sin hallazgos mecánicos;
  revisión visual y de animaciones con criterios de polish y Emil Kowalski.
  Sin MCP de navegador: Playwright local y CDP del Chromium instalado.

## Recursos y evidencia

La fuente Overpass conserva su OFL local y ocupa 29.108 bytes. La nueva geometría
provincial ocupa 45.896 bytes: 52 identificadores únicos, contornos no vacíos y
Ceuta/Melilla como puntos. Natural Earth permite el uso y modificación de estos
[datos de dominio público](https://www.naturalearthdata.com/about/terms-of-use/).
La atribución aparece ahora junto al mapa. Se conserva OpenFreeMap, cuya
[instancia pública es gratuita](https://openfreemap.org/), con las atribuciones
cartográficas originales.

Comparativa local: `.screenshots/comparativa.html`, con quince pares antes/después.
Las capturas iniciales corresponden al servidor de desarrollo; las finales a
la exportación estática. No son una prueba automatizada de igualdad de píxeles.
Los informes E2E y las mediciones de carga están en `.screenshots/after/`.
La última medición local a 375 px registró CLS de 0,025 en el mapa (0 en las
otras dos rutas), LCP de 5,1 s en el mapa y tareas largas de hasta 1,19 s.
Comparador y estadísticas registraron LCP de 328 y 336 ms, respectivamente.
Estos resultados describen una carga local con GPU por software; queda pendiente
determinar el coste de arranque del mapa en hardware real.

## Límites y pendientes

- **Baja, entorno:** la comprobación global de formato necesita acceso de lectura
  al directorio de datos indicado; no se han cambiado permisos del equipo.
- **Media, validación pendiente:** rendimiento y gestos en un teléfono físico,
  Safari y lector de pantalla real. Se ha usado Chromium con emulación táctil y
  GPU por software; sus tiempos locales no equivalen a métricas de producción.
  No se dispone de una medición de rendimiento anterior comparable para afirmar
  una mejora global ni ausencia absoluta de regresiones.
- No se ha desplegado ni probado producción. No quedan fallos funcionales
  reproducidos en el alcance local comprobado.
