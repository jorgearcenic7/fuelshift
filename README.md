# FuelShift

**Web: <https://fuelshift.pages.dev>**

FuelShift es una aplicación web pública en construcción para consultar precios oficiales de
carburantes en España, comparar costes energéticos y explorar estadísticas. El repositorio
incluye una ingesta reproducible del conjunto nacional de estaciones terrestres de MITECO, un
mapa interactivo con esos datos reales, un comparador de costes energéticos y una página de
estadísticas de precios.

## Stack

- Next.js 16 con App Router y exportación estática, React 19 y TypeScript estricto.
- Tailwind CSS 4, MapLibre GL JS, Vitest, ESLint y Prettier para el frontend.
- Python 3.12, Pydantic, Pytest y Ruff para el pipeline de datos.
- GitHub Actions con controles reproducibles y servicios gratuitos.

No se usan bases de datos, autenticación ni APIs de pago. El mapa usa la instancia pública y
gratuita de OpenFreeMap, sin clave; no ofrece garantía de disponibilidad.

## Requisitos e instalación

En Windows se necesita Git, Node.js 24 con npm 11 y Python 3.12. Desde PowerShell, en la raíz
del repositorio:

```powershell
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.lock
```

Las dependencias JavaScript quedan fijadas en `package-lock.json` y las herramientas Python en
`requirements-dev.lock`.

## Ingesta oficial de MITECO

La ingesta realiza una única descarga del conjunto nacional desde el
[servicio REST oficial de MITECO](https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/EstacionesTerrestres/),
valida y normaliza el contenido, genera los archivos en un directorio provisional y sustituye
el conjunto local anterior solo si todos los controles terminan correctamente.

```powershell
$env:PYTHONPATH = "pipeline/src"
.\.venv\Scripts\python.exe -m fuelshift_data --output data/processed/miteco
```

La salida, ignorada por Git, contiene `manifest.json` y un JSON por identificador oficial de
provincia dentro de `provinces/`. El orden es determinista y el manifiesto incluye hashes,
procedencia, licencia, fechas separadas y métricas de calidad. El contrato completo está en
[`docs/static-data-contract.md`](docs/static-data-contract.md).

Por defecto, la ejecución falla si recibe menos de 10 000 estaciones, rechaza más del 2 % o el
número de estaciones válidas cae más de un 20 % respecto al último manifiesto. Los umbrales se
pueden ajustar mediante las opciones de la CLI. Un timeout, error HTTP, JSON inválido, respuesta
vacía o fallo de validación tampoco reemplaza el último conjunto válido.

Los precios se conservan como cadenas decimales exactas y los valores vacíos se omiten. La API
solo comunica una fecha global sin zona horaria explícita y no aporta una fecha individual por
precio. Tampoco declara unidades en el contrato REST verificado, por lo que el frontend no debe
inventarlas. Estas limitaciones y la evidencia observada están documentadas en
[`docs/data-contract.md`](docs/data-contract.md).

El catálogo oficial publica el conjunto bajo
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Toda
redistribución debe mantener la atribución a MITECO, enlazar la licencia e indicar las
transformaciones realizadas.

## Preparar y abrir el mapa

Después de ejecutar la ingesta, valida y prepara la copia estática que sirve Next.js:

```powershell
$env:PYTHONPATH = "pipeline/src"
.\.venv\Scripts\python.exe -m fuelshift_data --output data/processed/miteco
npm run data:prepare
npm run dev
```

Abre <http://localhost:3000>. `npm run data:prepare` valida de nuevo versión, rutas, tamaños,
hashes SHA-256, recuentos e identificadores antes de sustituir `public/data/miteco/`. Los datos
de origen y la copia web están ignorados por Git. Si no se han preparado datos, el build sigue
funcionando y la interfaz muestra un estado vacío explícito.

El navegador descarga el manifiesto y las provincias progresivamente con concurrencia limitada,
las conserva en memoria y delega el clustering visual en MapLibre. La geolocalización solo se
solicita al pulsar «Usar mi ubicación» y no se persiste.

La vista «Mapa de calor» reutiliza esas estaciones y no descarga nada más. Representa las mismas
estaciones que la lista: el combustible elegido y los filtros activos. En el navegador calcula una
superficie de precios con píxeles de 0,05° (unos 5 km): cada píxel es la media de los precios
cercanos ponderada con un núcleo gaussiano de σ = 8 km, con un alcance de 24 km. Al ser una media,
la densidad de estaciones no cambia el color, solo la opacidad. Donde no hay estaciones cerca, el
mapa queda transparente. MapLibre dibuja la superficie como imagen con interpolación lineal, así
que se ve como un degradado continuo. La escala va de verde a rojo pasando por amarillo, entre los
percentiles 5 y 95 de la superficie **nacional sin filtrar** de cada combustible. Por eso no cambia
al filtrar ni al mover el mapa, y un mismo precio conserva su color. La leyenda distingue esos
límites de los precios mínimo y máximo reales de las estaciones mostradas. Sin filtros activos se
reutiliza el cálculo nacional; con filtros solo se recalcula la superficie, no la escala. La rampa
usa los colores ya validados para daltonismo y la leyenda rotula los extremos con texto.

## Estadísticas

La página `/estadisticas` se calcula durante `npm run build`: el servidor lee la copia validada
de `public/data/miteco/` y el navegador recibe solo los agregados (unos 65 KB de HTML en lugar de
los 4 MB de estaciones). Muestra, para Gasolina 95 E5, Gasolina 98 E5 y Gasóleo A, la media
nacional calculada con todas las estaciones válidas, el mínimo y el máximo reales, la media por
provincia y su diferencia con la media nacional. Las provincias con menos de 10 estaciones se
marcan como muestra reducida y las que no tienen datos se muestran sin valor. Son estadísticas
calculadas por FuelShift, no publicadas por MITECO.

El build también publica la instantánea en `/data/estadisticas.json`, que
`scripts/price-history.mjs` convierte en un registro diario del histórico. El guardado automático
en la rama de datos `data/historico` está preparado pero desactivado hasta su activación
autorizada; la página descarga el histórico publicado en `/data/historico/` y, mientras no exista,
muestra «Todavía no hay histórico». Véase [docs/price-history.md](docs/price-history.md).

## Desarrollo y comprobaciones

```powershell
# Servidor local
npm run dev

# Frontend
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build

# Prueba manual en navegador (requiere la web en ejecución y Edge/Chrome local)
npm run test:browser

# Python (las pruebas usan fixtures y no acceden a la red)
.\.venv\Scripts\python.exe -m ruff format --check pipeline
.\.venv\Scripts\python.exe -m ruff check pipeline
.\.venv\Scripts\python.exe -m pytest
```

`npm run build` genera la exportación estática en `out/`. Ambos directorios generados están
ignorados por Git. El workflow manual `Verificación manual MITECO` permite comprobar la descarga
real y conservar el resultado durante un día como artefacto; no programa ingestas ni publica
datos persistentes.

`npm run test:coverage` mide `src/lib`, `src/domain` y `src/data`; los scripts de `scripts/` se
prueban ejecutándolos como procesos y quedan fuera de esa medición.

En Windows, Next.js 16.4 escribe las precargas de rutas anidadas como
`out/comparador/__next.comparador/__PAGE__.txt` en lugar de `__next.comparador.__PAGE__.txt`,
porque solo sustituye `/` y no `\`. Al servir ese `out/` local, el navegador registra un 404 de
precarga y la navegación sigue funcionando. Los builds de CI y de Cloudflare Pages se generan en
Linux y no tienen este problema.

## Estructura

```text
src/
  app/                 Rutas, layout y estilos globales de Next.js
  components/          Componentes visuales
  data/                Carga y validación de los JSON publicados
  domain/              Tipos y reglas de dominio del frontend, sin React ni E/S
  lib/                 Utilidades genéricas, sin dependencias de las demás capas
pipeline/
  src/fuelshift_data/
    download.py         Cliente HTTP limitado y con reintentos
    normalization.py    Adaptación del contrato oficial verificado
    models.py           Modelos normalizados validados
    validation.py       Controles de calidad y comparación histórica
    generation.py       JSON determinista y publicación transaccional
    pipeline.py         Orquestación de la ingesta
    cli.py              Interfaz de línea de comandos
  tests/                Pruebas aisladas de la red
docs/                   Contratos y decisiones técnicas
.github/workflows/      Integración continua y verificación manual
```

En `src/`, las dependencias solo avanzan en el sentido `app → components → data → domain`, y
cualquier capa puede usar `lib`. ESLint lo comprueba con `no-restricted-imports`
([`eslint.config.mjs`](eslint.config.mjs)); las pruebas quedan exentas.

El despliegue estático en Cloudflare Pages Free comprueba MITECO cada cuatro horas y también puede
ejecutarse manualmente. Solo publica cuando cambia el contenido normalizado de las estaciones; una
ejecución manual puede forzar la publicación de cambios de código sin omitir ninguna validación.
Una comprobación programada sin cambios no ejecuta el build ni Wrangler. La configuración, los
secretos, la protección del manifiesto anterior, la recuperación y los límites están documentados en
[`docs/deployment-cloudflare.md`](docs/deployment-cloudflare.md).
