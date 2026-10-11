from decimal import Decimal

import pytest
from pydantic import ValidationError

from fuelshift_data.models import Coordinates, FuelCode, FuelPrice, Station
from fuelshift_data.validation import validate_stations


def station_data() -> dict[str, object]:
    return {
        "station_id": "4375",
        "province_id": "02",
        "municipality_id": "52",
        "province": "Provincia de prueba",
        "municipality": "Municipio de prueba",
        "locality": "Localidad de prueba",
        "postal_code": "00000",
        "address": "Calle de prueba, 1",
        "coordinates": {"latitude": "40.0", "longitude": "-3.0"},
        "brand": "Rótulo de prueba",
        "opening_hours": "Horario de prueba",
        "prices": [{"product": "diesel_a", "amount": "1.500"}],
    }


def test_station_accepts_verified_official_catalog_fields() -> None:
    station = Station.model_validate(station_data())

    assert station.postal_code == "00000"
    assert station.prices[0].amount == Decimal("1.500")


@pytest.mark.parametrize("amount", [Decimal("0"), Decimal("-0.001")])
def test_fuel_price_rejects_non_positive_amounts(amount: Decimal) -> None:
    with pytest.raises(ValidationError):
        FuelPrice(product=FuelCode.DIESEL_A, amount=amount)


def test_fuel_price_does_not_claim_an_individual_timestamp() -> None:
    price = FuelPrice(product=FuelCode.DIESEL_A, amount=Decimal("1.500"))

    assert "observed_at" not in price.model_fields_set


def test_station_rejects_unknown_fields() -> None:
    data = station_data()
    data["campo_no_verificado"] = "no permitido"

    with pytest.raises(ValidationError):
        Station.model_validate(data)


def test_validate_stations_returns_an_immutable_collection() -> None:
    stations = validate_stations([station_data()])

    assert isinstance(stations, tuple)
    assert stations[0].municipality == "Municipio de prueba"


def test_coordinates_keep_decimal_precision() -> None:
    coordinates = Coordinates(latitude="39.211417", longitude="-1.539167")

    assert coordinates.latitude == Decimal("39.211417")
