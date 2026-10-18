"""Orquestación de la ingesta oficial completa."""

import logging
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter

from fuelshift_data.download import DatasetDownloader, MitecoHttpClient
from fuelshift_data.generation import PublicationMetadata, publish_static_dataset
from fuelshift_data.normalization import normalize_dataset, parse_source_payload
from fuelshift_data.validation import (
    QualityThresholds,
    assess_quality,
    read_previous_station_count,
)

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class IngestionReport:
    """Resultado observable de una ejecución completa."""

    source_station_count: int
    accepted_station_count: int
    rejected_station_count: int
    rejection_reasons: dict[str, int]
    downloaded_bytes: int
    output_bytes: int
    province_file_count: int
    duration_seconds: float
    destination: Path
    source_reported_at_raw: str

    def as_dict(self) -> dict[str, object]:
        return {
            "accepted_station_count": self.accepted_station_count,
            "destination": str(self.destination),
            "downloaded_bytes": self.downloaded_bytes,
            "duration_seconds": round(self.duration_seconds, 3),
            "output_bytes": self.output_bytes,
            "province_file_count": self.province_file_count,
            "rejected_station_count": self.rejected_station_count,
            "rejection_reasons": self.rejection_reasons,
            "source_reported_at": self.source_reported_at_raw,
            "source_station_count": self.source_station_count,
        }


def run_ingestion(
    destination: Path,
    *,
    downloader: DatasetDownloader | None = None,
    thresholds: QualityThresholds | None = None,
) -> IngestionReport:
    """Descargar una vez, validar por completo y publicar solo un conjunto aceptable."""

    started_at = perf_counter()
    active_downloader = downloader or MitecoHttpClient()
    active_thresholds = thresholds or QualityThresholds()

    downloaded = active_downloader.download()
    source = parse_source_payload(downloaded.content)
    normalized = normalize_dataset(source)
    if normalized.rejections:
        rejection_reasons = Counter(rejection.reason for rejection in normalized.rejections)
        LOGGER.warning(
            "Se rechazaron %s estaciones antes del control de calidad: %s",
            len(normalized.rejections),
            dict(sorted(rejection_reasons.items())),
        )
    previous_station_count = read_previous_station_count(destination)
    quality = assess_quality(
        normalized,
        previous_station_count=previous_station_count,
        thresholds=active_thresholds,
    )

    generated = publish_static_dataset(
        normalized.stations,
        PublicationMetadata(
            retrieved_at=downloaded.retrieved_at,
            source_reported_at_raw=source.reported_at_raw,
            source_reported_at_local=source.reported_at_local,
            quality=quality,
            source_url=downloaded.source_url,
        ),
        destination,
    )

    return IngestionReport(
        source_station_count=quality.source_station_count,
        accepted_station_count=quality.accepted_station_count,
        rejected_station_count=quality.rejected_station_count,
        rejection_reasons=quality.rejection_reasons,
        downloaded_bytes=len(downloaded.content),
        output_bytes=generated.total_bytes,
        province_file_count=generated.province_file_count,
        duration_seconds=perf_counter() - started_at,
        destination=generated.destination,
        source_reported_at_raw=source.reported_at_raw,
    )
