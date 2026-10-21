# 0003. Contrato JSON versionado entre el pipeline y la web

Estado: Aceptada.

## Contexto

El pipeline (Python) y la web (TypeScript) se despliegan juntos, pero se escriben y prueban por
separado. La frontera entre ambos son los archivos JSON publicados. Un cambio de formato no
coordinado haría que la web rechazara los datos, o, peor, que los interpretara mal.

## Decisión

- Todos los archivos publicados declaran `schema_version` (hoy `1.0.0`) y los lectores rechazan
  una versión que no conocen.
- Los precios se serializan como cadenas decimales (`"1.799"`) para conservar exactamente el
  `Decimal` de la fuente. Una clave ausente significa «sin dato», nunca cero.
- La fecha de MITECO se publica tal cual y sin zona horaria (`timezone: null`), porque la API no
  la declara.
- El manifiesto lista cada archivo provincial con su recuento, tamaño y SHA-256. El pipeline y
  `npm run data:prepare` los comprueban antes de publicar.
- La salida es determinista: claves ordenadas, separadores compactos y orden estable de
  provincias y estaciones.

Formato completo: [`docs/static-data-contract.md`](../static-data-contract.md).

## Alternativas descartadas

- **Precios como números JSON**: el redondeo binario podría alterar el valor oficial.
- **Asignar a la fecha la zona de Madrid**: sería atribuir a la fuente un dato que no publica.

## Consecuencias

- Cambiar el formato exige modificar a la vez el productor, el consumidor y la documentación, y
  subir `schema_version` si el cambio no es compatible.
- La validación existe en los dos lados. Mientras su forma se defina por separado en cada
  lenguaje, pueden divergir; por eso conviene una definición común comprobada por las pruebas de
  ambos.

## Revisar si

- Se añade una segunda fuente con otra forma de datos o un segundo consumidor del formato.
