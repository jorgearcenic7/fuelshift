# 0002. Sin base de datos ni backend: JSON estáticos validados

Estado: Aceptada.

## Contexto

El conjunto nacional de MITECO tiene unas 11.500 estaciones y ocupa unos 12 MB en origen
([`docs/data-contract.md`](../data-contract.md)). Se reemplaza entero en cada ingesta; la web solo
lo lee. No hay escrituras de usuarios ni consultas que no puedan resolverse en el navegador.

## Decisión

- El pipeline publica un `manifest.json` y un archivo JSON por provincia, con versión, recuentos y
  SHA-256 ([0003](0003-contrato-json-publicado.md)).
- La web descarga el manifiesto y las provincias con concurrencia limitada, los valida y los
  conserva en memoria. Filtros, búsqueda, ordenación, mapa de calor y estadísticas se calculan en
  el cliente o durante el build.
- La publicación es transaccional: si una ingesta falla, se conserva el último conjunto válido.

## Alternativas descartadas

- **Base de datos gestionada (SQL o clave-valor)**: añade una cuenta, credenciales y un servicio
  en ejecución para datos que se sustituyen completos y solo se leen.
- **Un único JSON nacional**: obliga a descargar todo antes de mostrar nada. Por provincias, el
  mapa se rellena a medida que llegan.

## Consecuencias

- No hay secretos de base de datos ni esquema que migrar; el formato publicado es el contrato.
- El volumen debe seguir siendo manejable en el navegador. Si crece mucho, el primer paso es
  revisar el formato publicado, antes de plantear un servidor.
- Las consultas históricas largas no se resuelven con SQL: se publican series precalculadas
  ([0005](0005-almacen-del-historico.md)).

## Revisar si

- Aparecen datos escritos por usuarios, consultas que no se pueden precalcular o un volumen que
  el navegador no pueda cargar con fluidez.
