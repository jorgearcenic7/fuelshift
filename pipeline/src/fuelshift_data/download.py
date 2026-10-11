"""Cliente HTTP para el conjunto nacional de estaciones terrestres de MITECO."""

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fuelshift_data.exceptions import DownloadError

MITECO_STATIONS_URL = (
    "https://energia.serviciosmin.gob.es/ServiciosRestCarburantes/"
    "PreciosCarburantes/EstacionesTerrestres/"
)
DEFAULT_USER_AGENT = "FuelShift/0.1 (+https://github.com/jorgearcenic7/fuelshift)"


@dataclass(frozen=True, slots=True)
class DownloadedDataset:
    """Contenido y metadatos mínimos conservados tras una descarga."""

    content: bytes
    source_url: str
    retrieved_at: datetime
    media_type: str | None = None


@dataclass(frozen=True, slots=True)
class HttpClientConfig:
    """Límites de red conservadores para una única descarga nacional."""

    timeout_seconds: float = 45.0
    max_attempts: int = 3
    backoff_seconds: float = 1.0
    maximum_response_bytes: int = 50 * 1024 * 1024

    def __post_init__(self) -> None:
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds debe ser positivo")
        if not 1 <= self.max_attempts <= 5:
            raise ValueError("max_attempts debe estar entre 1 y 5")
        if self.backoff_seconds < 0:
            raise ValueError("backoff_seconds no puede ser negativo")
        if self.maximum_response_bytes <= 0:
            raise ValueError("maximum_response_bytes debe ser positivo")


class DatasetDownloader(Protocol):
    """Puerto de descarga para desacoplar las pruebas de la red."""

    def download(self) -> DownloadedDataset:
        """Descargar el conjunto oficial sin interpretar su formato."""
        ...


class ResponseLike(Protocol):
    """Parte de la respuesta HTTP utilizada por el cliente."""

    status: int
    headers: Any

    def read(self, amount: int = -1) -> bytes: ...

    def __enter__(self) -> "ResponseLike": ...

    def __exit__(self, *args: object) -> object: ...


class MitecoHttpClient:
    """Descarga el conjunto completo con reintentos acotados y sin caché local."""

    def __init__(
        self,
        *,
        config: HttpClientConfig | None = None,
        opener: Callable[..., ResponseLike] = urlopen,
        sleeper: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._config = config or HttpClientConfig()
        self._opener = opener
        self._sleeper = sleeper
        self._now = now or (lambda: datetime.now(UTC))

    def download(self) -> DownloadedDataset:
        """Realizar como máximo una petición correcta, reintentando solo fallos transitorios."""

        request = Request(
            MITECO_STATIONS_URL,
            headers={"Accept": "application/json", "User-Agent": DEFAULT_USER_AGENT},
            method="GET",
        )

        for attempt in range(1, self._config.max_attempts + 1):
            try:
                return self._perform_request(request)
            except HTTPError as error:
                retryable = error.code == 429 or 500 <= error.code < 600
                if not retryable or attempt == self._config.max_attempts:
                    raise DownloadError(
                        f"MITECO respondió con HTTP {error.code} tras {attempt} intento(s)"
                    ) from error
            except (TimeoutError, URLError, OSError) as error:
                if attempt == self._config.max_attempts:
                    raise DownloadError(
                        f"No se pudo descargar MITECO tras {attempt} intento(s): {error}"
                    ) from error

            self._sleeper(self._config.backoff_seconds * (2 ** (attempt - 1)))

        raise AssertionError("bucle de reintentos inalcanzable")

    def _perform_request(self, request: Request) -> DownloadedDataset:
        with self._opener(request, timeout=self._config.timeout_seconds) as response:
            status = getattr(response, "status", None)
            if status != 200:
                raise DownloadError(f"MITECO respondió con un estado HTTP inesperado: {status}")

            media_type = _media_type(response.headers)
            if media_type != "application/json":
                raise DownloadError(
                    f"MITECO devolvió un Content-Type inesperado: {media_type or 'ausente'}"
                )

            content = response.read(self._config.maximum_response_bytes + 1)
            if len(content) > self._config.maximum_response_bytes:
                raise DownloadError(
                    "La respuesta de MITECO supera el límite configurado de "
                    f"{self._config.maximum_response_bytes} bytes"
                )
            if not content:
                raise DownloadError("MITECO devolvió una respuesta vacía")

        retrieved_at = self._now()
        if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
            raise DownloadError("El reloj de descarga debe proporcionar una fecha con zona horaria")

        return DownloadedDataset(
            content=content,
            source_url=MITECO_STATIONS_URL,
            retrieved_at=retrieved_at.astimezone(UTC),
            media_type=media_type,
        )


def _media_type(headers: Any) -> str | None:
    if hasattr(headers, "get_content_type"):
        return str(headers.get_content_type()).lower()
    value = headers.get("Content-Type") if hasattr(headers, "get") else None
    if not value:
        return None
    return str(value).partition(";")[0].strip().lower()
