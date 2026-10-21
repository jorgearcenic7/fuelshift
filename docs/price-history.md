# Histórico automático de precios

Estado: **preparado y probado en local, desactivado**. El workflow contiene los pasos del histórico,
pero todos dependen de la variable de repositorio `HISTORY_ENABLED`. Mientras no valga `true`, el
despliegue se comporta exactamente igual que antes y nadie escribe en ninguna rama. La activación
requiere los pasos remotos de [Activación](#activación-requiere-autorización), que no se han
ejecutado.

## Arquitectura

```text
MITECO ─► ingesta y validación ─► build ─► out/data/estadisticas.json
                                              │
   rama data/historico (solo lectura) ─┐      ▼
   copia publicada en producción ──────┴─► diario/ local ─► registrar el día
                                                              │
                     out/data/historico/ ◄── publicar ◄───────┤
                              │                               ▼
                       Cloudflare Pages          artefacto (1 día) ─► registrar-historico
                                                                       └─► push a data/historico
```

- **Almacén:** rama huérfana `data/historico` del mismo repositorio, sin código. Un archivo por
  día, `diario/AAAA-MM-DD.json`. Cada ejecución toca como mucho un archivo, y el repositorio crece
  de forma lineal; un único archivo creciente guardaría una copia completa en cada commit.
- **Respaldo:** cada despliegue publica también una copia validada de cada registro en
  `/data/historico/diario/`. Si la rama no es accesible, el workflow reconstruye el histórico a
  partir de esa copia; y en cada ejecución completa la rama con los días publicados que le falten.
- **Lectura en la web:** «Estadísticas» descarga `/data/historico/nacional.json` al abrirse y
  `/data/historico/provincias/NN.json` solo cuando se elige una provincia. El histórico no va en el
  HTML (90 días × 52 provincias lo harían pesado) y un fallo al cargarlo nunca afecta a las
  estadísticas actuales, que sí vienen en el HTML.
- **Cálculo:** las medias salen de `src/domain/fuel-statistics.ts`, el mismo código que muestra la
  página. El build publica la instantánea `/data/estadisticas.json` y
  `scripts/price-history.mjs` la convierte en registro diario.

### Por qué una rama de datos

Comprobado el 18 de octubre de 2026 en la documentación oficial de GitHub y Cloudflare, y en la
configuración real del repositorio (solo lectura):

| Opción                       | Persistencia                                 | Decisión                                                                                                |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Artefactos de GitHub Actions | Máximo 90 días en repositorios públicos      | Solo como traspaso de 1 día entre jobs                                                                  |
| Caché de GitHub Actions      | Se borra tras 7 días sin uso                 | Descartada                                                                                              |
| Commits en `main`            | Permanente                                   | Prohibida por `AGENTS.md` y por el ruleset de `main`                                                    |
| Solo en Cloudflare Pages     | Un único ejemplar en el último despliegue    | Descartada como almacén: una reversión o un despliegue defectuoso lo perdería. Se usa como respaldo     |
| Repositorio de datos aparte  | Permanente                                   | Descartada: `GITHUB_TOKEN` solo escribe en su repositorio; exigiría un PAT o una GitHub App con secreto |
| Releases, Cloudflare R2/KV   | Permanente                                   | Descartadas: más superficie, cuentas o secretos sin ventaja clara                                       |
| **Rama `data/historico`**    | Permanente, versionada y revisable día a día | **Elegida**: `GITHUB_TOKEN` del propio workflow, sin secretos nuevos, sin tocar `main`                  |

Datos verificados que sostienen el diseño:

- Los pushes hechos con `GITHUB_TOKEN` no crean nuevas ejecuciones de workflows: no hay bucles.
- Los permisos no declarados de un job valen `none`; los del workflow siguen en
  `contents: read` y solo `registrar-historico` declara `contents: write`.
- `concurrency` deja como máximo una ejecución en curso y una pendiente por grupo; el grupo
  `cloudflare-pages-production` ya existente serializa también los guardados.
- Los rulesets admiten patrones de rama y las reglas «Restrict deletions» y «Block force pushes»
  sin bloquear los pushes normales.
- Repositorio comprobado: público, ruleset `proteccion-main` solo sobre la rama por defecto, sin
  actores con bypass; permisos por defecto de los workflows en lectura; `data/historico` no
  existe todavía.

## Formato del registro (versión 1.0.0)

El esquema de este registro y el de los JSON publicados (`nacional.json` y `provincias/NN.json`)
están en [`contracts/`](../contracts/README.md).

```json
{
  "schema_version": "1.0.0",
  "date": "2026-10-18",
  "retrieved_at": "2026-10-18T08:28:07.482188Z",
  "reported_at": "18/10/2026 10:27:39",
  "source": {
    "attribution": "Ministerio para la Transición Ecológica y el Reto Demográfico (MITECO)",
    "catalog": "https://catalogo.datosabiertos.miteco.gob.es/catalogo/es/dataset/902a266d-5ba2-4735-a378-45818ba5a4f4",
    "license_url": "https://creativecommons.org/licenses/by/4.0/"
  },
  "station_count": 11422,
  "province_count": 52,
  "fuels": {
    "diesel_a": {
      "national": {
        "mean": 1.8889,
        "min": 1.499,
        "max": 2.299,
        "count": 11211,
        "excluded": 211
      },
      "provinces": { "28": { "mean": 1.9066, "count": 863 } }
    }
  }
}
```

Extracto de un registro real (MITECO, 18 de octubre de 2026); el archivo completo incluye los
tres combustibles y todas las provincias con datos.

- `date` es el **día comunicado por MITECO** (`reported_at.local`, hora peninsular tal como la
  comunica la fuente, sin conversiones). `retrieved_at` es la descarga real, en UTC.
- Un registro por combustible principal (Gasolina 95 E5, Gasolina 98 E5, Gasóleo A); nunca se
  mezclan. `count` son las estaciones usadas y `excluded` las cargadas sin precio válido de ese
  combustible.
- Las provincias sin datos se omiten; una ausencia nunca vale cero. Medias con 4 decimales.
- Se guardan agregados, no estaciones. Un registro ocupa unos 13,5 KB (1,9 KB comprimido): unos
  5 MB al año en la rama, mucho menos en Git, que almacena comprimido.

## Política diaria

Reglas de `scripts/price-history.mjs`, aplicadas antes de escribir:

| Situación                                                | Resultado                                    |
| -------------------------------------------------------- | -------------------------------------------- |
| Día sin registro                                         | `added`                                      |
| Observación más reciente del mismo día con otros valores | `replaced`: prevalece la última del día      |
| Observación más reciente con los mismos valores          | `unchanged`: no se escribe ni se hace commit |
| Observación más antigua que la registrada                | `ignored`                                    |
| Registro guardado corrupto del mismo día                 | Se sustituye por la observación válida       |

Se rechaza sin escribir nada:

- un conjunto con menos de 50 provincias o sin estaciones válidas en algún combustible;
- una caída de estaciones de más del 10 % frente al día anterior registrado;
- un día posterior al de la descarga en Madrid, o con más estaciones contadas que cargadas;
- cualquier campo fuera de formato (fechas, recuentos, medias, mínimos y máximos, procedencia).

Las escrituras son atómicas (archivo temporal y `rename`) y la publicación se genera en una
carpeta aparte que sustituye a la anterior solo al terminar. Un archivo corrupto se aparta, se
informa y no impide leer los demás. No se reconstruyen días pasados: el histórico empieza el día de
la activación y los días sin observación aparecen como huecos.

## Funcionamiento en el workflow

Con `HISTORY_ENABLED=true`, en `.github/workflows/deploy-cloudflare.yml`. El orden es fijo y
está comprobado en la validación del workflow:

1. **Recuperar el histórico** (job `deploy`, solo lectura, antes del build). `git ls-remote`
   pregunta por la rama de forma anónima:
   - existe: se descarga con `git fetch --depth=1` y se extrae solo `diario/` con `git archive`.
     Nunca se ejecuta nada de esa rama. Después se completa con los días publicados que falten
     (`restore`), que nunca sustituye un registro válido de la rama;
   - no existe: aviso; se republica la copia publicada, si la hay, para no borrarla; no se
     registra ni se guarda nada;
   - error: se reconstruye desde la copia publicada; si tampoco es posible, los precios se
     actualizan sin histórico en esa ejecución.
2. **Controles y build** se ejecutan también con precios idénticos, porque hace falta la
   instantánea para registrar el día. Con el histórico desactivado se mantiene la salida temprana.
3. **Registrar** el día (solo si se leyó la rama o la copia publicada) y **publicar** todo el
   histórico en `out/data/historico/`. La observación nueva va en el mismo despliegue.
4. **Decidir** (`price-history.mjs plan`): convierte los outputs en `persist` y `deploy` con
   valores explícitos `true`/`false`. Un recuento vacío o ausente vale 0 y uno ilegible hace
   fallar la decisión sin guardar ni desplegar nada por el histórico. El workflow no compara
   números ni textos vacíos.
5. **Entregar** solo los registros válidos (`export`) en un artefacto de 1 día que se sustituye
   si se reejecuta el job (`overwrite`). Un último paso confirma la entrega con
   `history_delivered=true`, el único output del job.
6. **Desplegar** si cambiaron los precios o si `deploy` es `true`. Con precios idénticos y el día
   ya registrado, termina sin desplegar.

Del paso 3 al 5, todos tienen `continue-on-error`: un fallo del histórico nunca bloquea la
actualización de precios.

7. **`registrar-historico`**, job aparte con `contents: write` como único permiso, sin entorno,
   sin secretos y sin `npm ci`. Se ejecuta solo si `history_delivered` es `true`, sea cual sea el
   resultado de `deploy` después de la entrega (por ejemplo, un fallo de Cloudflare no impide
   guardar una observación ya validada). No se ejecuta si se cancela la ejecución ni si `deploy` se
   omite. Obtiene los
   scripts de `main` sin credenciales persistidas y `data/historico` en otra carpeta.
   `scripts/history-git.mjs` vuelve a validar cada registro, parte del estado remoto, los integra
   con la misma política, confirma solo los archivos cambiados como `github-actions[bot]` y hace un
   push normal. Si otra ejecución se adelanta, el push se rechaza y se reintenta hasta 3 veces
   sobre el nuevo commit. Nunca usa `--force`, nunca crea la rama y se niega a escribir fuera de
   `data/...`.

GitHub compara textos sin distinguir mayúsculas: `HISTORY_ENABLED` vale como activado con `true`
en cualquier combinación de mayúsculas, y con cualquier otro valor o sin definir queda desactivado.

### Errores y recuperación

| Caso                                   | Comportamiento                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MITECO caído o descarga incompleta     | Falla la ingesta como hasta ahora: no hay build, ni registro, ni despliegue. Producción y rama intactas                                                |
| Datos anómalos                         | `record` falla; se publica el histórico existente y los precios siguen su curso                                                                        |
| Día ya registrado / ejecución repetida | `unchanged`: sin commit ni despliegue adicional                                                                                                        |
| Observación más antigua                | `ignored`                                                                                                                                              |
| Archivo corrupto en la rama            | Se descarta al leer (la web indica cuántos), no se entrega al guardado y se repara con la copia publicada si existe; nunca bloquea guardar días nuevos |
| Fallo al guardar en la rama            | El día ya está publicado; la siguiente ejecución lo recupera de producción y lo guarda                                                                 |
| Dos ejecuciones simultáneas            | `concurrency` las serializa; si aun así coinciden, el push rechazado se reintenta sobre el commit ajeno                                                |
| Workflow interrumpido o cancelado      | Escrituras atómicas; sin entrega confirmada no se guarda nada; un commit no empujado se descarta en el siguiente intento                               |
| Despliegue fallido o revertido         | Si la entrega se confirmó, el día se guarda igualmente; la rama conserva todos los días y el siguiente despliegue publica el histórico completo        |
| La rama todavía no existe              | Aviso; se republica la copia publicada si existe (o un histórico vacío); nada se escribe                                                               |
| La web recibe una sola observación     | Muestra «Solo hay 1 observación…» sin dibujar evolución                                                                                                |
| JSON publicado corrupto                | Aviso en el panel; las estadísticas actuales no cambian                                                                                                |

Recuperación manual sin pérdidas: la rama es Git, así que cualquier día puede revisarse o
revertirse con un commit (`git revert`) en `data/historico`. Para reconstruir la rama desde
producción en local: `node scripts/price-history.mjs restore <URL publicada> <carpeta>`.

## Coste y cuotas (0 €/mes)

- GitHub Actions: runners estándar gratuitos en repositorios públicos. Con el histórico activo, el
  build se ejecuta en cada comprobación (máximo 6 al día). Si el repositorio pasa a privado, hay
  que revisarlo.
- Artefactos: uno por ejecución que registra, de unos pocos cientos de KB, retenido 1 día.
- Cloudflare Pages Free: cada ejecución despliega como mucho una vez, así que el máximo sigue en
  186 despliegues al mes frente a los 500 permitidos. El histórico añade un archivo por día al
  sitio (unos 365 al año frente al límite de 20 000) y ninguno se acerca a 25 MiB.
- Repositorio: unos pocos MB al año, lejos del 1 GB recomendado.
- Los workflows programados se desactivan tras 60 días sin actividad en el repositorio y su
  horario no es exacto: puede haber días sin observación, que se ven como huecos.

## Activación (requiere autorización)

Nada de esto se ha hecho. En este orden, tras fusionar la PR:

1. Crear la rama huérfana `data/historico` con solo un `README.md`, sin código, desde un clon
   nuevo y dedicado (`git switch --orphan` deja el árbol sin archivos versionados):

   ```powershell
   git clone https://github.com/jorgearcenic7/FuelShift.git fuelshift-historico
   cd fuelshift-historico
   git switch --orphan data/historico
   Set-Content -Encoding utf8 README.md "# Histórico de precios de FuelShift`n`nDatos generados por GitHub Actions. No contiene código."
   git add README.md
   git commit -m "chore(historico): iniciar la rama de datos"
   git push origin data/historico
   ```

2. Crear un ruleset para `data/historico` con **Restrict deletions** y **Block force pushes**.
   No activar «Restrict updates» (bloquearía el guardado) ni requerir PR en esa rama. El ruleset
   de `main` no cambia.
3. En **Settings > Secrets and variables > Actions > Variables**, crear `HISTORY_ENABLED` con el
   valor `true`.
4. Lanzar el workflow manualmente y comprobar: aviso ausente en «Recuperar el histórico», estado
   `added`, job `registrar-historico` en verde, un commit en `data/historico` y
   `/data/historico/nacional.json` en producción.

## Desactivar con seguridad

Borrar la variable `HISTORY_ENABLED` o darle otro valor. El workflow vuelve al comportamiento
anterior en la siguiente ejecución, la rama queda intacta y la web muestra el último histórico
publicado hasta el siguiente despliegue, que ya no lo incluirá («Todavía no hay histórico»). Para
reanudar, volver a poner `true`: los días intermedios quedan como huecos.

## Uso local

```powershell
npm run build
node scripts/price-history.mjs record out/data/estadisticas.json data/historico/diario
node scripts/price-history.mjs publish data/historico/diario public/data/historico
```

`data/historico/` y `public/data/historico/` están ignorados por Git. Las pruebas de
`scripts/history-git.test.mjs` simulan GitHub con repositorios desnudos temporales: guardado,
repeticiones, ejecuciones simultáneas, rama inexistente y negativa a escribir en `main`.
