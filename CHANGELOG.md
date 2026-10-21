# Registro de cambios

Todos los cambios relevantes de FuelShift. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen
[Versionado Semántico](https://semver.org/lang/es/). El procedimiento de publicación está en
[`docs/release.md`](docs/release.md).

## [Sin publicar] — candidata a 1.0.0

Primera versión pública estable. Reúne todo lo fusionado en `main` desde el 11 de octubre de
2026 y las correcciones de preparación de la versión.

### Añadido

- Ingesta reproducible del conjunto nacional de estaciones terrestres de MITECO, con validación,
  controles de calidad y publicación transaccional que conserva el último conjunto válido (#3).
- Mapa de gasolineras con datos reales, búsqueda, filtros por combustible, marca y precio,
  ordenación por precio o distancia y geolocalización opcional (#4).
- Ranking por precio en la zona visible o en todos los resultados, y ficha de estación con
  todos los precios comunicados (#5).
- Logotipos verificados de las marcas de carburantes (#6).
- Despliegue estático en Cloudflare Pages Free con comprobación de MITECO cada cuatro horas (#7,
  #8).
- Comparador de gasto energético de gasolina, diésel y eléctrico, con enlace desde la ficha de
  una estación (#9).
- Mapa de calor continuo de precios con escala nacional estable por combustible (#11, #12).
- Página de estadísticas: medias nacional y provincial, mínimos, máximos y provincias más barata
  y más cara (#13).
- Histórico diario automático en la rama de datos `data/historico`, activo desde el 19 de
  octubre de 2026 (#16).
- Contrato de datos en JSON Schema compartido por el pipeline y la web (#20).
- Comprobación con ESLint de las fronteras entre capas de `src/` (#21).
- Registro de decisiones de arquitectura en `docs/decisions/` (#22).
- Pendiente de fusión: página 404 en español, metadatos Open Graph y X, URL canónicas, imagen
  para compartir, `sitemap.xml` y `robots.txt`.
- Pendiente de fusión: cabeceras de seguridad en `public/_headers` (CSP, `X-Frame-Options`,
  `Permissions-Policy` y otras).

### Cambiado

- Experiencia móvil: el mapa aparece tras la búsqueda y el combustible, los filtros avanzados se
  pliegan y el orden del teclado coincide con el visual (#24).
- Pendiente de fusión: los precios muestran su unidad (€/L o €/kg) según los anexos vigentes de
  la Orden ITC/2308/2007 (Resolución de 5 de diciembre de 2025), en el mapa, las fichas y las
  estadísticas.

### Corregido

- Validación de datos y cobertura de pruebas (#10).
- Estabilidad de las pruebas de hidratación y renderizado del mapa (#15).
- Una localidad vacía en los datos de MITECO ya no impide cargar su provincia (#20).
- En escritorio, la página ya no muestra una barra de desplazamiento fantasma (#24).
- Pendiente de fusión: contraste insuficiente de los textos verdes y rojos, y el foco del
  teclado acompaña a la ficha al elegir una estación de la lista en pantallas estrechas.

[Sin publicar]: https://github.com/jorgearcenic7/fuelshift/commits/main
