"""Límite de descarga; el endpoint oficial se añadirá tras verificar su contrato."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class DownloadedDataset:
    """Contenido y metadatos mínimos conservados tras una descarga."""

    content: bytes
    source_url: str
    retrieved_at: datetime
    media_type: str | None = None


class DatasetDownloader(Protocol):
    """Puerto para una futura implementación de descarga oficial."""

    def download(self) -> DownloadedDataset:
        """Descargar el conjunto oficial sin interpretar su formato."""
        ...
