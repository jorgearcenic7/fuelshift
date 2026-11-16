"""Genera public/geo/provincias.json: contornos simplificados de las 52
provincias para el mapa coroplético de Estadísticas.

Fuente: Natural Earth 1:10m «Admin 1 - States, Provinces» v5.1.2 (dominio
público), https://www.naturalearthdata.com/.

Uso (solo biblioteca estándar):
    curl -L -o ne_admin1.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson
    python scripts/build-province-shapes.py ne_admin1.geojson public/geo/provincias.json

Es una figura de referencia visual: los datos de cada provincia salen de las
estadísticas publicadas, nunca de este archivo.
"""

from __future__ import annotations

import json
import math
import sys

# ISO 3166-2 de Natural Earth → código INE de provincia (el de MITECO).
ISO_TO_INE = {
    "ES-VI": "01",
    "ES-AB": "02",
    "ES-A": "03",
    "ES-AL": "04",
    "ES-AV": "05",
    "ES-BA": "06",
    "ES-PM": "07",
    "ES-B": "08",
    "ES-BU": "09",
    "ES-CC": "10",
    "ES-CA": "11",
    "ES-CS": "12",
    "ES-CR": "13",
    "ES-CO": "14",
    "ES-C": "15",
    "ES-CU": "16",
    "ES-GI": "17",
    "ES-GR": "18",
    "ES-GU": "19",
    "ES-SS": "20",
    "ES-H": "21",
    "ES-HU": "22",
    "ES-J": "23",
    "ES-LE": "24",
    "ES-L": "25",
    "ES-LO": "26",
    "ES-LU": "27",
    "ES-M": "28",
    "ES-MA": "29",
    "ES-MU": "30",
    "ES-NA": "31",
    "ES-OR": "32",
    "ES-O": "33",
    "ES-P": "34",
    "ES-GC": "35",
    "ES-PO": "36",
    "ES-SA": "37",
    "ES-TF": "38",
    "ES-S": "39",
    "ES-SG": "40",
    "ES-SE": "41",
    "ES-SO": "42",
    "ES-T": "43",
    "ES-TE": "44",
    "ES-TO": "45",
    "ES-V": "46",
    "ES-VA": "47",
    "ES-BI": "48",
    "ES-ZA": "49",
    "ES-Z": "50",
    "ES-CE": "51",
    "ES-ML": "52",
}
CANARIAS = {"35", "38"}
# Territorios demasiado pequeños para pulsarlos: se marcan con un punto.
DOTS = {"51", "52"}

WIDTH = 560
# Península, Baleares, Ceuta y Melilla.
MAIN = {"west": -9.45, "east": 4.45, "south": 35.15, "north": 43.85}
# Canarias, en un recuadro abajo a la izquierda (sobre el Atlántico).
CANARY = {"west": -18.2, "east": -13.35, "south": 27.6, "north": 29.45}
CANARY_BOX = {"x": 8.0, "y": 372.0, "w": 196.0}
TOLERANCE = 0.55  # px, Douglas-Peucker
MIN_RING_AREA = 1.5  # px², descarta islotes invisibles


def project_main(lon: float, lat: float, scale: float) -> tuple[float, float]:
    k = math.cos(math.radians(39.5))
    return ((lon - MAIN["west"]) * k * scale, (MAIN["north"] - lat) * scale)


def project_canary(lon: float, lat: float) -> tuple[float, float]:
    k = math.cos(math.radians(28.5))
    span = (CANARY["east"] - CANARY["west"]) * k
    scale = CANARY_BOX["w"] / span
    return (
        CANARY_BOX["x"] + (lon - CANARY["west"]) * k * scale,
        CANARY_BOX["y"] + (CANARY["north"] - lat) * scale,
    )


def simplify(points: list[tuple[float, float]], tolerance: float) -> list:
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (x1, y1), (x2, y2) = points[start], points[end]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-12
        best, index = 0.0, -1
        for i in range(start + 1, end):
            x0, y0 = points[i]
            distance = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / norm
            if distance > best:
                best, index = distance, i
        if best > tolerance and index > 0:
            keep[index] = True
            stack.extend([(start, index), (index, end)])
    return [point for point, kept in zip(points, keep, strict=True) if kept]


def simplify_ring(points: list[tuple[float, float]], tolerance: float) -> list:
    """Anillo cerrado: se parte por el punto más alejado del inicio, porque
    Douglas-Peucker degenera cuando el primer y el último punto coinciden."""
    if len(points) < 4:
        return points
    x0, y0 = points[0]
    far = max(
        range(1, len(points) - 1),
        key=lambda i: math.hypot(points[i][0] - x0, points[i][1] - y0),
    )
    first = simplify(points[: far + 1], tolerance)
    second = simplify(points[far:], tolerance)
    return first[:-1] + second


def ring_area(points: list[tuple[float, float]]) -> float:
    return abs(
        sum(
            x1 * y2 - x2 * y1
            for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1], strict=True)
        )
        / 2
    )


def path_for(rings: list[list[tuple[float, float]]]) -> str:
    return "".join("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in ring) + "Z" for ring in rings)


def main(source: str, target: str) -> None:
    with open(source, encoding="utf-8") as handle:
        features = json.load(handle)["features"]
    spain = [f for f in features if f["properties"].get("adm0_a3") == "ESP"]
    scale = WIDTH / ((MAIN["east"] - MAIN["west"]) * math.cos(math.radians(39.5)))
    height = round((MAIN["north"] - MAIN["south"]) * scale)

    provinces = []
    for feature in spain:
        ine = ISO_TO_INE[feature["properties"]["iso_3166_2"]]
        geometry = feature["geometry"]
        polygons = (
            [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        )
        project = (
            project_canary if ine in CANARIAS else (lambda lon, lat: project_main(lon, lat, scale))
        )
        rings = []
        all_points = []
        for polygon in polygons:
            for ring in polygon:
                projected = [project(lon, lat) for lon, lat in ring]
                all_points.extend(projected)
                simplified = simplify_ring(projected, TOLERANCE)
                if len(simplified) >= 4 and (ine in DOTS or ring_area(simplified) >= MIN_RING_AREA):
                    rings.append(simplified[:-1])
        xs = [x for x, _ in all_points]
        ys = [y for _, y in all_points]
        entry = {
            "id": ine,
            "d": path_for(rings),
            # Centro de la caja: ancla del tooltip y del punto de Ceuta/Melilla.
            "x": round((min(xs) + max(xs)) / 2, 1),
            "y": round((min(ys) + max(ys)) / 2, 1),
        }
        if ine in DOTS:
            entry["dot"] = True
        provinces.append(entry)

    provinces.sort(key=lambda item: item["id"])
    canary_height = (CANARY["north"] - CANARY["south"]) * (
        CANARY_BOX["w"] / ((CANARY["east"] - CANARY["west"]) * math.cos(math.radians(28.5)))
    )
    output = {
        "source": "Natural Earth 1:10m Admin 1 v5.1.2 (dominio público)",
        "width": WIDTH,
        "height": height,
        "canaryBox": {
            "x": CANARY_BOX["x"] - 4,
            "y": CANARY_BOX["y"] - 4,
            "w": CANARY_BOX["w"] + 8,
            "h": round(canary_height + 8, 1),
        },
        "provinces": provinces,
    }
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(provinces)} provincias -> {target}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
