# AGENTS.md — FuelShift

## Objetivo
Crear una aplicación web pública de precios oficiales de carburantes en España, comparador de costes energéticos y estadísticas, con coste operativo inicial de **0 €/mes**. Priorizar rigor de datos, UX accesible, rendimiento, seguridad, simplicidad y valor profesional.

## Reglas no negociables
- No introducir servicios facturables ni APIs de pago sin autorización explícita.
- Mantener el diseño de referencia aprobado; no mostrar datos ni funcionalidades simuladas como reales.
- Usar datos oficiales, registrar origen y antigüedad; conservar el último conjunto válido si falla la ingesta.
- Nunca hacer commit, push ni escritura directa en `main`. Trabajar con ramas cortas y PR.
- Nunca fusionar una PR sin autorización expresa del propietario.
- Commits y títulos de PR: `tipo(alcance): descripción en español`. Tipos: feat, fix, refactor, perf, test, docs, style, build, ci, chore, revert.
- No desproteger `main` para automatizar ingestas. Los datos persistentes y los despliegues requieren un mecanismo separado, aprobado y probado.
- No introducir secretos en el código, el historial Git ni el navegador.

## Stack propuesto (sujeto a validación por fases)
Next.js App Router con exportación estática, React/TypeScript, Tailwind, shadcn/ui, MapLibre, Recharts y Lucide.
Python, Polars, DuckDB/SQL, Parquet, JSON optimizados; Pydantic cuando aporte valor.
GitHub Actions, Cloudflare Pages Free, Pytest, Vitest, Playwright, Ruff, ESLint y Prettier.

## Flujo de trabajo
Planificar → implementar un alcance acotado → probar → revisar → verificar → documentar.
Describir los archivos cambiados, riesgos, pruebas realmente ejecutadas y resultados; no afirmar verificaciones inexistentes.
Evitar cambios grandes no relacionados. Separar UI, dominio, acceso a datos y pipeline.

## GitHub
- Ramas con prefijos `feat/`, `fix/`, `docs/`, `test/`, `ci/`, `chore/`, etc.
- Ruleset de `main`: PR obligatoria, conversaciones resueltas, historial lineal, bloqueo de borrado y force-push, CI obligatorio cuando sus checks estén disponibles.
- Preferir Squash and merge, con título Conventional Commits; nunca realizarlo sin aprobación.
- No exigir aprobación externa imposible si hay un único desarrollador.

## Codex y ECC
ECC (https://github.com/affaan-m/ECC) es una herramienta opcional de **desarrollo**, no dependencia de producción ni submódulo del proyecto.
Utilizar preferentemente el plugin nativo de Codex si la versión instalada lo soporta. No copiar ECC entero al repositorio ni duplicar mecanismos de instalación.
Revisar personalmente hooks, acceso a herramientas y permisos antes de habilitarlos. Las reglas de FuelShift prevalecen sobre las genéricas de ECC.
Consultar `docs/codex-ecc.md` antes de configurar ECC.
