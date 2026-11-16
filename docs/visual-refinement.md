# Refinamiento visual profundo

16 de noviembre de 2026. Trabajo exclusivo en `redesign`, sobre los cambios
locales de Claude y Codex, sin commits, publicaciones ni modificaciones de `main`.

## Cambios visibles

- **Mapa:** panel de 460 px a partir de 1280 px (antes, 400 px), 400 px a 1024
  y 344 px en tablet. Cabecera de 72 px, título mayor, búsqueda de 52 px y filtros
  desplegables también en escritorio. El ranking queda visible antes y los
  metadatos conservan su fecha y procedencia en un desplegable identificado.
- **Cartografía:** grupos blancos con contorno azul y grupos grandes azul marino,
  números mayores y halos más discretos. Opacidad máxima del calor de 0,50 en
  lugar de 0,80; conserva exactamente su escala, colores, cobertura y valores.
  Leyendas más legibles con explicaciones desplegables.
- **Comparador:** ancho máximo de 1440 px; edición y resultados en dos columnas
  desde 1200 px. Barras verticales en escritorio/tablet y horizontales en móvil,
  importes y diferencias visibles junto al editor. Cifras editables resaltadas,
  unidades agrupadas con su cifra y deslizador más reconocible. Sin tarjetas.
- **Estadísticas:** frase larga sustituida visualmente por depósito de referencia,
  importe medio, rango y fecha. Se conserva la frase completa para tecnologías
  de asistencia y la misma precisión del cálculo. Mapa provincial mayor, KPIs
  alineados y gráficos de 320 px, con tres marcas de eje y distribución en dos
  columnas en escritorio; apilados en móvil.
- **Global:** navegación con iconos y selección azul marino, superficies más
  claras y tipografía, controles y espaciado comunes. Transiciones de 160–200 ms
  en controles y resultados; se conserva movimiento reducido.

## Capturas

La carpeta local `.screenshots/deep-visual/` contiene:

- `comparativa.html`: selector de página, escritorio/móvil y captura completa o
  primera pantalla.
- `map-1440-comparativa.png`, `comparison-1440-comparativa.png` y
  `statistics-1440-comparativa.png`: pares antes/después en escritorio.
- Sus equivalentes `*-375-comparativa.png`: pares móviles.
- `before/`: capturas tomadas antes de modificar esta pasada, sobre la exportación
  anterior. `after/`: nueva exportación estática. Ambas, a 1000 px de alto.
- `after/e2e-report.json` y `after/performance.json`: evidencia de las pruebas.

Las comparativas son capturas reales, sin retocar las imágenes del producto.
Estos artefactos están ignorados por Git; no forman parte de la aplicación.

## Archivos modificados en esta pasada

- `src/app/globals.css`.
- `src/components/layout/site-header.tsx`.
- `src/components/map/fuel-map-app.tsx`, `station-map.tsx`,
  `station-color-legend.tsx` y `price-heatmap-legend.tsx`.
- `src/components/comparison/energy-calculator.tsx`.
- `src/components/statistics/statistics-dashboard.tsx`, `province-map.tsx`,
  `monthly-history-panel.tsx` y `price-history-panel.tsx`.
- `scripts/browser-smoke.mjs` y este documento.

Los datos, contratos, dominio, pipeline, workflows, dependencias, fuente y
geometrías permanecen como al inicio de esta pasada.

## Pruebas ejecutadas

- `npm run lint`, `npm run typecheck` y build estático: correctos.
- `npm test`: 415 pruebas en 29 archivos, todas correctas.
- `npm run test:browser` contra `out/`: tres páginas a 320, 375, 768, 1024 y
  1440 px, sin desbordamientos ni errores de consola/red. Comprueba filtros de
  escritorio con teclado, metadatos, clústeres, hover, selección, foco, calor,
  escala por combustible, comparador, provincias e histórico. Incluye valores
  máximos válidos del comparador en los cinco anchos.
- `node scripts/monthly-history-browser.mjs`: cinco tamaños, teclado, toque,
  tooltip, selectores y estados vacío, huecos, corrupto, error HTTP y ausencia.
- Prettier sobre `src` y `scripts`, y `git diff --check`: correctos.
- Detector de Impeccable: sin hallazgos mecánicos; revisión visual independiente
  antes/después y revisión de movimiento con los criterios de Emil Kowalski.
- Medición local a 375 × 844 px: CLS 0 en las tres rutas; LCP de 3248 ms en el
  mapa, 272 ms en el comparador y 280 ms en estadísticas. GPU por software,
  sin equivalencia con rendimiento de producción ni comparación controlada
  del rendimiento anterior.

## Pendientes

- **Media, validación:** confirmar rendimiento del mapa en teléfono físico,
  Safari y lector de pantalla real. Chromium se verificó con emulación táctil.
- **Baja, entorno:** el chequeo global de Prettier tiene el bloqueo de lectura
  previo en `data/processed/miteco`; se comprobó el código por separado. No se
  cambiaron permisos del equipo.
- Sin fallos funcionales reproducidos en las pruebas locales. Sin despliegue.
