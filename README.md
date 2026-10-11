# FuelShift

FuelShift es un proyecto de aplicación web pública para consultar precios oficiales de
carburantes en España, comparar costes energéticos y explorar estadísticas. Esta rama contiene
su base técnica; aún no publica estaciones, precios, mapas, comparadores ni estadísticas.

## Stack

- Next.js 16 con App Router y exportación estática, React 19 y TypeScript estricto.
- Tailwind CSS 4 y estructura preparada para añadir componentes shadcn/ui de forma selectiva.
- Vitest, ESLint y Prettier para calidad frontend.
- Python 3.12, Pydantic, Pytest y Ruff para el futuro pipeline de datos.
- GitHub Actions para ejecutar controles reproducibles con servicios gratuitos.

No se usan bases de datos, autenticación, proveedores de mapas ni APIs de pago en esta fase.

## Requisitos en Windows

- Git.
- Node.js 24 y npm 11 o versiones posteriores compatibles.
- Python 3.12.

## Instalación local

Desde PowerShell, en la raíz del repositorio:

```powershell
npm ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.lock
```

Las dependencias JavaScript quedan fijadas en `package-lock.json` y las herramientas Python en
`requirements-dev.lock`.

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

# Python
.\.venv\Scripts\python.exe -m ruff format --check pipeline
.\.venv\Scripts\python.exe -m ruff check pipeline
.\.venv\Scripts\python.exe -m pytest
```

`npm run build` genera la exportación estática en `out/`. El directorio está ignorado por Git.

## Estructura

```text
src/
  app/              Rutas, layout y estilos globales de Next.js
  components/       Componentes visuales y futuro catálogo shadcn/ui
  data/             Acceso futuro a artefactos estáticos
  domain/           Tipos y reglas de dominio del frontend
  lib/              Utilidades compartidas
pipeline/
  src/fuelshift_data/
    download.py      Límite de descarga de la fuente oficial
    models.py        Modelos normalizados validados
    normalization.py Límite de adaptación del contrato oficial
    validation.py    Validación del contrato normalizado
    generation.py    Límite de escritura de artefactos estáticos
  tests/             Tests del pipeline
docs/                Decisiones y contratos pendientes
.github/workflows/   Integración continua y controles del repositorio
```

## Disponible ahora

- Portada mínima, responsive y accesible que identifica honestamente el estado del proyecto.
- Exportación estática con Next.js.
- Modelos básicos de estación, coordenadas y precio basados en variables del catálogo oficial.
- Separación inicial entre interfaz, dominio, acceso a datos y pipeline.
- CI con formato, ESLint, tipos, Vitest, build, Ruff, Pytest y `repo-hygiene`.

## Pendiente

- Verificar el contrato bruto y el endpoint canónico de MITECO.
- Implementar descarga, normalización, trazabilidad, retención del último conjunto válido y
  generación de datos estáticos.
- Añadir la consulta de estaciones y precios vigentes.
- Incorporar mapa, comparador de costes y estadísticas.
- Definir y probar el mecanismo gratuito de publicación de datos y despliegue.

El trabajo pendiente sobre la fuente se detalla en
[`docs/data-contract.md`](docs/data-contract.md).
