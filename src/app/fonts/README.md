# Fuente de la interfaz

`overpass-latin-wght-400-800.woff2` es Overpass (SIL Open Font License 1.1, ver
`OFL.txt`), reducida para no cargar más de lo que usa la web:

- **Subconjunto latino** de Google Fonts (U+0000–00FF y signos comunes): cubre
  castellano, catalán, gallego y euskera.
- **Eje de peso recortado a 400–800**: la interfaz usa 400, 500, 600, 700 y 800. El archivo original trae 100–900.

Pasa de 39.260 a 29.108 bytes. Google Fonts no recorta el eje (sirve el mismo
archivo variable para cualquier rango) y los pesos estáticos ocupan más: cinco
pesos son cinco copias del archivo variable.

## Regenerarla

Solo hace falta si cambia la fuente o los pesos. No es una dependencia del
proyecto: se hace en un entorno aparte.

```sh
python -m venv .venv-fuente
.venv-fuente/bin/pip install fonttools==4.55.3 brotli==1.1.0
# latin.woff2: el archivo «latin» que publica Google Fonts para
# https://fonts.googleapis.com/css2?family=Overpass:wght@100..900
.venv-fuente/bin/python - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

font = instancer.instantiateVariableFont(TTFont("latin.woff2"), {"wght": (400, 800)})
font.flavor = "woff2"
font.save("overpass-latin-wght-400-800.woff2")
PY
```
