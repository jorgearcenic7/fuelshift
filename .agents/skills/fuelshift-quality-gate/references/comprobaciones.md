# Comprobaciones según el alcance

El coordinador o implementador consulta los scripts actuales de `package.json`, la CI y el contrato de la tarea;
no debe asumir que todas las herramientas están instaladas o disponibles. Ejecuta
solo las comprobaciones autorizadas y necesarias, sin instalar dependencias ni
activar servicios por iniciativa propia.

| Cambio                     | Comprobaciones a seleccionar                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Documentación y perfiles   | Enlaces, frontmatter, TOML, formato, coherencia y alcance                                     |
| Dominio TypeScript         | Lint, tipos y pruebas de límites y unidades relevantes                                        |
| UI o MapLibre              | Lo anterior y comprobación de teclado, responsive y regresiones con Playwright cuando proceda |
| Datos o pipeline           | Pytest, Ruff y validación de contratos y conservación del último conjunto válido              |
| Integración externa futura | Contratos sin red, privacidad, fallos, cuotas y coste cero demostrado antes de aprobarla      |

## Responsabilidades y evidencias

La ejecución de los comandos de esta referencia corresponde al coordinador o
implementador, dentro de sus permisos y del alcance autorizado. El coordinador
entrega al revisor el diff original, la lista de archivos nuevos no rastreados y su
contenido relevante, y los resultados reales de las comprobaciones, incluidos
comandos, fallos, exclusiones y controles no ejecutados.

El revisor independiente examina estas evidencias y realiza únicamente las
lecturas permitidas por su perfil. No ejecuta comprobaciones ni amplía sus permisos
para hacerlo; mantiene todas sus restricciones actuales. Si faltan evidencias,
las solicita al coordinador y declara la limitación en su informe.

## Cierre por el coordinador o implementador

Para cerrar cualquier cambio:

1. Revisar `git diff` original y los archivos nuevos completos. Consultar
   `git ls-files --others --exclude-standard` y `git check-ignore` con las rutas
   esperadas para detectar exclusiones accidentales. Nunca usar `git add` para validar.
2. Comprobar que el alcance no toca aplicación, pipeline o infraestructura cuando
   solo se autorizó documentación. Revisar datos simulados, procedencia, secretos,
   permisos, dependencias y recursos nuevos; no leer credenciales para hacerlo.
3. Ejecutar formato sobre los archivos aplicables y `git diff --check`; este último
   no cubre los no rastreados. Revisar también su UTF-8, finales LF, espacios finales
   y rutas sensibles/generadas según la CI. Registrar exclusiones de Prettier.
4. Usar RTK cuando sea compatible; ante fallo o revisión crítica consultar salida
   original. No modificar workflows para adaptar un cambio documental.
5. Entregar comandos, resultados y limitaciones, incluidos build o E2E no ejecutados.
   El propietario realiza las comprobaciones finales y las escrituras Git.

Una validación sintáctica no demuestra que un cliente descubra un agente o una
skill. No lanzar llamadas adicionales de IA solo para acreditar reconocimiento;
si no hay mecanismo local sin inferencia, documentar esa limitación.
