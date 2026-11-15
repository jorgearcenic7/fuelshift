"""Muestras mensuales reales de MITECO; independientes del histórico diario.

Una consulta nacional por mes (día 1, 00:00 según la fuente), agregada por
estación con venta al público. Nunca es una media de todos los días del mes.
La caché conserva agregados, cobertura y huella de la respuesta original.
"""

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import time
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fuelshift_data.download import DEFAULT_USER_AGENT

BASE = "https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/"
SOURCE = BASE + "help"
FIRST_DATE = date(2007, 1, 1)
FIELDS = {
    "gasoline_95_e5": "Precio Gasolina 95 E5",
    "gasoline_98_e5": "Precio Gasolina 98 E5",
    "diesel_a": "Precio Gasoleo A",
}
LOGGER = logging.getLogger(__name__)


def encode(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def month_dates(end: date, start: date = FIRST_DATE) -> list[date]:
    """Solo meses completos respecto al día consultado; nunca fechas futuras."""
    if start < FIRST_DATE or start.day != 1:
        raise ValueError("El inicio debe ser un día 1 desde enero de 2007")
    result = []
    current = start
    while current <= end:
        result.append(current)
        current = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
    return result


def parse_snapshot(content: bytes, day: date, retrieved_at: str) -> dict:
    """Valida fecha, IDs y precios; media nacional ponderada por estaciones."""
    data = json.loads(content)
    if data.get("ResultadoConsulta") != "OK":
        raise ValueError("ResultadoConsulta no es OK")
    reported = datetime.strptime(data["Fecha"], "%d/%m/%Y %H:%M:%S")
    if reported.date() != day or reported.time() != datetime.min.time():
        raise ValueError("La fecha devuelta no coincide con la muestra solicitada")
    rows = data["ListaEESSPrecio"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("Respuesta sin estaciones")
    prices = defaultdict(lambda: defaultdict(list))
    counts = defaultdict(int)
    names = {}
    seen = {}
    duplicates = 0
    public_count = 0
    excluded_prices = defaultdict(int)
    for row in rows:
        station, province, municipality = (row[k] for k in ("IDEESS", "IDProvincia", "IDMunicipio"))
        if (
            not re.fullmatch(r"\d+", station)
            or not re.fullmatch(r"\d+", municipality)
            or not re.fullmatch(r"\d{2}", province)
            or not 1 <= int(province) <= 52
        ):
            raise ValueError("Identificadores inválidos")
        if station in seen:
            if seen[station] != row:
                raise ValueError(f"Estación duplicada con registros distintos: {station}")
            duplicates += 1
            continue
        seen[station] = row
        names[province] = row["Provincia"].strip()
        if not names[province]:
            raise ValueError("Provincia sin nombre")
        if row["Tipo Venta"] != "P":
            continue
        counts[province] += 1
        public_count += 1
        for fuel, field in FIELDS.items():
            raw = row[field].strip()
            if not raw:
                continue
            try:
                price = Decimal(raw.replace(",", "."))
            except InvalidOperation as error:
                raise ValueError(f"Precio inválido: {field}") from error
            if not price.is_finite() or not Decimal("0.1") <= price <= Decimal("10"):
                excluded_prices[fuel] += 1
                continue
            prices[province][fuel].append(price)
            prices["ES"][fuel].append(price)

    def means(scope: str) -> dict:
        return {
            fuel: [float(sum(values) / len(values)), len(values)]
            for fuel, values in prices[scope].items()
        }

    return {
        "schema_version": "1.0.0",
        "date": day.isoformat(),
        "reported_at": data["Fecha"],
        "retrieved_at": retrieved_at,
        "source_url": BASE + "EstacionesTerrestresHist/" + day.strftime("%d-%m-%Y"),
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
        "station_count": len(seen),
        "duplicate_row_count": duplicates,
        "excluded_prices": dict(excluded_prices),
        "public_station_count": public_count,
        "national": means("ES"),
        "provinces": {
            code: {"name": name, "station_count": counts[code], "fuels": means(code)}
            for code, name in sorted(names.items())
        },
    }


def validate_sample(sample: dict, day: date, *, minimum_stations: int = 5000) -> None:
    if datetime.strptime(sample["reported_at"], "%d/%m/%Y %H:%M:%S") != datetime.combine(
        day, datetime.min.time()
    ):
        raise ValueError("La fecha de procedencia no coincide con la muestra")
    if (
        sample["schema_version"] != "1.0.0"
        or sample["date"] != day.isoformat()
        or sample["station_count"] < minimum_stations
        or set(sample["provinces"]) != {f"{i:02}" for i in range(1, 53)}
        or sample["source_url"] != BASE + "EstacionesTerrestresHist/" + day.strftime("%d-%m-%Y")
        or not re.fullmatch(r"[a-f0-9]{64}", sample["sha256"])
        or sample["bytes"] <= 0
    ):
        raise ValueError(f"Cobertura o procedencia inválida: {day}")
    retrieved = datetime.fromisoformat(sample["retrieved_at"].replace("Z", "+00:00"))
    if retrieved.utcoffset() is None or retrieved.date() < day:
        raise ValueError("Fecha de recuperación inválida")
    if (
        sum(p["station_count"] for p in sample["provinces"].values())
        != sample["public_station_count"]
    ):
        raise ValueError("Cobertura provincial inconsistente")
    if not 0 < sample["public_station_count"] <= sample["station_count"]:
        raise ValueError("Cobertura pública inválida")
    if any(
        n > sample["public_station_count"] * 0.05
        for n in sample.get("excluded_prices", {}).values()
    ):
        raise ValueError("Más del 5 % de precios fuera de rango")
    for scope in [sample["national"], *(p["fuels"] for p in sample["provinces"].values())]:
        if set(scope) - set(FIELDS):
            raise ValueError("Combustible desconocido")
        for mean, count in scope.values():
            if not isinstance(count, int) or not 0 < count <= sample["public_station_count"]:
                raise ValueError("Recuento inválido")
            if not isinstance(mean, (int, float)) or not 0.1 <= mean <= 10:
                raise ValueError("Media inválida")
    for fuel in FIELDS:
        national = sample["national"].get(fuel)
        provinces = [p["fuels"][fuel] for p in sample["provinces"].values() if fuel in p["fuels"]]
        if not national or national[1] != sum(p[1] for p in provinces):
            raise ValueError("Recuento nacional inconsistente")
        if abs(national[0] - sum(p[0] * p[1] for p in provinces) / national[1]) > 1e-9:
            raise ValueError("Media nacional inconsistente")


def download(day: date, *, opener=urlopen, sleeper=time.sleep) -> bytes:
    request = Request(
        BASE + "EstacionesTerrestresHist/" + day.strftime("%d-%m-%Y"),
        headers={"Accept": "application/json", "User-Agent": DEFAULT_USER_AGENT},
    )
    for attempt in range(3):
        try:
            with opener(request, timeout=60) as response:
                if response.status != 200:
                    raise ValueError(f"HTTP inesperado: {response.status}")
                if response.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("La respuesta no es JSON")
                content = response.read(50 * 1024 * 1024 + 1)
                if not content or len(content) > 50 * 1024 * 1024:
                    raise ValueError("Tamaño de respuesta inválido")
                return content
        except HTTPError as error:
            if error.code != 429 and not 500 <= error.code < 600:
                raise
            if attempt == 2:
                raise
            retry_after = error.headers.get("Retry-After", "0") if error.headers else "0"
            sleeper(
                max(2 ** (attempt + 1), min(int(retry_after), 120) if retry_after.isdigit() else 0)
            )
        except (URLError, TimeoutError, OSError):
            if attempt == 2:
                raise
            sleeper(2 ** (attempt + 1))
    raise AssertionError("Inalcanzable")


def publish(samples: list[dict], output: Path, end: date) -> None:
    """Generaciones inmutables y manifiesto atómico: un fallo conserva la anterior."""
    dates = month_dates(end)
    by_date = {}
    for sample in samples:
        day = date.fromisoformat(sample["date"])
        validate_sample(sample, day)
        if day not in dates or day in by_date:
            raise ValueError("Fecha de muestra duplicada o fuera del periodo")
        by_date[day] = sample
    if not samples:
        raise ValueError("No hay muestras válidas")
    samples = sorted(samples, key=lambda s: s["date"])
    generation = hashlib.sha256(encode(samples)).hexdigest()[:20]
    root = output / "sets" / generation
    scopes = [{"id": "ES", "name": "España"}] + [
        {"id": code, "name": value["name"]} for code, value in samples[-1]["provinces"].items()
    ]
    retrieved_at = max(s["retrieved_at"] for s in samples)
    for scope in scopes:
        for fuel in FIELDS:
            observations = []
            for day in dates:
                sample = by_date.get(day)
                fuels = (
                    (
                        sample["national"]
                        if scope["id"] == "ES"
                        else sample["provinces"][scope["id"]]["fuels"]
                    )
                    if sample
                    else {}
                )
                price, count = fuels.get(fuel, [None, 0])
                observations.append([day.isoformat(), round(price, 5) if price else None, count])
            payload = {
                "schema_version": "1.0.0",
                "scope": scope["id"],
                "fuel": fuel,
                "frequency": "monthly-snapshot",
                "unit": "EUR/L",
                "observations": observations,
            }
            atomic_write(root / scope["id"] / f"{fuel}.json", encode(payload))
    atomic_write(root / "provenance.json", encode(samples))
    manifest = {
        "schema_version": "1.0.0",
        "generation": generation,
        "frequency": "monthly-snapshot",
        "unit": "EUR/L",
        "sample_day": 1,
        "first_date": dates[0].isoformat(),
        "last_date": dates[-1].isoformat(),
        "retrieved_at": retrieved_at,
        "source_url": SOURCE,
        "scopes": scopes,
        "fuels": list(FIELDS),
        "sample_count": len(samples),
        "expected_count": len(dates),
    }
    previous = output / "manifest.json"
    if previous.exists():
        old = json.loads(previous.read_bytes())
        if old["last_date"] > manifest["last_date"] or old["sample_count"] > len(samples):
            raise ValueError("La actualización perdería muestras publicadas")
        old_generation = old["generation"]
        if not re.fullmatch(r"[a-f0-9]{20}", old_generation):
            raise ValueError("Generación anterior inválida")
        old_samples = json.loads(
            (output / "sets" / old_generation / "provenance.json").read_bytes()
        )
        if not {s["date"] for s in old_samples} <= {s["date"] for s in samples}:
            raise ValueError("La actualización perdería fechas publicadas")
    atomic_write(previous, encode(manifest))


def restore_published(output: Path, cache: Path) -> None:
    manifest = output / "manifest.json"
    if not manifest.exists():
        return
    generation = json.loads(manifest.read_bytes())["generation"]
    if not re.fullmatch(r"[a-f0-9]{20}", generation):
        raise ValueError("Generación inválida")
    samples = json.loads((output / "sets" / generation / "provenance.json").read_bytes())
    if hashlib.sha256(encode(samples)).hexdigest()[:20] != generation:
        raise ValueError("La huella de procedencia no coincide con la generación")
    for sample in samples:
        day = date.fromisoformat(sample["date"])
        validate_sample(sample, day)
        target = cache / f"{day}.json"
        if not target.exists():
            atomic_write(target, encode(sample))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--end", type=date.fromisoformat, default=datetime.now(UTC).date())
    parser.add_argument("--cache", type=Path, default=Path("data/cache/miteco-monthly"))
    parser.add_argument("--output", type=Path, default=Path("public/data/historico-miteco"))
    parser.add_argument("--pause", type=float, default=2.0)
    parser.add_argument("--max-downloads", type=int, default=3)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--restore-from", type=Path)
    parser.add_argument("--restore-only", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        if args.pause < 1 or args.max_downloads < 0 or args.end > datetime.now(UTC).date():
            raise ValueError("Límites o fecha de consulta inválidos")
        restore_published(args.output, args.cache)
        if args.restore_from:
            restore_published(args.restore_from, args.cache)
        if args.restore_only:
            return 0
        samples = []
        downloads = 0
        missing = []
        for day in month_dates(args.end):
            target = args.cache / f"{day}.json"
            if not target.exists() and not args.offline and downloads < args.max_downloads:
                time.sleep(args.pause)
                content = download(day)
                sample = parse_snapshot(content, day, datetime.now(UTC).isoformat())
                validate_sample(sample, day)
                atomic_write(target, encode(sample))
                downloads += 1
                LOGGER.info(
                    "%s: %s estaciones (%s bytes)", day, sample["station_count"], len(content)
                )
            if target.exists():
                sample = json.loads(target.read_bytes())
                validate_sample(sample, day)
                samples.append(sample)
            else:
                missing.append(day)
        # El primer bootstrap necesita permiso explícito para el volumen (--max-downloads).
        # No sustituir el publicado por una reconstrucción incompleta o fallida.
        if missing and not args.offline:
            raise ValueError(
                f"Faltan {len(missing)} meses; caché conservada. Amplía --max-downloads"
            )
        publish(samples, args.output, args.end)
        LOGGER.info("Publicadas %s/%s muestras mensuales", len(samples), len(month_dates(args.end)))
        return 0
    except (ValueError, KeyError, TypeError, OSError, URLError) as error:
        LOGGER.error("Histórico no actualizado; se conserva el anterior: %s", error)
        return 1


if __name__ == "__main__":
    sys.exit(main())
