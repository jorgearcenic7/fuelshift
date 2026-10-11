# Logotipos de marcas de carburantes

FuelShift muestra el logotipo de la marca comercial que figura en el rótulo de cada estación
publicada por MITECO. Los archivos se sirven desde `public/brands/`; la web no consulta ningún
servicio externo de logotipos. El reconocimiento de marcas y el registro de logotipos están en
`src/domain/brands.ts`.

## Criterios de incorporación

Un logotipo solo se incorpora si cumple todo lo siguiente:

1. Corresponde a la marca comercial escrita en el rótulo y a su identidad vigente. No se usa
   el logotipo del grupo empresarial (Campsa y Petronor no se muestran como Repsol) ni el de
   otra submarca (Carrefour Mobile, Esclat, bonÀrea Agrupa).
2. Procede de Wikimedia Commons con un régimen de derechos de autor verificable mediante su
   API (`extmetadata`) y con autoría o fuente declarada de la propia empresa.
3. No se acepta una licencia Creative Commons otorgada por un particular sobre el logotipo de
   una empresa ("obra propia"): quien la sube no es el titular y la licencia no es acreditable.
4. El SVG no contiene scripts, manejadores de eventos, `foreignObject` ni referencias externas.

Los archivos se descargan con su SHA-1 contrastado con el publicado por Commons. A los SVG solo
se les eliminan comentarios y metadatos; el dibujo no se altera. Los PNG muy grandes usan la
miniatura que genera Wikimedia a partir del mismo archivo.

**Derechos de marca.** El dominio público de Commons se refiere a los derechos de autor (son
logotipos tipográficos o simples, por debajo del umbral de originalidad). Las marcas siguen
perteneciendo a sus titulares. FuelShift las muestra únicamente para identificar la marca de
cada estación, sin sugerir patrocinio ni relación comercial. Esta documentación no constituye
asesoramiento jurídico: el propietario del proyecto debe validar este uso y retirar cualquier
logotipo si su titular lo solicita.

## Logotipos incorporados

Consultados el 11 de octubre de 2026. "DP" indica dominio público según Commons y "MR" que
Commons lo marca como marca registrada.

| Marca    | Archivo        | Archivo de origen en Commons                                                                                         | Autor y fuente declarados                           | Régimen | Notas                                                                    |
| -------- | -------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| Repsol   | `repsol.svg`   | [Repsol 2025 (Isotype).svg](<https://commons.wikimedia.org/wiki/File:Repsol_2025_(Isotype).svg>)                     | Repsol · derivado de «Repsol 2025.svg» (repsol.com) | DP · MR | Isotipo de la identidad vigente desde el 18-06-2025.                     |
| Moeve    | `moeve.svg`    | [Moeve logo.svg](https://commons.wikimedia.org/wiki/File:Moeve_logo.svg)                                             | Moeve · cepsa.com/es/compania/marca-cepsa           | DP · MR | Logotipo de 2024. Solo para rótulos «MOEVE».                             |
| Cepsa    | `cepsa.svg`    | [Cepsa.svg](https://commons.wikimedia.org/wiki/File:Cepsa.svg)                                                       | Cepsa · cepsa.com                                   | DP · MR | Logotipo de 2014. Solo para rótulos «CEPSA».                             |
| Galp     | `galp.svg`     | [Galp Logo 2024.svg](https://commons.wikimedia.org/wiki/File:Galp_Logo_2024.svg)                                     | Galp Energia · brandlogo.org                        | DP · MR | Fuente secundaria: conviene contrastarlo con material oficial de Galp.   |
| Plenergy | `plenergy.png` | [Plenergy.png](https://commons.wikimedia.org/wiki/File:Plenergy.png)                                                 | Plenergy · plenergy.es                              | DP · MR | Original de 418 × 84 px.                                                 |
| Petronor | `petronor.png` | [Petronor logo 2024.png](https://commons.wikimedia.org/wiki/File:Petronor_logo_2024.png)                             | Petronor · petronor.eus                             | DP · MR | Miniatura de 330 px generada por Wikimedia (original 9093 × 1445 px).    |
| AVIA     | `avia.svg`     | [AVIA International logo.svg](https://commons.wikimedia.org/wiki/File:AVIA_International_logo.svg)                   | AVIA International · avia.de                        | DP · MR |                                                                          |
| Q8       | `q8.svg`       | [Q8 logo.svg](https://commons.wikimedia.org/wiki/File:Q8_logo.svg)                                                   | Kuwait Petroleum International · q8.com             | DP · MR |                                                                          |
| Alcampo  | `alcampo.png`  | [Alcampo.png](https://commons.wikimedia.org/wiki/File:Alcampo.png)                                                   | Alcampo, S. A. · compraonline.alcampo.es            | DP      | Commons no lo marca como marca registrada, pero lo es. Miniatura 330 px. |
| Eni      | `eni.svg`      | [Eni wordmark.svg](https://commons.wikimedia.org/wiki/File:Eni_wordmark.svg)                                         | Eni SpA · eni.com                                   | DP · MR | Logotipo textual de 2023; no incluye el símbolo del perro de seis patas. |
| Eroski   | `eroski.svg`   | [Eroski logo.svg](https://commons.wikimedia.org/wiki/File:Eroski_logo.svg)                                           | EROSKI, S. Coop. · eroski.es                        | DP · MR |                                                                          |
| Meroil   | `meroil.png`   | [Logo Meroil.png](https://commons.wikimedia.org/wiki/File:Logo_Meroil.png)                                           | Meroil · meroil.es                                  | DP · MR | Original de 360 × 138 px.                                                |
| Naturgy  | `naturgy.svg`  | [Naturgy.svg](https://commons.wikimedia.org/wiki/File:Naturgy.svg)                                                   | Naturgy · gasnaturalfenosa.com                      | DP · MR |                                                                          |
| Costco   | `costco.svg`   | [Costco Wholesale logo 2010-10-26.svg](https://commons.wikimedia.org/wiki/File:Costco_Wholesale_logo_2010-10-26.svg) | Costco Wholesale                                    | DP · MR | Logotipo en uso desde 1997.                                              |

El color de acento de cada marca es el relleno cromático más frecuente del propio archivo. Las
marcas sin logotipo verificado usan un tono neutro.

## Cobertura

Calculada sobre el conjunto MITECO de 11 511 estaciones y 3552 rótulos distintos, con la misma
función de reconocimiento que usa la aplicación:

| Indicador                                   | Valor         |
| ------------------------------------------- | ------------- |
| Marcas comerciales reconocidas              | 42            |
| Marcas con logotipo auténtico incorporado   | 14            |
| Estaciones con logotipo auténtico           | 5512 (47,9 %) |
| Estaciones con marca reconocida (logo o no) | 8249 (71,7 %) |
| Estaciones con rótulos sin marca reconocida | 3262 (28,3 %) |
| Estaciones con rótulo «(SIN RÓTULO)»        | 12            |

Los rótulos que nombran dos marcas a la vez (por ejemplo «CEPSA-MOEVE» o «DISA_SHELL») no se
asignan a ninguna. Las marcas que también son palabras comunes (HAM, IDS, Nieves) solo se
reconocen al inicio del rótulo.

## Marcas reconocidas sin logotipo

| Marca                                                                                        | Estaciones | Motivo                                                                                       |
| -------------------------------------------------------------------------------------------- | ---------: | -------------------------------------------------------------------------------------------- |
| BP                                                                                           |        675 | El logotipo Helios no está en Commons con licencia libre; su uso requiere autorización.      |
| Ballenoil                                                                                    |        419 | Único archivo subido por un particular como obra propia (CC BY-SA): licencia no acreditable. |
| Shell                                                                                        |        393 | El logotipo vigente no está disponible con licencia libre; su uso requiere autorización.     |
| Petroprix                                                                                    |        189 | Único archivo subido por un particular como obra propia (CC BY-SA): licencia no acreditable. |
| Carrefour                                                                                    |        146 | Solo se encontró «Carrefour Mobile», otra submarca. El logotipo principal no está libre.     |
| DISA                                                                                         |        137 | Sin resultados: las coincidencias corresponden a otras entidades.                            |
| Esclatoil                                                                                    |         73 | Solo existe el logotipo del supermercado Esclat, que no es la marca de las estaciones.       |
| bonÀrea                                                                                      |         69 | Solo existe el logotipo de bonÀrea Agrupa; no se ha verificado la correspondencia.           |
| Campsa                                                                                       |         68 | Sin resultados en Commons.                                                                   |
| Agla                                                                                         |         68 | Único archivo subido por un particular como obra propia (CC BY-SA): licencia no acreditable. |
| Tamoil                                                                                       |         30 | Archivo de Deutsche Tamoil sin autor ni fuente verificables.                                 |
| E.Leclerc                                                                                    |         14 | La fuente declarada del archivo es un blog, no la marca.                                     |
| Valcarce, Gasexpress, HAM, Beroil, Petrocat, GM Oil, Molgas                                  |      54–27 | Sin resultados en Commons.                                                                   |
| IDS, Nieves, Autonetoil, Iberdoex, Easygas, ASC Carburantes, Agropal, Family Energy, Staroil |      23–12 | Pendientes de búsqueda.                                                                      |

Para BP, Shell y Carrefour, el camino adecuado es solicitar a cada titular sus recursos de
marca y la autorización de uso.

## Añadir un logotipo

1. Verificar procedencia, régimen de derechos y correspondencia con los criterios anteriores.
2. Guardar el archivo en `public/brands/<clave>.svg|png` sin modificar el dibujo.
3. Registrar `logo` y `color` en `src/domain/brands.ts`.
4. Añadir la fila correspondiente a este documento.

Las pruebas de `src/domain/brands.test.ts` fallan si un logotipo registrado no existe, si hay
archivos en `public/brands/` sin registrar o si un archivo no figura en este documento.
