# FuelShift

FuelShift es una aplicación web pública en construcción para consultar precios oficiales de
carburantes en España, comparar costes energéticos y explorar estadísticas. El repositorio ya
incluye una ingesta reproducible del conjunto nacional de estaciones terrestres de MITECO; el
mapa, el comparador y las estadísticas todavía no están implementados.

## Stack

- Next.js 16 con App Router y exportación estática, React 19 y TypeScript estricto.
- Tailwind CSS 4, Vitest, ESLint y Prettier para el frontend.
- Python 3.12, Pydantic, Pytest y Ruff para el pipeline de datos.
- GitHub Actions con controles reproducibles y servicios gratuitos.

No se usan bases de datos, autenticación, proveedores de mapas ni APIs de pago en esta fase.

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

# Python (las pruebas usan fixtures y no acceden a la red)
.\.venv\Scripts\python.exe -m ruff format --check pipeline
.\.venv\Scripts\python.exe -m ruff check pipeline
.\.venv\Scripts\python.exe -m pytest
```

`npm run build` genera la exportación estática en `out/`. Ambos directorios generados están
ignorados por Git. El workflow manual `Verificación manual MITECO` permite comprobar la descarga
real y conservar el resultado durante un día como artefacto; no programa ingestas ni publica
datos persistentes.

## Estructura

```text
src/
  app/                 Rutas, layout y estilos globales de Next.js
  components/          Componentes visuales
  data/                Acceso futuro a artefactos estáticos
  domain/              Tipos y reglas de dominio del frontend
  lib/                 Utilidades compartidas
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

El mecanismo gratuito para publicar y conservar datos entre ejecuciones todavía debe decidirse
y probarse antes de activar una programación periódica o un despliegue automático.
