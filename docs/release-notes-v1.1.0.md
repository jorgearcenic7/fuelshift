FuelShift 1.1.0 añade el histórico oficial de MITECO desde 2007 y un rediseño completo de la
web: <https://fuelshift.pages.dev>.

## Novedades

- **Histórico oficial mensual desde enero de 2007** en `/estadisticas`: gasolina 95 E5, 98 E5 y
  gasóleo A para España y los 52 ámbitos provinciales, con huecos explícitos y recuentos.
- **Actualización mensual incremental** integrada en el despliegue gratuito, que conserva la
  última copia válida si algo falla.
- **Rediseño** de mapa, comparador y estadísticas, con mapa provincial, nueva leyenda de
  estaciones y mejor experiencia en móvil.
- **Seguridad**: cabeceras reforzadas y auditoría documentada.

El histórico diario de FuelShift (desde el 19 de octubre de 2026) y el mensual de MITECO se
muestran por separado. Las medias las calcula FuelShift a partir de los precios oficiales.

La versión del código no indica la fecha de los datos: cada página muestra cuándo se
descargaron. Cambios completos en [CHANGELOG.md](../CHANGELOG.md).
