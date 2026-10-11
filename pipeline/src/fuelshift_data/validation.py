"""Validación de registros que ya usan el contrato normalizado de FuelShift."""

from collections.abc import Iterable, Mapping

from fuelshift_data.models import Station


def validate_stations(records: Iterable[Mapping[str, object]]) -> tuple[Station, ...]:
    """Validar todos los registros sin aceptar silenciosamente campos desconocidos."""

    return tuple(Station.model_validate(record) for record in records)
