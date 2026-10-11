from datetime import UTC, datetime
from email.message import Message
from io import BytesIO
from urllib.error import HTTPError, URLError

import pytest

from fuelshift_data.download import HttpClientConfig, MitecoHttpClient
from fuelshift_data.exceptions import DownloadError


class FakeResponse(BytesIO):
    def __init__(
        self,
        content: bytes,
        *,
        status: int = 200,
        content_type: str = "application/json; charset=utf-8",
    ) -> None:
        super().__init__(content)
        self.status = status
        self.headers = Message()
        self.headers["Content-Type"] = content_type

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def test_http_client_downloads_json_once(valid_payload_path) -> None:
    content = valid_payload_path.read_bytes()
    calls: list[tuple[object, float]] = []

    def opener(request, timeout):
        calls.append((request, timeout))
        return FakeResponse(content)

    now = datetime(2026, 10, 11, 14, 43, 50, tzinfo=UTC)
    client = MitecoHttpClient(opener=opener, now=lambda: now)

    downloaded = client.download()

    assert downloaded.content == content
    assert downloaded.retrieved_at == now
    assert downloaded.media_type == "application/json"
    assert len(calls) == 1
    assert calls[0][0].get_header("Accept") == "application/json"


def test_http_client_retries_transient_network_errors(valid_payload_path) -> None:
    outcomes = [URLError("temporal"), FakeResponse(valid_payload_path.read_bytes())]
    sleeps: list[float] = []

    def opener(_request, *, timeout):
        assert timeout == 45.0
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    client = MitecoHttpClient(
        config=HttpClientConfig(max_attempts=2, backoff_seconds=0.25),
        opener=opener,
        sleeper=sleeps.append,
    )

    assert client.download().content
    assert sleeps == [0.25]


def test_http_client_reports_http_error_without_retrying_client_error() -> None:
    calls = 0

    def opener(request, *, timeout):
        assert timeout == 45.0
        nonlocal calls
        calls += 1
        raise HTTPError(request.full_url, 404, "not found", {}, None)

    client = MitecoHttpClient(config=HttpClientConfig(max_attempts=3), opener=opener)

    with pytest.raises(DownloadError, match="HTTP 404"):
        client.download()

    assert calls == 1


def test_http_client_reports_timeout_after_limited_retries() -> None:
    calls = 0

    def opener(_request, **_kwargs):
        nonlocal calls
        calls += 1
        raise TimeoutError("agotado")

    client = MitecoHttpClient(
        config=HttpClientConfig(max_attempts=2, backoff_seconds=0),
        opener=opener,
    )

    with pytest.raises(DownloadError, match="tras 2 intento"):
        client.download()

    assert calls == 2


def test_http_client_rejects_non_json_response() -> None:
    client = MitecoHttpClient(
        opener=lambda _request, **_kwargs: FakeResponse(b"ok", content_type="text/plain")
    )

    with pytest.raises(DownloadError, match="Content-Type"):
        client.download()
