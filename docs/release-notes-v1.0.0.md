FuelShift 1.0.0 es la primera versión pública estable: una web gratuita para consultar los
precios oficiales de los carburantes en España.

**Web:** https://fuelshift.pages.dev

## Qué incluye

- **Mapa de gasolineras** con los precios que las estaciones comunican al Ministerio (MITECO):
  búsqueda, filtros por combustible, marca y precio, orden por precio o distancia, ranking de las
  más baratas, mapa de calor y ficha de cada estación con horario y cómo llegar.
- **Comparador** del gasto energético de un coche de gasolina, diésel o eléctrico. Calcula solo
  el coste de la energía, no el coste total de propiedad.
- **Estadísticas** nacionales y por provincia, con histórico diario real desde el 19 de octubre
  de 2026.
- Diseño adaptado a móvil, navegable con teclado y revisado con axe-core.
- Vigilancia horaria de la web publicada con alertas automáticas.

## Datos

- Fuente: servicio REST oficial de MITECO, con licencia CC BY 4.0. Las estadísticas las calcula
  FuelShift y no son oficiales.
- La comprobación se programa cada 4 horas; por los retrasos de GitHub Actions, en la práctica los
  datos se renuevan cada 6 h de mediana (máximo observado: 11,6 h).
- Precios en euros por litro o por kilogramo según cada producto, conforme a los anexos vigentes
  de la Orden ITC/2308/2007 (Resolución de 5 de diciembre de 2025).
- MITECO publica una fecha global para todo el conjunto, no una por estación o precio.

## Limitaciones conocidas

- El mapa base usa la instancia pública de OpenFreeMap, sin garantía de disponibilidad.
- Si la ingesta falla, la web sigue mostrando el último conjunto válido y avisa cuando los datos
  tienen más de 48 horas.

La versión del código (1.0.0) no indica la fecha de los datos: cada página muestra cuándo se
descargaron. Cambios completos en [CHANGELOG.md](https://github.com/jorgearcenic7/fuelshift/blob/main/CHANGELOG.md).
