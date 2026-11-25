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

## Stack

Next.js App Router con exportación estática, React 19/TypeScript estricto, Tailwind CSS 4, MapLibre GL JS y gráficos SVG propios (sin librería de gráficos).
Python 3.12 con Pydantic; salida en JSON estático validado con JSON Schema, sin base de datos.
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

## Control humano de Git y operaciones

- El propietario ejecuta personalmente **todas** las operaciones de escritura en Git: crear o cambiar ramas, worktrees, `add`, commit, push, creación de PR, merge y etiquetas. Los agentes solo consultan Git y proponen comandos, mensajes y descripciones para revisión humana.
- Los agentes no publican releases, no despliegan ni disparan workflows de publicación. No escriben directamente en `main` ni alteran sus protecciones.
- Estas restricciones no cambian las automatizaciones de producción existentes y previamente autorizadas, incluidos despliegues e históricos. No modificarlas para eludir el control humano.
- Cada commit propuesto representa un cambio coherente y revisable, con Conventional Commits en español; no fabricar actividad. Mantener PR obligatoria, CI en verde y squash merge ejecutado y autorizado por el propietario.
- Antes de publicar, el propietario debe comprender el cambio, revisar el diff, validar las decisiones y ejecutar las comprobaciones finales. No ocultar el uso de IA ni inventar evidencias de autoría o revisión humana.

## Desarrollo asistido y recursos

- Seguir [la metodología reducida](docs/desarrollo-ia.md): una tarea acotada, contrato breve, implementación, pruebas proporcionales y revisión. Ningún agente puede ampliar el alcance autorizado.
- Un único agente por defecto. Usar dos cuando haya tareas independientes; máximo **tres simultáneos en total entre Codex y Claude Code**, incluido el coordinador. El coordinador registra la asignación y evita edición concurrente de archivos y análisis duplicados. Sin delegación recursiva.
- El revisor independiente no implementa ni corrige el código que revisa. Puede haber revisión cruzada entre herramientas cuando aporte una comprobación distinta y justificada.
- Máximo dos ciclos automáticos de corrección por tarea; si sigue sin resolverse, detener los reintentos y solicitar intervención humana con evidencias.
- Modelos ligeros y esfuerzo bajo para tareas sencillas; razonamiento medio para desarrollo habitual; alto solo ante complejidad justificada; máximo exclusivamente para problemas críticos. Comprobar disponibilidad y compatibilidad y recomendar la selección al propietario; no afirmar selección automática.
- Usar RTK explícitamente en comandos compatibles. Ante errores y revisiones críticas, consultar la salida original. Buscar con `rg`, leer solo archivos relevantes, evitar lecturas repetidas y cargar únicamente las skills necesarias.
- Mantener sesiones enfocadas y compartir contratos, decisiones y resultados breves. No instalar herramientas, modificar configuración global, activar nuevos hooks ni facturación adicional sin autorización expresa.

## Estilo y comentarios

Mantener el estilo existente y código sencillo, modular y explicable por el propietario. Los comentarios deben ser naturales, profesionales y concisos; en español cuando expliquen decisiones de dominio. Explicar motivos, reglas de negocio, límites deliberados, casos límite, seguridad, ahorro de recursos o alternativas descartadas cuando aporten contexto. No repetir el código, introducir errores deliberados ni simular autoría humana.

## Preparación de FuelShift 1.2.0

La Fase 0 solo prepara metodología, agentes y skills. No autoriza implementar rutas o ahorro neto ni modificar aplicación, pipeline, dependencias, infraestructura, workflows o ADR existentes. Cloudflare Workers y el proveedor de rutas requieren una decisión arquitectónica posterior, con coste operativo de 0 €/mes verificado antes de su aprobación.
