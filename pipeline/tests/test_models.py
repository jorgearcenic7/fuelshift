from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from fuelshift_data.models import Coordinates, FuelPrice, Station
from fuelshift_data.validation import validate_stations


def test_station_accepts_verified_official_catalog_fields() -> None:
    station = Station(
        province="Provincia de prueba",
        municipality="Municipio de prueba",
        locality="Localidad de prueba",
        postal_code="00000",
        address="Calle de prueba, 1",
        coordinates=Coordinates(latitude=40.0, longitude=-3.0),
        brand="Rótulo de prueba",
        opening_hours="Horario de prueba",
        prices=(
            FuelPrice(
                product="Producto de prueba",
                amount=Decimal("1.500"),
                observed_at=datetime(2026, 1, 1, tzinfo=UTC),
            ),
        ),
    )

    assert station.postal_code == "00000"
    assert station.prices[0].amount == Decimal("1.500")


@pytest.mark.parametrize("amount", [Decimal("0"), Decimal("-0.001")])
def test_fuel_price_rejects_non_positive_amounts(amount: Decimal) -> None:
    with pytest.raises(ValidationError):
        FuelPrice(
            product="Producto de prueba",
            amount=amount,
            observed_at=datetime(2026, 1, 1, tzinfo=UTC),
        )


def test_fuel_price_requires_an_explicit_timezone() -> None:
    with pytest.raises(ValidationError):
        FuelPrice(
            product="Producto de prueba",
            amount=Decimal("1.500"),
            observed_at=datetime(2026, 1, 1),
        )


def test_station_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        Station.model_validate(
            {
                "province": "Provincia de prueba",
                "municipality": "Municipio de prueba",
                "postal_code": "00000",
                "address": "Calle de prueba, 1",
                "coordinates": {"latitude": 40.0, "longitude": -3.0},
                "campo_no_verificado": "no permitido",
            },
        )


def test_validate_stations_returns_an_immutable_collection() -> None:
    stations = validate_stations(
        [
            {
                "province": "Provincia de prueba",
                "municipality": "Municipio de prueba",
                "postal_code": "00000",
                "address": "Calle de prueba, 1",
                "coordinates": {"latitude": 40.0, "longitude": -3.0},
            },
        ],
    )

    assert isinstance(stations, tuple)
    assert stations[0].municipality == "Municipio de prueba"
