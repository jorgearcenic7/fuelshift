# Contrato verificado de MITECO

## Fuente oficial

La ingesta usa una única petición al conjunto nacional de instalaciones terrestres:

- Endpoint: <https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/EstacionesTerrestres/>
- Ayuda del servicio: <https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/help>
- Catálogo: <https://catalogo.datosabiertos.miteco.gob.es/catalogo/es/dataset/902a266d-5ba2-4735-a378-45818ba5a4f4>

El contrato se verificó el 11 de octubre de 2026 contra la documentación y una respuesta real,
no solo contra el ejemplo de ayuda. La descarga observada respondió `HTTP 200`,
`Content-Type: application/json; charset=utf-8`, ocupó 12.242.740 bytes y contenía 11.515
estaciones.

## Envoltura JSON real

La raíz contiene exactamente:

| Campo               | Tipo observado               | Significado                                                                             |
| ------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `Fecha`             | cadena `DD/MM/YYYY HH:MM:SS` | Fecha comunicada por el servicio para la instantánea. No incluye zona horaria.          |
| `ListaEESSPrecio`   | lista de objetos             | Conjunto nacional de estaciones.                                                        |
| `Nota`              | cadena                       | Indica que la instantánea contiene los precios en vigor y se actualiza cada media hora. |
| `ResultadoConsulta` | cadena                       | `OK` en una respuesta utilizable. Cualquier otro valor hace fallar la ingesta.          |

En la observación real, `Fecha` fue `11/10/2026 16:43:50`; el encabezado HTTP `Date` fue
`11 Oct 2026 14:43:50 GMT`. La coincidencia con el horario civil peninsular indica que `Fecha`
describe la generación o consulta de la instantánea, no el instante en que cada titular comunicó
cada precio. La documentación no declara la zona horaria, por lo que el manifiesto conserva el
valor original y una versión ISO local **sin inventar un desplazamiento UTC**.

Cada registro contiene 41 campos y, en la respuesta observada, todos sus valores son cadenas.
Entre ellos están `IDEESS`, `IDProvincia`, `IDMunicipio`, `IDCCAA`, `Latitud`,
`Longitud (WGS84)`, `Provincia`, `Municipio`, `Localidad`, `C.P.`, `Dirección`, `Rótulo`,
`Horario`, `Remisión`, `Tipo Venta`, `Margen`, porcentajes de biocombustible y 23 campos de
precio.

## Diferencias entre documentación y respuesta

El ejemplo JSON de la ayuda reutiliza nombres serializados para XML, como
`Longitud_x0020__x0028_WGS84_x0029_`. La respuesta JSON real usa nombres legibles con espacios
y acentos, como `Longitud (WGS84)`, `Dirección`, `Rótulo` y `Precio Diésel Renovable`. El
pipeline usa los nombres reales y falla si aparece un campo `Precio ...` desconocido para evitar
perder productos nuevos en silencio.

La respuesta es UTF-8 válida. En la descarga verificada, nombres de campos y datos de estaciones
se decodificaron correctamente, pero el texto de `Nota` contenía la palabra `actualización`
doblemente codificada. Ese texto informativo no se propaga a los artefactos.

## Decimales, identificadores y ausencias

- Precios y coordenadas llegan como cadenas con coma decimal, por ejemplo `1,799` y
  `39,211417`. Se convierten primero a `Decimal`; no se interpretan mediante `float` durante la
  validación.
- `IDEESS` es el identificador estable de estación. En la descarga real los 11.515 valores eran
  no vacíos y únicos.
- `IDProvincia` es una cadena de dos dígitos (`01` a `52`), por lo que se conservan ceros
  iniciales. `IDMunicipio` también se conserva como cadena.
- Un precio ausente es `""`. Se omite del diccionario `fuels`; nunca se convierte a cero.
- Un precio no vacío que no sea decimal positivo invalida la estación completa.
- La API no publica una fecha por producto. El modelo `FuelPrice` no tiene `observed_at` y
  `Remisión` se conserva únicamente como evidencia del contrato: los valores observados `dm` y
  `OM` no son fechas.

## Unidades de los precios

La ayuda y el payload del servicio REST enumeran variables de precio, pero no declaran su unidad.
La unidad se acredita por la norma de la que proceden los datos. Fuentes oficiales consultadas el
21 de octubre de 2026:

1. La ficha del conjunto en el
   [catálogo de datos abiertos de MITECO](https://catalogo.datosabiertos.miteco.gob.es/catalogo/es/dataset/902a266d-5ba2-4735-a378-45818ba5a4f4)
   («Instalaciones de suministro de combustibles a vehículos y embarcaciones con venta pública»)
   indica: «Datos obtenidos a partir de las informacion remitida por los sujetos titulares en
   virtud de la Orden ITC/2308/2007».
2. La [Resolución de 5 de diciembre de 2025](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-25592)
   (BOE-A-2025-25592, en vigor desde el 16 de diciembre de 2025) publica los anexos modificados
   de esa orden, que sustituyen a los de la Resolución de 10 de marzo de 2020. Desde entonces
   «solo será posible comunicar la información con los nuevos formatos».
3. Los [anexos vigentes publicados por MITECO](https://www.miteco.gob.es/content/dam/miteco/es/energia/files-1/risp/normativa/Documents/Anexos%20Orden%20ITC23082007%20modificados%20por%20Resolucion%205%20diciembre%202025.pdf)
   dicen en el anexo I, apartado I.1.1 (precios de las instalaciones de suministro):
   «Todos los precios se darán en: euros por litro G95E5, G95E5+, G95E10, G95E25, G95E85, BIE,
   G98E5, G98E10, GOA, GOA+, GOB, GOC, BIO, GLP, ADB, DREN y GREN» y en euros por kilogramo
   «PVPGNC, PVPGNL, PVPH2, PVPMET, PVPAMO, PVPBGNC y PVPBGNL». También precisan: «Se entenderá
   por precio de venta al público el precio aplicado en surtidor sin descuentos».

Cada producto del servicio REST corresponde a un campo del apartado I.1.1
([`src/domain/fuel-units.ts`](../src/domain/fuel-units.ts)):

| Producto en FuelShift       | Campo REST                           | Campo del anexo | Unidad | Correspondencia                                                |
| --------------------------- | ------------------------------------ | --------------- | ------ | -------------------------------------------------------------- |
| Gasolina 95 E5              | `Precio Gasolina 95 E5`              | `PVPG95E5`      | €/L    | Mismo producto («gasolina 95E5»)                               |
| Gasolina 95 E10             | `Precio Gasolina 95 E10`             | `PVPG95E10`     | €/L    | Mismo producto                                                 |
| Gasolina 95 E25             | `Precio Gasolina 95 E25`             | `PVPG95E25`     | €/L    | Mismo producto                                                 |
| Gasolina 95 E85             | `Precio Gasolina 95 E85`             | `PVPG95E85`     | €/L    | Mismo producto                                                 |
| Gasolina 95 E5 premium      | `Precio Gasolina 95 E5 Premium`      | `PVPG95E5+`     | €/L    | Única variante de la 95E5: «de características mejoradas»      |
| Gasolina 98 E5              | `Precio Gasolina 98 E5`              | `PVPG98E5`      | €/L    | Mismo producto                                                 |
| Gasolina 98 E10             | `Precio Gasolina 98 E10`             | `PVPG98E10`     | €/L    | Mismo producto                                                 |
| Gasolina renovable          | `Precio Gasolina Renovable`          | `PVPGREN`       | €/L    | Mismo producto                                                 |
| Bioetanol                   | `Precio Bioetanol`                   | `PVPBIOE` (BIE) | €/L    | Mezclas de gasolina con bioetanol o bioetanol puro             |
| Gasóleo A                   | `Precio Gasoleo A`                   | `PVPGOA`        | €/L    | El anexo habla de «gasóleo de automoción (gasóleo A)»          |
| Gasóleo premium             | `Precio Gasoleo Premium`             | `PVPGOA+`       | €/L    | El gasóleo A «que cuente con una aditivación de mayor calidad» |
| Gasóleo B                   | `Precio Gasoleo B`                   | `PVPGOB`        | €/L    | Mismo producto                                                 |
| Diésel renovable            | `Precio Diésel Renovable`            | `PVPDREN`       | €/L    | Mismo producto                                                 |
| Biodiésel                   | `Precio Biodiesel`                   | `PVPBIOD` (BIO) | €/L    | Mezclas de gasóleo con éster metílico o éster metílico puro    |
| Gases licuados del petróleo | `Precio Gases licuados del petróleo` | `PVPGLP`        | €/L    | Mismo producto                                                 |
| AdBlue                      | `Precio Adblue`                      | `PVPADB`        | €/L    | «AUS 32 (AdBlue)»                                              |
| Gas natural comprimido      | `Precio Gas Natural Comprimido`      | `PVPGNC`        | €/kg   | Mismo producto                                                 |
| Gas natural licuado         | `Precio Gas Natural Licuado`         | `PVPGNL`        | €/kg   | Mismo producto                                                 |
| Biogás natural comprimido   | `Precio Biogas Natural Comprimido`   | `PVPBGNC`       | €/kg   | Mismo producto                                                 |
| Biogás natural licuado      | `Precio Biogas Natural Licuado`      | `PVPBGNL`       | €/kg   | Mismo producto                                                 |
| Hidrógeno                   | `Precio Hidrogeno`                   | `PVPH2`         | €/kg   | Mismo producto                                                 |
| Metanol                     | `Precio Metanol`                     | `PVPMET`        | €/kg   | Mismo producto                                                 |
| Amoniaco                    | `Precio Amoniaco`                    | `PVPAMO`        | €/kg   | Mismo producto                                                 |

Las dos variantes premium no coinciden por nombre: el anexo las llama «de características
mejoradas». Son los únicos campos de la gasolina 95 E5 y del gasóleo A distintos del producto
habitual y, en cualquier caso, todas las gasolinas y gasóleos se dan en euros por litro. El anexo
remite además al [Real Decreto 61/2006](https://www.boe.es/buscar/act.php?id=BOE-A-2006-2779)
para definir gasolina, gasóleo de automoción, biodiésel, bioetanol, GLP y gasóleo B; su artículo
3.1 denomina al primero «Gasóleos de automoción (clase A)».

Los artefactos publicados no incluyen la unidad: el esquema `1.0.0` no cambia y la unidad se
aplica al presentar los datos.

## Coordenadas y calidad observada

Los campos son `Latitud` y `Longitud (WGS84)` en ese orden. El pipeline no los intercambia
automáticamente. Se admite el rectángulo operativo `latitud 27,5..44,0` y
`longitud -18,5..4,5`, que cubre España peninsular, Baleares, Canarias, Ceuta y Melilla con un
margen pequeño respecto a la extensión publicada en el catálogo.

La descarga real contenía cuatro registros fuera de ese ámbito:

- tres estaciones con coordenadas `0,000000 / 0,000000`;
- una estación con `Latitud=-8,659472` y `Longitud=42,037472`, compatible con un intercambio
  en origen, pero rechazada en vez de corregida sin evidencia adicional.

Resultado observado: 11.515 recibidas, 11.511 aceptadas y 4 rechazadas
(`coordinates_outside_supported_extent`). No había precios no numéricos, precios no positivos,
identificadores duplicados ni estaciones sin algún precio.

## Umbrales iniciales

Los valores por defecto son configurables desde la CLI:

- mínimo absoluto: 10.000 estaciones válidas;
- máximo de registros rechazados: 2 %;
- descenso máximo frente al último manifiesto válido: 20 %.

El mínimo queda aproximadamente un 13 % por debajo de las 11.511 estaciones válidas observadas.
El umbral relativo permite cambios legítimos graduales, pero bloquea una desaparición nacional
masiva. Deben revisarse con histórico real antes de automatizar una frecuencia periódica.

Un JSON inválido, `ResultadoConsulta` distinto de `OK`, conjunto vacío, producto desconocido,
`IDEESS` duplicado o incumplimiento de umbrales termina con error. La salida se genera en un
directorio provisional, se vuelve a leer y se verifican recuentos y hashes antes de sustituir el
directorio publicado. Un fallo previo o durante el reemplazo conserva o restaura el último
conjunto válido.

## Reutilización y atribución

El catálogo clasifica el conjunto como público, sin limitaciones de acceso, y lo licencia como
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). CC BY 4.0
exige crédito apropiado, enlace a la licencia e indicación de cambios, y prohíbe imponer
restricciones adicionales.

Los manifiestos incluyen la atribución a **Ministerio para la Transición Ecológica y el Reto
Demográfico (MITECO)**, el enlace al catálogo, el endpoint y la licencia. FuelShift normaliza,
filtra registros no publicables y divide el conjunto por provincias; esas transformaciones deben
indicarse cuando los datos se publiquen al usuario.

El contrato de los artefactos resultantes se documenta en
[`docs/static-data-contract.md`](static-data-contract.md).
