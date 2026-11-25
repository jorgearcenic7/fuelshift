# Codex + ECC en FuelShift

## Principio

[ECC](https://github.com/affaan-m/ECC) es una herramienta para el desarrollo asistido; no se incluye como código del repositorio ni como dependencia desplegada. Se instala en el entorno del desarrollador. Las instrucciones de `AGENTS.md` prevalecen frente a cualquier regla general del plugin.

## Estado contrastado el 25/11/2026

| Capacidad           | Instalada / habilitada                             | Verificación operativa                                                                 |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Codex CLI 0.172.0   | Ejecutable disponible                              | Versión y ayuda; selección explícita de modelo, revisión y agentes anunciados          |
| ECC 2.2.3 en Codex  | `codex plugin list --json`: instalado y habilitado | Skills expuestas en la sesión de auditoría; no se ejecutaron hooks ni todos sus flujos |
| Claude Code 2.1.330 | Ejecutable disponible                              | Versión y ayuda de `--agent`, `--agents`, `--model` y `--effort`                       |
| ECC 2.2.3 en Claude | `claude plugin list`: habilitado en ámbito usuario | Archivos de agentes presentes; no se ejecutaron agentes ni hooks                       |
| RTK 1.2.1           | Ejecutable disponible                              | `rtk git status --short --branch` y `rtk git diff --stat`                              |

Claude muestra este aviso para ECC: «The packages it lists were not installed,
because its package.json sets overrides, which this install does not apply».
Por tanto, habilitado no significa que sus dependencias internas o hooks funcionen.
No se reinstaló el plugin ni se instalaron paquetes para corregirlo. El perfil
Minimal fue declarado por el propietario; no se inspeccionó la configuración global
para acreditarlo. La confianza y ejecución de hooks no están verificadas.

La caché de ECC contiene ejemplos Codex `explorer`, `reviewer` y `docs_researcher`
registrados desde su configuración de referencia. El manifiesto nativo expone
skills, MCP y hooks, pero no acredita el registro de esos ejemplos como agentes.
Su TOML de revisor tampoco incluye los tres campos obligatorios del formato
standalone actual. No copiar esa configuración al proyecto.

Los perfiles locales y dos skills se describen en
[desarrollo-ia.md](desarrollo-ia.md). Su formato se contrasta con las fuentes
oficiales enlazadas allí; validar sintaxis no acredita reconocimiento en ejecución.
En la sesión Codex de correcciones del 25/11/2026, iniciada después de crear
los perfiles, el catálogo de `spawn_agent` expone `fuelshift-routing-backend`,
`fuelshift-frontend` y `fuelshift-qa-review`. El catálogo de skills de la sesión
expone `fuelshift-routing` y `fuelshift-quality-gate` con sus rutas locales.
Esto acredita descubrimiento real, además de existencia y validación sintáctica.
Se cargó `fuelshift-quality-gate` para esta tarea; no se ejecutó una tarea de rutas.

No se lanzaron subagentes ni trabajos adicionales de IA. El funcionamiento de los
perfiles y la aplicación efectiva de las restricciones técnicas del revisor siguen
pendientes: el catálogo y la sintaxis TOML no demuestran aislamiento ni bloqueo de
escrituras. Hasta verificar ese comportamiento, utilizar la revisión mediante
Claude o una sesión Codex con permisos efectivos de solo lectura. No se concedieron
permisos adicionales al revisor ni se modificó el sandbox global.

En la entrega de Fase 0 se validaron los tres TOML con Python `tomllib`, los siete
frontmatters con el `js-yaml` ya instalado y los enlaces locales. Se comprobaron
también archivos nuevos, exclusiones Git, UTF-8/LF, formato y preservación de las
reglas originales. El validador de skills de la herramienta no pudo usarse por
falta de PyYAML; no se instaló. En aquella entrega no se acreditó descubrimiento en una sesión nueva
ni ejecución de perfiles; el descubrimiento se comprobó en la sesión de correcciones
descrita arriba, sin ejecutar perfiles. El comando `claude agents` consultado lista sesiones
en segundo plano, no certifica el registro de perfiles. No se ejecutaron pruebas
de aplicación, build ni E2E para este cambio exclusivamente documental.

## Antes de instalar

La Fase 0 no autoriza instalaciones ni reconfiguración. Este procedimiento queda
como referencia para una intervención futura expresamente autorizada.

1. Verificar que Codex CLI está instalado y consultar `codex --version`.
2. Revisar si ECC ya está instalado mediante `codex plugin list` o la interfaz `/plugins`.
3. Leer las instrucciones **actuales** de [ECC para Codex](https://github.com/affaan-m/ECC/blob/main/.codex-plugin/README.md).
4. Revisar marketplace, origen, permisos y hooks. No ejecutar instaladores alternativos o scripts de sincronización heredados sin aprobación.

## Instalación nativa propuesta (solo si coincide con la versión actual de Codex)

```powershell
codex plugin marketplace add affaan-m/ECC
codex plugin add ecc@ecc
codex plugin list --json
```

Reiniciar Codex. Entrar en `/plugins` para comprobar habilitación y en `/hooks` para **examinar antes de confiar**. No autorizar automáticamente comandos, accesos ni hooks. Si la CLI no reconoce estos comandos, detenerse y comprobar compatibilidad: no aplicar scripts alternativos a ciegas.

ECC documenta `$configure-ecc` para ajustar sus capacidades después de la instalación.

## Uso inicial limitado

Priorizar planificación de tareas, TDD, revisión de código, seguridad y revisión de PR. Activar otras habilidades solo si resuelven una necesidad concreta.

## Convenciones

- Una tarea por rama y PR con título `tipo(alcance): descripción en español`.
- Nunca modificar `main` directamente ni fusionar sin autorización.
- No conceder acceso a secretos ni permisos de despliegue a herramientas sin revisión.
- No confundir registro del plugin con verificación real de su funcionamiento.
- Todas las escrituras Git y publicaciones corresponden al propietario conforme a
  `AGENTS.md`; las instrucciones genéricas de ECC no conceden permiso para ellas.

## Referencias

- [Repositorio oficial ECC](https://github.com/affaan-m/ECC)
- [Guía de navegación de Codex](https://github.com/affaan-m/ECC/blob/main/docs/CODEX-NAVIGATION-GUIDE.md)
- [Plugin nativo de Codex](https://github.com/affaan-m/ECC/blob/main/.codex-plugin/README.md)
