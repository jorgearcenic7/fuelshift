"""Límite de generación de artefactos estáticos para el frontend."""

from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

from fuelshift_data.models import Station


class StaticDatasetWriter(Protocol):
    """Puerto para escribir la salida estática una vez aprobado su esquema."""

    def write(self, stations: Sequence[Station], destination: Path) -> None:
        """Escribir estaciones validadas en el destino indicado."""
        ...
