"""Controles de calidad previos a publicar un conjunto normalizado."""

import json
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from fuelshift_data.exceptions import QualityGateError
from fuelshift_data.models import Station
from fuelshift_data.normalization import NormalizationResult


@dataclass(frozen=True, slots=True)
class QualityThresholds:
    """Umbrales iniciales ajustables desde la CLI."""

    minimum_station_count: int = 10_000
    maximum_rejection_ratio: Decimal = Decimal("0.02")
    maximum_station_drop_ratio: Decimal = Decimal("0.20")

    def __post_init__(self) -> None:
        if self.minimum_station_count < 1:
            raise ValueError("minimum_station_count debe ser positivo")
        for name, value in (
            ("maximum_rejection_ratio", self.maximum_rejection_ratio),
            ("maximum_station_drop_ratio", self.maximum_station_drop_ratio),
        ):
            if not Decimal("0") <= value < Decimal("1"):
                raise ValueError(f"{name} debe estar entre 0 y 1")


@dataclass(frozen=True, slots=True)
class QualityMetrics:
    """Métricas persistidas en el manifiesto del conjunto válido."""

    source_station_count: int
    accepted_station_count: int
    rejected_station_count: int
    rejection_ratio: Decimal
    rejection_reasons: dict[str, int]
    previous_station_count: int | None
    station_drop_ratio: Decimal | None


def validate_stations(records: Iterable[Mapping[str, object]]) -> tuple[Station, ...]:
    """Validar una colección que ya usa el contrato normalizado."""

    return tuple(Station.model_validate(record) for record in records)


def assess_quality(
    result: NormalizationResult,
    *,
    previous_station_count: int | None,
    thresholds: QualityThresholds,
) -> QualityMetrics:
    """Fallar ante vacíos, rechazos excesivos o desapariciones masivas."""

    accepted = len(result.stations)
    rejected = len(result.rejections)
    if result.source_count <= 0 or accepted <= 0:
        raise QualityGateError("El conjunto está vacío o no contiene estaciones válidas")
    if accepted < thresholds.minimum_station_count:
        raise QualityGateError(
            f"Solo hay {accepted} estaciones válidas; el mínimo es "
            f"{thresholds.minimum_station_count}"
        )

    rejection_ratio = Decimal(rejected) / Decimal(result.source_count)
    if rejection_ratio > thresholds.maximum_rejection_ratio:
        raise QualityGateError(
            f"La proporción de rechazos {rejection_ratio:.4%} supera el máximo "
            f"{thresholds.maximum_rejection_ratio:.4%}"
        )

    station_drop_ratio: Decimal | None = None
    if previous_station_count is not None:
        if previous_station_count <= 0:
            raise QualityGateError("El manifiesto anterior tiene un recuento no válido")
        if accepted < previous_station_count:
            station_drop_ratio = Decimal(previous_station_count - accepted) / Decimal(
                previous_station_count
            )
            if station_drop_ratio > thresholds.maximum_station_drop_ratio:
                raise QualityGateError(
                    f"El descenso de estaciones {station_drop_ratio:.4%} supera el máximo "
                    f"{thresholds.maximum_station_drop_ratio:.4%}"
                )

    return QualityMetrics(
        source_station_count=result.source_count,
        accepted_station_count=accepted,
        rejected_station_count=rejected,
        rejection_ratio=rejection_ratio,
        rejection_reasons=dict(sorted(Counter(item.reason for item in result.rejections).items())),
        previous_station_count=previous_station_count,
        station_drop_ratio=station_drop_ratio,
    )


def read_previous_station_count(destination: Path) -> int | None:
    """Leer el último recuento válido sin tolerar un manifiesto corrupto."""

    if not destination.exists():
        return None
    if destination.is_symlink() or not destination.is_dir():
        raise QualityGateError(f"El destino existente no es un directorio seguro: {destination}")

    manifest_path = destination / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        count = manifest["station_count"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise QualityGateError("No se puede validar el manifiesto del último conjunto") from error
    if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
        raise QualityGateError("El manifiesto anterior tiene station_count no válido")
    return count
