"""Modelos normalizados e independientes del formato bruto de MITECO."""

from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    """Configuración común que evita aceptar datos desconocidos en silencio."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class Coordinates(StrictModel):
    """Coordenadas WGS84 validadas."""

    latitude: Decimal = Field(ge=-90, le=90)
    longitude: Decimal = Field(ge=-180, le=180)


class FuelCode(StrEnum):
    """Códigos estables que conservan cada producto diferenciado por MITECO."""

    ADBLUE = "adblue"
    AMMONIA = "ammonia"
    BIODIESEL = "biodiesel"
    BIOETHANOL = "bioethanol"
    COMPRESSED_NATURAL_BIOGAS = "compressed_natural_biogas"
    LIQUEFIED_NATURAL_BIOGAS = "liquefied_natural_biogas"
    RENEWABLE_DIESEL = "renewable_diesel"
    COMPRESSED_NATURAL_GAS = "compressed_natural_gas"
    LIQUEFIED_NATURAL_GAS = "liquefied_natural_gas"
    LIQUEFIED_PETROLEUM_GAS = "liquefied_petroleum_gas"
    DIESEL_A = "diesel_a"
    DIESEL_B = "diesel_b"
    PREMIUM_DIESEL = "premium_diesel"
    GASOLINE_95_E10 = "gasoline_95_e10"
    GASOLINE_95_E25 = "gasoline_95_e25"
    GASOLINE_95_E5 = "gasoline_95_e5"
    PREMIUM_GASOLINE_95_E5 = "premium_gasoline_95_e5"
    GASOLINE_95_E85 = "gasoline_95_e85"
    GASOLINE_98_E10 = "gasoline_98_e10"
    GASOLINE_98_E5 = "gasoline_98_e5"
    RENEWABLE_GASOLINE = "renewable_gasoline"
    HYDROGEN = "hydrogen"
    METHANOL = "methanol"


class FuelPrice(StrictModel):
    """Precio vigente sin atribuirle una fecha individual inexistente en la fuente."""

    product: FuelCode
    amount: Decimal = Field(gt=0)


class Station(StrictModel):
    """Instalación terrestre publicable e identificada de forma estable."""

    station_id: str = Field(pattern=r"^\d+$")
    province_id: str = Field(pattern=r"^\d{2}$")
    municipality_id: str = Field(pattern=r"^\d+$")
    province: str = Field(min_length=1)
    municipality: str = Field(min_length=1)
    locality: str | None = Field(default=None, min_length=1)
    postal_code: str = Field(pattern=r"^\d{5}$")
    address: str = Field(min_length=1)
    coordinates: Coordinates
    brand: str | None = Field(default=None, min_length=1)
    opening_hours: str | None = Field(default=None, min_length=1)
    prices: tuple[FuelPrice, ...] = Field(min_length=1)

    @field_validator("prices")
    @classmethod
    def require_unique_products(cls, value: tuple[FuelPrice, ...]) -> tuple[FuelPrice, ...]:
        products = [price.product for price in value]
        if len(products) != len(set(products)):
            raise ValueError("una estación no puede repetir un producto")
        return value
