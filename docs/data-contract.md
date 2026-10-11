# Contrato de datos oficial pendiente

## Alcance verificado en esta fase

El catálogo de Datos Abiertos de MITECO describe para las instalaciones de suministro, entre
otras, las variables provincia, municipio, localidad, código postal, dirección, longitud,
latitud, toma de datos, rótulo, horario y precios vigentes por producto. Los modelos
normalizados de `pipeline/src/fuelshift_data/models.py` se limitan a ese subconjunto.

Fuente consultada el 11 de octubre de 2026:

- [Instalaciones de suministro con venta pública](https://catalogo.datosabiertos.miteco.gob.es/catalogo/es/dataset/902a266d-5ba2-4735-a378-45818ba5a4f4)
- [Precio de carburantes en las gasolineras españolas](https://catalogo.datosabiertos.miteco.gob.es/catalogo/dataset/214e0895-b3aa-4662-8ebe-18134c21fb45)

## Trabajo necesario en la siguiente PR

Antes de implementar la ingesta se debe verificar y documentar el contrato bruto vigente del
servicio REST: URL canónica, nombres y tipos exactos, codificación decimal y temporal, valores
ausentes, identificadores estables, unidades de cada producto, paginación y comportamiento de
errores. Hasta entonces no se fija ningún endpoint ni se transforma una respuesta supuesta.

La siguiente PR también deberá definir el esquema del artefacto estático, registrar origen y
antigüedad y conservar el último conjunto válido si una actualización falla.
