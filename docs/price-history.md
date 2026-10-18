# Histórico de precios: propuesta de persistencia

Estado: **propuesta pendiente de aprobación**. La generación y validación de los registros está
implementada y probada en local; no existe ningún workflow ni almacenamiento remoto que escriba
datos. Hasta que se apruebe, la página de estadísticas muestra el estado «Todavía no hay
histórico».

## Qué se guarda

Un registro por **fecha comunicada por MITECO** (`reported_at.local`, no la fecha de descarga),
con:

- `retrieved_at` y `reported_at` exactos del conjunto usado;
- número de estaciones y de provincias;
- por combustible (Gasolina 95 E5, Gasolina 98 E5 y Gasóleo A): media, mínimo, máximo y recuento
  nacionales, y media y recuento por provincia. Las provincias sin datos se omiten, nunca valen
  cero.

Las medias se redondean a 4 decimales (una décima de la precisión de la fuente). Un registro ocupa
unos 15 KB en JSON legible: unos 5,5 MB al año. No se guardan estaciones individuales.

El cálculo vive en un único sitio, `src/domain/fuel-statistics.ts`. El build publica la
instantánea en `/data/estadisticas.json` y `scripts/price-history.mjs` la convierte en registro:

```powershell
npm run build
node scripts/price-history.mjs out/data/estadisticas.json historico.json --init
```

Reglas aplicadas antes de escribir:

- conjunto con al menos 50 provincias y estaciones válidas para los tres combustibles;
- caída de estaciones de más del 10 % frente al registro anterior: se rechaza;
- mismo día: solo lo sustituye una observación más reciente; una repetida es `unchanged` y una
  más antigua es `ignored`, así que reintentar es seguro;
- escritura atómica (archivo temporal y `rename`): un fallo no altera el histórico anterior.

## Alternativas evaluadas (consultado el 18 de octubre de 2026)

| Opción                                    | Persistencia                                                                                      | Encaje                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Artefactos de GitHub Actions              | Máximo 90 días en repositorios públicos                                                           | Descartada: caducan                                                                                                          |
| Caché de GitHub Actions                   | Se elimina tras 7 días sin uso                                                                    | Descartada                                                                                                                   |
| Commits en `main`                         | Permanente                                                                                        | Prohibida por `AGENTS.md`                                                                                                    |
| Solo en Cloudflare Pages                  | Cada despliegue recupera el histórico publicado y añade el día, como ya se hace con el manifiesto | Sin permisos nuevos, pero el único ejemplar vive en el último despliegue: un despliegue defectuoso o una reversión lo pierde |
| **Rama de datos `data/historico`**        | Permanente y versionada; cada día es un commit revisable y reversible                             | **Recomendada**                                                                                                              |
| Cloudflare R2/KV u otros servicios gratis | Permanente                                                                                        | Descartada por ahora: añade cuentas, secretos y otra superficie sin una ventaja clara                                        |

Límites relevantes: GitHub recomienda repositorios de menos de 1 GB y bloquea archivos de más de
100 MiB; Cloudflare Pages Free admite 500 despliegues al mes, 20 000 archivos y 25 MiB por
archivo; los runners estándar son gratuitos en repositorios públicos.

## Arquitectura recomendada

1. **Almacén:** rama huérfana `data/historico`, sin código. Un archivo por día,
   `diario/AAAA-MM-DD.json`. Así el repositorio crece de forma lineal; un único archivo creciente
   guardaría una copia completa en cada commit.
2. **Escritura:** un job nuevo en el workflow de despliegue, después de que los datos superen
   todas las validaciones. Es el único con `permissions: contents: write`. Hace checkout de
   `data/historico`, integra la instantánea con `scripts/price-history.mjs` y empuja **solo a esa
   rama** si hay cambios. Un push con `GITHUB_TOKEN` no dispara otros workflows, así que no hay
   bucles. Comparte el grupo de concurrencia del despliegue, lo que evita escrituras simultáneas.
3. **Lectura:** antes de `npm run build`, el despliegue hace checkout de la rama en solo lectura y
   compone `public/data/history/precios.json` (ruta ignorada por Git). El build valida ese archivo
   con `src/data/price-history.ts`; si no es válido, la página lo indica y mantiene las
   estadísticas actuales.
4. **Protección:** un ruleset para `data/historico` que impida borrarla y forzar pushes. `main` no
   cambia.

Coste: 0 €. Usa el mismo repositorio público, los runners gratuitos y el mismo número de
despliegues que hoy.

## Riesgos

- El job de escritura necesita `contents: write`. Se limita a ese job y a esa rama, pero el
  permiso del token abarca el repositorio: el ruleset de `main` sigue siendo la barrera.
- Un registro válido pero erróneo quedaría guardado. Se puede revertir con un commit en la rama,
  sin tocar `main`.
- Los workflows programados se desactivan tras 60 días sin actividad en el repositorio y su
  horario no es exacto, así que puede haber días sin observación. La interfaz los muestra como
  huecos y nunca los rellena.

## Pendiente de autorización

- Crear la rama `data/historico` y su ruleset.
- Añadir los jobs de escritura y de lectura al workflow de despliegue.
- Adaptar `scripts/price-history.mjs` al formato de un archivo por día y a la composición de
  `precios.json`. La lógica de validación y fusión ya está probada.
