# 0004. MapLibre GL JS con la instancia pública de OpenFreeMap

Estado: Aceptada.

## Contexto

El mapa es la vista principal. Debe funcionar sin claves de API ni cuentas de pago, y mostrar
miles de estaciones con agrupación y un mapa de calor.

## Decisión

- La biblioteca es MapLibre GL JS (`maplibre-gl`), de código abierto, que se encarga del
  clustering y del dibujo en el navegador.
- El estilo base es `https://tiles.openfreemap.org/styles/positron`, de la instancia pública y
  gratuita de OpenFreeMap, que no requiere clave.
- La integración con MapLibre está en `src/components/map/`. Las reglas del mapa de calor
  (superficie de precios, percentiles, leyenda) están en `src/domain/price-heatmap.ts` y no
  dependen de MapLibre.

## Alternativas descartadas

- **Proveedores comerciales de teselas con clave**: implican cuenta, una clave expuesta en el
  navegador y posibles costes por uso.

## Consecuencias

- OpenFreeMap no ofrece garantía de disponibilidad, como ya advierte el `README.md`. Si cae, el
  fondo del mapa no carga, pero los datos de estaciones siguen siendo válidos.
- Las fuentes tipográficas de las etiquetas deben ser las que sirve OpenFreeMap; la
  predeterminada de MapLibre no existe allí.
- Cambiar de proveedor de teselas afecta sobre todo a `MAP_STYLE` y a las capas de
  `src/components/map/`. Cambiar de biblioteca obliga a rehacer esos componentes, pero no el
  dominio.

## Revisar si

- La disponibilidad de OpenFreeMap resulta insuficiente o cambian sus condiciones de uso.
