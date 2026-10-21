"""El conjunto que publica el pipeline cumple el contrato compartido de contracts/."""

import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from fuelshift_data.generation import PublicationMetadata, publish_static_dataset
from fuelshift_data.normalization import normalize_dataset, parse_source_payload
from fuelshift_data.validation import QualityThresholds, assess_quality

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
SCHEMA_NAMES = [
    "miteco-manifest",
    "miteco-province",
    "history-record",
    "history-national",
    "history-province",
]
EXAMPLES = {
    "miteco/manifest.json": "miteco-manifest",
    "miteco/provinces/28.json": "miteco-province",
    "historico/diario/2026-10-11.json": "history-record",
    "historico/nacional.json": "history-national",
    "historico/provincias/28.json": "history-province",
}


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(read_json(CONTRACTS / "schemas" / f"{name}.schema.json"))


def errors(name: str, document: object) -> list[str]:
    return [
        f"{'/'.join(map(str, error.absolute_path))}: {error.message}"
        for error in validator(name).iter_errors(document)
    ]


@pytest.mark.parametrize("name", SCHEMA_NAMES)
def test_schemas_are_valid_draft_2020_12(name: str) -> None:
    Draft202012Validator.check_schema(read_json(CONTRACTS / "schemas" / f"{name}.schema.json"))


@pytest.mark.parametrize(("example", "name"), EXAMPLES.items())
def test_examples_follow_their_schema(example: str, name: str) -> None:
    assert errors(name, read_json(CONTRACTS / "examples" / example)) == []


def test_published_dataset_follows_the_contract(payload_factory, tmp_path) -> None:
    payload = payload_factory()
    source = parse_source_payload(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    result = normalize_dataset(source)
    quality = assess_quality(
        result,
        previous_station_count=None,
        thresholds=QualityThresholds(
            minimum_station_count=1,
            maximum_rejection_ratio=Decimal("0.50"),
            maximum_station_drop_ratio=Decimal("0.20"),
        ),
    )
    metadata = PublicationMetadata(
        retrieved_at=datetime(2026, 10, 11, 14, 43, 50, tzinfo=UTC),
        source_reported_at_raw=source.reported_at_raw,
        source_reported_at_local=source.reported_at_local,
        quality=quality,
    )
    destination = tmp_path / "miteco"
    publish_static_dataset(result.stations, metadata, destination)

    manifest = read_json(destination / "manifest.json")
    assert errors("miteco-manifest", manifest) == []
    for province in manifest["provinces"]:
        assert errors("miteco-province", read_json(destination / province["file"])) == []


def test_schema_rejects_fields_outside_the_contract() -> None:
    station = read_json(CONTRACTS / "examples" / "miteco" / "provinces" / "28.json")
    station["stations"][0]["undeclared"] = True
    station["stations"][1]["locality"] = ""

    reported = errors("miteco-province", station)

    assert any("undeclared" in message for message in reported)
    assert any(message.startswith("stations/1/locality") for message in reported)
