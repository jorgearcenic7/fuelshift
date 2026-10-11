"""Generación determinista y publicación local transaccional de JSON."""

import hashlib
import json
import logging
import os
import shutil
import tempfile
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fuelshift_data.download import MITECO_STATIONS_URL
from fuelshift_data.exceptions import PublicationError
from fuelshift_data.models import Station
from fuelshift_data.validation import QualityMetrics

SCHEMA_VERSION = "1.0.0"
MITECO_HELP_URL = (
    "https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/PreciosCarburantes/help"
)
MITECO_CATALOG_URL = (
    "https://catalogo.datosabiertos.miteco.gob.es/catalogo/es/dataset/"
    "902a266d-5ba2-4735-a378-45818ba5a4f4"
)
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class PublicationMetadata:
    """Metadatos separados de los precios individuales."""

    retrieved_at: datetime
    source_reported_at_raw: str
    source_reported_at_local: datetime
    quality: QualityMetrics
    source_url: str = MITECO_STATIONS_URL


@dataclass(frozen=True, slots=True)
class GeneratedDatasetSummary:
    """Resumen medible de los artefactos publicados."""

    destination: Path
    province_file_count: int
    total_bytes: int


def publish_static_dataset(
    stations: Sequence[Station],
    metadata: PublicationMetadata,
    destination: Path,
) -> GeneratedDatasetSummary:
    """Generar, validar y reemplazar el destino conservando el anterior ante fallos."""

    if metadata.retrieved_at.tzinfo is None or metadata.retrieved_at.utcoffset() is None:
        raise PublicationError("retrieved_at debe incluir zona horaria")
    if destination.is_symlink():
        raise PublicationError("El destino de publicación no puede ser un enlace simbólico")

    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}-staging-", dir=parent))
    try:
        province_file_count = _write_dataset(stations, metadata, staging)
        _validate_generated_dataset(staging)
        total_bytes = sum(path.stat().st_size for path in staging.rglob("*.json"))
        _replace_directory(staging, destination)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise

    return GeneratedDatasetSummary(
        destination=destination,
        province_file_count=province_file_count,
        total_bytes=total_bytes,
    )


def _write_dataset(
    stations: Sequence[Station], metadata: PublicationMetadata, staging: Path
) -> int:
    grouped: dict[str, list[Station]] = defaultdict(list)
    for station in stations:
        grouped[station.province_id].append(station)

    provinces_directory = staging / "provinces"
    provinces_directory.mkdir()
    province_entries: list[dict[str, object]] = []
    for province_id in sorted(grouped):
        province_stations = sorted(grouped[province_id], key=lambda item: int(item.station_id))
        province_names = {station.province for station in province_stations}
        if len(province_names) != 1:
            raise PublicationError(
                f"La provincia {province_id} tiene nombres contradictorios: {province_names}"
            )
        province_name = next(iter(province_names))
        relative_path = Path("provinces") / f"{province_id}.json"
        payload = {
            "province": {"id": province_id, "name": province_name},
            "schema_version": SCHEMA_VERSION,
            "stations": [_station_payload(station) for station in province_stations],
        }
        file_bytes = _write_json(staging / relative_path, payload)
        province_entries.append(
            {
                "bytes": len(file_bytes),
                "file": relative_path.as_posix(),
                "id": province_id,
                "name": province_name,
                "sha256": hashlib.sha256(file_bytes).hexdigest(),
                "station_count": len(province_stations),
            }
        )

    quality = metadata.quality
    manifest = {
        "province_count": len(province_entries),
        "provinces": province_entries,
        "quality": {
            "accepted_station_count": quality.accepted_station_count,
            "previous_station_count": quality.previous_station_count,
            "rejected_station_count": quality.rejected_station_count,
            "rejection_ratio": format(quality.rejection_ratio, "f"),
            "rejection_reasons": quality.rejection_reasons,
            "source_station_count": quality.source_station_count,
            "station_drop_ratio": (
                format(quality.station_drop_ratio, "f")
                if quality.station_drop_ratio is not None
                else None
            ),
        },
        "retrieved_at": metadata.retrieved_at.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "schema_version": SCHEMA_VERSION,
        "source": {
            "attribution": (
                "Ministerio para la Transición Ecológica y el Reto Demográfico (MITECO)"
            ),
            "catalog": MITECO_CATALOG_URL,
            "documentation": MITECO_HELP_URL,
            "license": {"id": "CC-BY-4.0", "url": LICENSE_URL},
            "reported_at": {
                "local": metadata.source_reported_at_local.isoformat(timespec="seconds"),
                "raw": metadata.source_reported_at_raw,
                "timezone": None,
            },
            "url": metadata.source_url,
        },
        "station_count": len(stations),
    }
    _write_json(staging / "manifest.json", manifest)
    return len(province_entries)


def _station_payload(station: Station) -> dict[str, object]:
    return {
        "address": station.address,
        "brand": station.brand,
        "fuels": {
            price.product.value: format(price.amount, "f")
            for price in sorted(station.prices, key=lambda item: item.product.value)
        },
        "id": station.station_id,
        "locality": station.locality,
        "location": {
            "latitude": float(station.coordinates.latitude),
            "longitude": float(station.coordinates.longitude),
        },
        "municipality": station.municipality,
        "municipality_id": station.municipality_id,
        "opening_hours": station.opening_hours,
        "postal_code": station.postal_code,
    }


def _write_json(path: Path, payload: object) -> bytes:
    content = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"
    ).encode("utf-8")
    path.write_bytes(content)
    return content


def _validate_generated_dataset(staging: Path) -> None:
    try:
        manifest = json.loads((staging / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PublicationError("El manifest.json provisional no es válido") from error

    if manifest.get("schema_version") != SCHEMA_VERSION:
        raise PublicationError("La versión del manifiesto provisional es incorrecta")

    counted_stations = 0
    seen_ids: set[str] = set()
    for province in manifest.get("provinces", []):
        relative_path = Path(province["file"])
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise PublicationError("El manifiesto contiene una ruta de provincia insegura")
        path = staging / relative_path
        file_bytes = path.read_bytes()
        if hashlib.sha256(file_bytes).hexdigest() != province["sha256"]:
            raise PublicationError(f"No coincide el hash de {relative_path}")
        payload = json.loads(file_bytes)
        if payload.get("schema_version") != SCHEMA_VERSION:
            raise PublicationError(f"Versión incorrecta en {relative_path}")
        stations = payload.get("stations")
        if not isinstance(stations, list) or len(stations) != province["station_count"]:
            raise PublicationError(f"Recuento incorrecto en {relative_path}")
        for station in stations:
            station_id = station.get("id")
            if station_id in seen_ids:
                raise PublicationError(f"IDEESS duplicado en la salida: {station_id}")
            seen_ids.add(station_id)
        counted_stations += len(stations)

    if counted_stations != manifest.get("station_count"):
        raise PublicationError("El total del manifiesto no coincide con los archivos provinciales")


def _replace_directory(staging: Path, destination: Path) -> None:
    if destination.exists() and not destination.is_dir():
        raise PublicationError("El destino existente no es un directorio")

    backup: Path | None = None
    if destination.exists():
        backup = destination.with_name(f".{destination.name}-backup-{uuid4().hex}")
        os.replace(destination, backup)

    try:
        os.replace(staging, destination)
    except OSError as error:
        if backup is not None and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        raise PublicationError("No se pudo publicar el conjunto provisional") from error
    else:
        if backup is not None:
            try:
                shutil.rmtree(backup)
            except OSError:
                LOGGER.warning(
                    "El conjunto nuevo está publicado, pero no se pudo eliminar el respaldo %s",
                    backup,
                    exc_info=True,
                )
