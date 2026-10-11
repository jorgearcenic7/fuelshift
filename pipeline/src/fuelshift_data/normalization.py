"""Límite de normalización pendiente del contrato bruto de MITECO."""

from collections.abc import Mapping
from typing import Protocol

from fuelshift_data.models import Station

RawRecord = Mapping[str, object]


class StationNormalizer(Protocol):
    """Transforma un registro oficial ya descargado al modelo normalizado."""

    def normalize(self, record: RawRecord) -> Station:
        """Normalizar un registro conservando su significado oficial."""
        ...
