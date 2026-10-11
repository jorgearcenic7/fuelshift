"""Errores explícitos del pipeline de datos de FuelShift."""


class FuelShiftDataError(Exception):
    """Error controlado del pipeline."""


class DownloadError(FuelShiftDataError):
    """La fuente oficial no pudo descargarse de forma segura."""


class SourceContractError(FuelShiftDataError):
    """La respuesta oficial no cumple el contrato verificado."""


class QualityGateError(FuelShiftDataError):
    """El conjunto no supera los controles de calidad configurados."""


class PublicationError(FuelShiftDataError):
    """Los artefactos estáticos no pudieron validarse o publicarse."""
