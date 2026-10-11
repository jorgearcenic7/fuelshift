# Codex + ECC en FuelShift

## Principio
[ECC](https://github.com/affaan-m/ECC) es una herramienta para el desarrollo asistido; no se incluye como código del repositorio ni como dependencia desplegada. Se instala en el entorno del desarrollador. Las instrucciones de `AGENTS.md` prevalecen frente a cualquier regla general del plugin.

## Antes de instalar
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

## Referencias
- [Repositorio oficial ECC](https://github.com/affaan-m/ECC)
- [Guía de navegación de Codex](https://github.com/affaan-m/ECC/blob/main/docs/CODEX-NAVIGATION-GUIDE.md)
- [Plugin nativo de Codex](https://github.com/affaan-m/ECC/blob/main/.codex-plugin/README.md)
