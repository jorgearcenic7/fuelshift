import json
from decimal import Decimal

import pytest

from fuelshift_data.exceptions import SourceContractError
from fuelshift_data.models import FuelCode
from fuelshift_data.normalization import normalize_dataset, parse_source_payload


def encode(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def test_valid_response_uses_verified_contract(payload_factory) -> None:
    source = parse_source_payload(encode(payload_factory()))
    result = normalize_dataset(source)

    assert source.reported_at_raw == "11/10/2026 16:43:50"
    assert source.result == "OK"
    assert result.source_count == 2
    assert len(result.stations) == 2
    assert not result.rejections


def test_decimal_commas_are_normalized_without_float_rounding(payload_factory) -> None:
    result = normalize_dataset(parse_source_payload(encode(payload_factory())))
    station = result.stations[0]
    prices = {price.product: price.amount for price in station.prices}

    assert station.coordinates.latitude == Decimal("39.211417")
    assert station.coordinates.longitude == Decimal("-1.539167")
    assert prices[FuelCode.DIESEL_A] == Decimal("1.799")


def test_empty_price_is_absent_and_invalid_price_rejects_record(payload_factory) -> None:
    payload = payload_factory()
    rows = payload["ListaEESSPrecio"]
    rows[0]["Precio Adblue"] = ""
    rows[1]["Precio Gasoleo A"] = "precio-desconocido"

    result = normalize_dataset(parse_source_payload(encode(payload)))

    assert FuelCode.ADBLUE not in {price.product for price in result.stations[0].prices}
    assert len(result.stations) == 1
    assert result.rejections[0].reason == "invalid_price"


def test_non_string_optional_field_rejects_record(payload_factory) -> None:
    payload = payload_factory()
    payload["ListaEESSPrecio"][0]["Horario"] = None

    result = normalize_dataset(parse_source_payload(encode(payload)))

    assert len(result.stations) == 1
    assert result.rejections[0].reason == "invalid_field_type"


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [("0,000000", "0,000000"), ("-8,659472", "42,037472")],
)
def test_invalid_or_swapped_coordinates_are_rejected(
    payload_factory,
    latitude: str,
    longitude: str,
) -> None:
    payload = payload_factory()
    row = payload["ListaEESSPrecio"][0]
    row["Latitud"] = latitude
    row["Longitud (WGS84)"] = longitude

    result = normalize_dataset(parse_source_payload(encode(payload)))

    assert len(result.stations) == 1
    assert result.rejections[0].reason == "coordinates_outside_supported_extent"


def test_duplicate_station_identifiers_fail_the_dataset(payload_factory) -> None:
    payload = payload_factory()
    rows = payload["ListaEESSPrecio"]
    rows[1]["IDEESS"] = rows[0]["IDEESS"]

    with pytest.raises(SourceContractError, match="IDEESS duplicados"):
        normalize_dataset(parse_source_payload(encode(payload)))


@pytest.mark.parametrize("missing_key", ["ResultadoConsulta", "ListaEESSPrecio", "Fecha"])
def test_partial_root_response_is_rejected(payload_factory, missing_key: str) -> None:
    payload = payload_factory()
    del payload[missing_key]

    with pytest.raises(SourceContractError, match="raíz"):
        parse_source_payload(encode(payload))


def test_api_error_result_is_rejected(payload_factory) -> None:
    payload = payload_factory()
    payload["ResultadoConsulta"] = "ERROR"

    with pytest.raises(SourceContractError, match="ResultadoConsulta"):
        parse_source_payload(encode(payload))


def test_invalid_json_is_rejected() -> None:
    with pytest.raises(SourceContractError, match="JSON"):
        parse_source_payload(b"{not-json")


def test_unknown_product_field_fails_loudly(payload_factory) -> None:
    payload = payload_factory()
    for row in payload["ListaEESSPrecio"]:
        row["Precio Producto Futuro"] = "1,000"

    with pytest.raises(SourceContractError, match="productos no reconocidos"):
        normalize_dataset(parse_source_payload(encode(payload)))
