# Contrato JSON estático de FuelShift

## Alcance y ubicación

La versión inicial del esquema es `1.0.0`. La forma exacta de cada archivo está en los JSON
Schema de [`contracts/`](../contracts/README.md), que comprueban las pruebas del pipeline y de la
web. La CLI publica por defecto en
`data/processed/miteco/`, ruta ignorada por Git:

```text
data/processed/miteco/
  manifest.json
  provinces/
    01.json
    02.json
    ...
    52.json
```

Los JSON usan UTF-8, una línea final, claves ordenadas y separadores compactos. Las provincias
se ordenan por `IDProvincia` y las estaciones por el valor numérico de `IDEESS`, lo que hace
determinista la salida para una misma entrada y metadatos.

## `manifest.json`

| Campo                         | Tipo                | Descripción                                                                       |
| ----------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| `schema_version`              | cadena              | Versión semántica del contrato.                                                   |
| `retrieved_at`                | fecha RFC 3339 UTC  | Instante medido por el cliente al completar la descarga.                          |
| `source`                      | objeto              | Endpoint, documentación, catálogo, atribución y licencia.                         |
| `source.reported_at.raw`      | cadena              | `Fecha` exacta comunicada por MITECO.                                             |
| `source.reported_at.local`    | cadena ISO sin zona | Fecha parseada sin atribuirle una zona no documentada.                            |
| `source.reported_at.timezone` | `null`              | Recuerda explícitamente que la API no informa la zona.                            |
| `station_count`               | entero              | Estaciones válidas publicadas.                                                    |
| `province_count`              | entero              | Archivos provinciales publicados.                                                 |
| `provinces`                   | lista               | Identificador, nombre, ruta, estaciones, bytes y SHA-256 de cada archivo.         |
| `quality`                     | objeto              | Recibidas, aceptadas, rechazadas, razones y comparación con el conjunto anterior. |

La fecha global no se copia a cada precio porque la fuente no proporciona una observación
individual por producto.

## Archivos provinciales

Cada archivo contiene:

- `schema_version`;
- `province` con `id` oficial y `name` de la fuente;
- `stations`, una lista de objetos con:
  - `id`: `IDEESS`;
  - `municipality_id`: `IDMunicipio`;
  - `municipality`, `postal_code` y `address`;
  - `locality`, `brand` y `opening_hours`, anulables si la cadena oficial está vacía;
  - `location.latitude` y `location.longitude`, números WGS84;
  - `fuels`, objeto `código: precio` solo para productos presentes.

Los precios se serializan como cadenas decimales con punto (`"1.799"`) para preservar con
exactitud el `Decimal` original. Una clave ausente significa “sin dato”; no equivale a cero. La
unidad no forma parte del esquema: la web la aplica al mostrar cada producto según la tabla de
[`data-contract.md`](data-contract.md#unidades-de-los-precios).

## Códigos de combustible

| Código FuelShift            | Campo MITECO                         |
| --------------------------- | ------------------------------------ |
| `adblue`                    | `Precio Adblue`                      |
| `ammonia`                   | `Precio Amoniaco`                    |
| `biodiesel`                 | `Precio Biodiesel`                   |
| `bioethanol`                | `Precio Bioetanol`                   |
| `compressed_natural_biogas` | `Precio Biogas Natural Comprimido`   |
| `liquefied_natural_biogas`  | `Precio Biogas Natural Licuado`      |
| `renewable_diesel`          | `Precio Diésel Renovable`            |
| `compressed_natural_gas`    | `Precio Gas Natural Comprimido`      |
| `liquefied_natural_gas`     | `Precio Gas Natural Licuado`         |
| `liquefied_petroleum_gas`   | `Precio Gases licuados del petróleo` |
| `diesel_a`                  | `Precio Gasoleo A`                   |
| `diesel_b`                  | `Precio Gasoleo B`                   |
| `premium_diesel`            | `Precio Gasoleo Premium`             |
| `gasoline_95_e10`           | `Precio Gasolina 95 E10`             |
| `gasoline_95_e25`           | `Precio Gasolina 95 E25`             |
| `gasoline_95_e5`            | `Precio Gasolina 95 E5`              |
| `premium_gasoline_95_e5`    | `Precio Gasolina 95 E5 Premium`      |
| `gasoline_95_e85`           | `Precio Gasolina 95 E85`             |
| `gasoline_98_e10`           | `Precio Gasolina 98 E10`             |
| `gasoline_98_e5`            | `Precio Gasolina 98 E5`              |
| `renewable_gasoline`        | `Precio Gasolina Renovable`          |
| `hydrogen`                  | `Precio Hidrogeno`                   |
| `methanol`                  | `Precio Metanol`                     |

No se agrupan gasolinas, gasóleos, gases o productos renovables que MITECO publica por separado.

## Publicación segura

La generación escribe primero un directorio temporal hermano. Antes de publicar, vuelve a leer
todos los JSON y comprueba versión, hashes, recuentos e identificadores únicos. Solo entonces
renombra el conjunto anterior a copia de seguridad y coloca el nuevo; si el segundo renombrado
falla, restaura la copia. Los archivos generados y las copias temporales no se versionan.

## Copia estática para el mapa

El frontend no lee directamente el directorio de trabajo del pipeline. El comando
`npm run data:prepare` vuelve a comprobar la versión del contrato, las rutas relativas, los
recuentos, los identificadores únicos, el tamaño y el SHA-256 de cada provincia antes de copiar
atómicamente el conjunto a `public/data/miteco/`. Tanto el origen como el destino están
ignorados por Git.

La aplicación solicita primero `manifest.json` y después los archivos indicados por su campo
`file`, con concurrencia limitada y caché en memoria. No se añade un índice ni se altera el
esquema `1.0.0`; MapLibre realiza el clustering en el navegador sobre las provincias que van
quedando disponibles.
