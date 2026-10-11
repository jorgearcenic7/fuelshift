import json
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from fuelshift_data.download import DownloadedDataset
from fuelshift_data.exceptions import PublicationError, QualityGateError, SourceContractError
from fuelshift_data.generation import PublicationMetadata, publish_static_dataset
from fuelshift_data.normalization import normalize_dataset, parse_source_payload
from fuelshift_data.pipeline import run_ingestion
from fuelshift_data.validation import QualityThresholds, assess_quality


def encode(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def permissive_thresholds() -> QualityThresholds:
    return QualityThresholds(
        minimum_station_count=1,
        maximum_rejection_ratio=Decimal("0.50"),
        maximum_station_drop_ratio=Decimal("0.20"),
    )


def test_sudden_station_drop_fails_quality_gate(payload_factory) -> None:
    result = normalize_dataset(parse_source_payload(encode(payload_factory())))

    with pytest.raises(QualityGateError, match="descenso"):
        assess_quality(result, previous_station_count=3, thresholds=permissive_thresholds())


def test_generation_is_deterministic_and_split_by_province(payload_factory, tmp_path) -> None:
    source = parse_source_payload(encode(payload_factory()))
    result = normalize_dataset(source)
    quality = assess_quality(
        result, previous_station_count=None, thresholds=permissive_thresholds()
    )
    metadata = PublicationMetadata(
        retrieved_at=datetime(2026, 10, 11, 14, 43, 50, tzinfo=UTC),
        source_reported_at_raw=source.reported_at_raw,
        source_reported_at_local=source.reported_at_local,
        quality=quality,
    )
    first = tmp_path / "first"
    second = tmp_path / "second"

    first_summary = publish_static_dataset(result.stations, metadata, first)
    second_summary = publish_static_dataset(result.stations, metadata, second)

    assert first_summary.province_file_count == 2
    assert second_summary.total_bytes == first_summary.total_bytes
    first_files = {path.relative_to(first): path.read_bytes() for path in first.rglob("*.json")}
    second_files = {path.relative_to(second): path.read_bytes() for path in second.rglob("*.json")}
    assert first_files == second_files
    manifest = json.loads((first / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == "1.0.0"
    assert manifest["station_count"] == 2
    assert [item["id"] for item in manifest["provinces"]] == ["02", "03"]
    province = json.loads((first / "provinces" / "02.json").read_text(encoding="utf-8"))
    assert province["stations"][0]["id"] == "4375"
    assert province["stations"][0]["fuels"]["diesel_a"] == "1.799"


class FakeDownloader:
    def __init__(self, content: bytes) -> None:
        self.content = content

    def download(self) -> DownloadedDataset:
        return DownloadedDataset(
            content=self.content,
            source_url="https://example.invalid/fixture",
            retrieved_at=datetime(2026, 10, 11, 14, 43, 50, tzinfo=UTC),
            media_type="application/json",
        )


def test_failed_ingestion_preserves_last_valid_dataset(payload_factory, tmp_path) -> None:
    destination = tmp_path / "published"
    destination.mkdir()
    previous_manifest = b'{"schema_version":"1.0.0","station_count":2}\n'
    (destination / "manifest.json").write_bytes(previous_manifest)
    (destination / "sentinel.json").write_text('{"valid":true}\n', encoding="utf-8")
    payload = payload_factory()
    payload["ResultadoConsulta"] = "ERROR"

    with pytest.raises(SourceContractError):
        run_ingestion(
            destination,
            downloader=FakeDownloader(encode(payload)),
            thresholds=permissive_thresholds(),
        )

    assert (destination / "manifest.json").read_bytes() == previous_manifest
    assert (destination / "sentinel.json").read_text(encoding="utf-8") == '{"valid":true}\n'


def test_failed_generation_preserves_last_valid_dataset(payload_factory, tmp_path) -> None:
    source = parse_source_payload(encode(payload_factory()))
    result = normalize_dataset(source)
    quality = assess_quality(
        result, previous_station_count=None, thresholds=permissive_thresholds()
    )
    metadata = PublicationMetadata(
        retrieved_at=datetime(2026, 10, 11, 14, 43, 50, tzinfo=UTC),
        source_reported_at_raw=source.reported_at_raw,
        source_reported_at_local=source.reported_at_local,
        quality=quality,
    )
    destination = tmp_path / "published"
    destination.mkdir()
    sentinel = destination / "sentinel.json"
    sentinel.write_text('{"valid":true}\n', encoding="utf-8")
    contradictory = result.stations[0].model_copy(update={"province": "OTRA"})

    with pytest.raises(PublicationError, match="nombres contradictorios"):
        publish_static_dataset((*result.stations, contradictory), metadata, destination)

    assert sentinel.read_text(encoding="utf-8") == '{"valid":true}\n'
    assert sorted(path.name for path in destination.iterdir()) == ["sentinel.json"]
