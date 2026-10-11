import copy
import json
from collections.abc import Callable
from pathlib import Path

import pytest


@pytest.fixture
def valid_payload_path() -> Path:
    return Path(__file__).parent / "fixtures" / "miteco_valid.json"


@pytest.fixture
def valid_payload(valid_payload_path: Path) -> dict[str, object]:
    return json.loads(valid_payload_path.read_text(encoding="utf-8"))


@pytest.fixture
def payload_factory(valid_payload: dict[str, object]) -> Callable[[], dict[str, object]]:
    def factory() -> dict[str, object]:
        return copy.deepcopy(valid_payload)

    return factory
