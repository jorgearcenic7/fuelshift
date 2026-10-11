"""Modelos normalizados basados en variables publicadas por MITECO.

Estos modelos no representan todavía el contrato bruto del servicio REST.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    """Configuración común para rechazar campos aún no verificados."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class Coordinates(StrictModel):
    """Coordenadas geográficas publicadas para una instalación."""

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class FuelPrice(StrictModel):
    """Precio vigente observado para un producto publicado por MITECO."""

    product: str = Field(min_length=1)
    amount: Decimal = Field(gt=0)
    observed_at: datetime

    @field_validator("observed_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("observed_at debe incluir zona horaria")
        return value


class Station(StrictModel):
    """Instalación de suministro normalizada con campos del catálogo oficial."""

    province: str = Field(min_length=1)
    municipality: str = Field(min_length=1)
    locality: str | None = Field(default=None, min_length=1)
    postal_code: str = Field(pattern=r"^\d{5}$")
    address: str = Field(min_length=1)
    coordinates: Coordinates
    brand: str | None = Field(default=None, min_length=1)
    opening_hours: str | None = Field(default=None, min_length=1)
    prices: tuple[FuelPrice, ...] = ()
