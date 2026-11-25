# Desarrollo asistido por IA

Esta metodología aplica BMAD de forma reducida, sin instalar su framework.
[AGENTS.md](../AGENTS.md) contiene las reglas permanentes y el control humano;
esta guía concreta cómo organizar el trabajo. ECC es opcional y no se despliega.

## Una tarea revisable

1. **Definir:** el coordinador acuerda objetivo, alcance, exclusiones y aceptación.
2. **Diseñar:** identifica contratos, dependencias y riesgos; una decisión que cambie
   la arquitectura se propone al propietario mediante una ADR posterior.
3. **Implementar:** asigna archivos y una entrega acotada al perfil adecuado.
4. **Verificar:** ejecuta comprobaciones proporcionales y conserva sus resultados reales.
5. **Revisar:** un revisor independiente examina diff y aceptación sin corregirlos.
6. **Entregar:** el propietario revisa, ejecuta las comprobaciones finales y realiza
   las operaciones Git y de publicación.

La Fase 0 prepara este proceso. No decide proveedor de rutas, Workers ni fórmulas
económicas definitivas. Las ADR vigentes siguen siendo la arquitectura aplicable.

Usar esta ficha en la conversación o descripción de la tarea, sin crear un archivo
por defecto:

```text
Objetivo y alcance autorizado:
Exclusiones y aceptación:
Contrato: entradas, salidas, unidades, errores y procedencia:
Responsable, archivos asignados y dependencias:
Modelo/esfuerzo recomendado y motivo:
Comprobaciones y resultados reales:
Decisiones pendientes y número de ciclos de corrección:
```

## Coordinación y perfiles

La sesión principal es el coordinador. Antes de delegar, comprueba cuántos agentes
siguen activos en ambas herramientas; si no conoce ese total, mantiene un único
agente. Solo paraleliza tareas independientes con archivos separados. La revisión
de un diff terminado puede ser secuencial. Todos los perfiles aplican `AGENTS.md` como fuente principal y consultan su
apartado antes de actuar; si las instrucciones ya están cargadas en el contexto,
no repiten su lectura. No delegan a su vez.

### Rutas y backend

Perfil `fuelshift-routing-backend`: evalúa APIs, geolocalización, geometría,
selección de estaciones y contratos del ahorro neto. Declara unidades, precisión,
supuestos, cuotas, privacidad y fallos del proveedor. Carga `fuelshift-routing`
cuando la tarea trate ese dominio. Separa cálculo puro y acceso a servicios;
no da por aprobado un backend ni una cuota gratuita. En Fase 0 no implementa.

### Frontend

Perfil `fuelshift-frontend`: mantiene React/TypeScript, MapLibre, diseño aprobado,
responsive, teclado, foco y accesibilidad. Respeta las fronteras de capas existentes.
Acuerda con el perfil de rutas el contrato antes de integrar datos; representa
carga, ausencia de datos y errores sin presentar resultados simulados como reales.
Solo modifica los archivos asignados y justifica las pruebas de interfaz necesarias.

### QA, seguridad y revisión independiente

Perfil `fuelshift-qa-review`: inspecciona pruebas, regresiones, privacidad,
rendimiento, coste y diff contra criterios de aceptación. Carga
`fuelshift-quality-gate`. No edita, implementa ni corrige; si implementó el cambio
en otra sesión, la revisión independiente corresponde a otra sesión o al propietario.
Devuelve hallazgos con severidad, archivo, evidencia y efecto, separando bloqueos
de recomendaciones. No confunde ausencia de hallazgos con prueba de corrección.

El coordinador solicita comprobaciones ejecutables al implementador o las ejecuta
él mismo. El revisor puede leer resultados, pero su perfil restringido no dispone
de shell. Una revisión cruzada Codex/Claude recibe solo contrato, diff y evidencias
pertinentes; debe justificar qué incertidumbre adicional resuelve.

En Claude se limita el revisor a `Read`, `Glob` y `Grep`. En Codex se deshabilitan
shell, apps, plugins, memoria y solicitud de permisos; la prohibición de editar
se expresa en sus instrucciones. Codex hereda los permisos del padre: el perfil no
crea un sandbox propio de solo lectura. Para un bloqueo técnico de escrituras,
el propietario debe iniciar la sesión de revisión con sandbox de solo lectura.

## ECC y adaptadores

Reutilizar selectivamente las skills instaladas de ECC para revisión de código,
seguridad y verificación cuando aporten valor; comprobar el nombre expuesto en la
sesión antes de invocarlas. No lanzar orquestadores genéricos que amplíen el alcance.
Las dos skills de FuelShift añaden reglas de dominio y selección de comprobaciones,
sin copiar listas genéricas de ECC.

Los tres adaptadores por cliente solo apuntan a estos contratos compartidos:

- Codex: `.codex/agents/*.toml`, con `name`, `description` y `developer_instructions`.
- Claude: `.claude/agents/*.md`, con frontmatter y herramientas explícitas.
- Skills Codex: `.agents/skills/<nombre>/SKILL.md`.
- Skills Claude: `.claude/skills/<nombre>/SKILL.md`, remitiendo a las mismas
  referencias bajo `.agents/skills/`.

No se copian los agentes genéricos de ECC: sus revisores no abarcan el contrato
conjunto de FuelShift y la presencia de archivos en la caché Codex no demuestra su
registro por el plugin. Si una sesión ofrece un agente ECC equivalente, puede
usarse con este contrato en lugar del perfil local, nunca duplicando el trabajo.

Los perfiles no fijan modelo: heredan la elección de la sesión. No modificamos
configuración global ni activamos hooks. Los límites de concurrencia son una
obligación del coordinador, no un contador técnico común a ambos clientes.

## Modelos y ahorro de tokens

| Trabajo                                              | Esfuerzo recomendado              | Claude, si está disponible |
| ---------------------------------------------------- | --------------------------------- | -------------------------- |
| Documentación sencilla, búsqueda y cambios mecánicos | Bajo, modelo ligero               | Haiku                      |
| Componentes, funciones y pruebas habituales          | Medio                             | Sonnet                     |
| Arquitectura, geoespacial, APIs y errores complejos  | Alto, justificando el motivo      | Sonnet u Opus              |
| Problema crítico que lo requiera                     | Máximo compatible, justificándolo | Opus                       |

En Codex se recomienda al propietario un modelo disponible y el esfuerzo compatible
con él. `--model` selecciona modelo; `model_reasoning_effort` es una opción de
configuración. Claude ofrece `--model` y `--effort`. No todos los modelos admiten
todos los niveles; la ayuda del CLI no acredita acceso a un modelo. La selección
es explícita, sin prometer enrutamiento automático ni activar consumo adicional.

Usar `rg` y lecturas dirigidas; no cargar repositorios completos, catálogos de skills
ni documentación sin relación. Compartir referencias y resultados, no historiales
completos de conversación. Evitar repetir consultas ya resueltas salvo cambios.

RTK 1.2.1 se verificó con `rtk git status --short --branch` y
`rtk git diff --stat`. Su ayuda ofrece filtros para npm, Vitest y Pytest, pero cada
combinación debe comprobarse antes de adoptarla. En PowerShell, usar explícitamente
RTK donde sea compatible; si falla, consultar el comando original. Para revisiones
críticas usar `git diff` original y leer también los archivos nuevos completos:
no aparecen en el diff habitual. No usar `rtk init`, hooks ni proxies de IA.

Tras dos ciclos automáticos de corrección por tarea, detener los reintentos y
entregar causa, intentos, evidencia y decisión requerida al propietario. Un cambio
de herramienta o de modelo no reinicia el contador.

## Entrega y revisión humana

Informar estado, archivos, motivos, decisiones y alternativas descartadas,
comprobaciones ejecutadas y sus resultados, limitaciones, riesgos pendientes,
modelo/agentes realmente usados y commit recomendado. No inferir el identificador
del modelo a partir de una configuración por defecto si la sesión no lo informa.

El propietario revisa especialmente el alcance, contratos, coste, privacidad y
diff, incluidos archivos nuevos, y ejecuta las comprobaciones finales. La IA puede
proponer un commit como `docs(desarrollo): definir metodología de trabajo asistida por IA`;
no lo ejecuta. Las automatizaciones de producción ya autorizadas siguen vigentes.

## Compatibilidad y fuentes

Formatos contrastados el 25/11/2026 con la ayuda instalada y documentación oficial:
[agentes Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[skills Codex](https://learn.chatgpt.com/docs/build-skills),
[agentes Claude](https://code.claude.com/docs/en/sub-agents),
[skills Claude](https://code.claude.com/docs/en/skills) e
[importación de instrucciones Claude](https://code.claude.com/docs/en/memory).
El estado instalado, habilitado y operativo se detalla en
[codex-ecc.md](codex-ecc.md). Un formato válido no demuestra descubrimiento ni
comportamiento en una sesión real.
