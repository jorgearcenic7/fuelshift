"""Pruebas locales: nunca consultan MITECO."""

import json
from copy import deepcopy
from datetime import date
from pathlib import Path
from typing import ClassVar
from urllib.error import HTTPError, URLError

import pytest

from fuelshift_data import monthly_history as history

DAY = date(2007, 1, 1)
NOW = "2026-11-15T12:00:00Z"
FIXTURE = Path(__file__).parent / "fixtures" / "miteco_history_valid.json"


def source():
    return json.loads(FIXTURE.read_bytes())


def parsed(raw=None):
    return history.parse_snapshot(history.encode(raw or source()), DAY, NOW)


def sample(day=DAY):
    result = parsed()
    fuels = {fuel: [1.25, 5200] for fuel in history.FIELDS}
    result.update(
        date=day.isoformat(),
        reported_at=day.strftime("%d/%m/%Y 0:00:00"),
        source_url=history.BASE + "EstacionesTerrestresHist/" + day.strftime("%d-%m-%Y"),
        station_count=5200,
        public_station_count=5200,
        national=fuels,
        provinces={
            f"{i:02}": {
                "name": f"Provincia {i}",
                "station_count": 100,
                "fuels": {fuel: [1.25, 100] for fuel in history.FIELDS},
            }
            for i in range(1, 53)
        },
    )
    return result


def test_fechas_limites_y_calendario():
    assert len(history.month_dates(date(2026, 11, 15))) == 239
    assert history.month_dates(date(2007, 3, 1)) == [DAY, date(2007, 2, 1), date(2007, 3, 1)]
    assert history.month_dates(date(2006, 12, 31)) == []
    with pytest.raises(ValueError):
        history.month_dates(DAY, date(2006, 1, 1))
    with pytest.raises(ValueError):
        history.month_dates(DAY, date(2007, 1, 2))


def test_parseo_media_nacional_por_estacion_y_tres_combustibles():
    result = parsed()
    assert result["station_count"] == 3
    assert set(result["national"]) == set(history.FIELDS)
    prices = [float(r["Precio Gasoleo A"].replace(",", ".")) for r in source()["ListaEESSPrecio"]]
    assert result["national"]["diesel_a"] == [pytest.approx(sum(prices) / 3), 3]
    assert result["source_url"].endswith("01-01-2007")
    assert len(result["sha256"]) == 64


def test_excluye_venta_restringida_vacios_y_precios_imposibles():
    raw = source()
    raw["ListaEESSPrecio"][0]["Tipo Venta"] = "R"
    raw["ListaEESSPrecio"][1]["Precio Gasolina 98 E5"] = ""
    raw["ListaEESSPrecio"][2]["Precio Gasolina 95 E5"] = "0,000"
    result = parsed(raw)
    assert result["public_station_count"] == 2
    assert result["national"]["gasoline_98_e5"][1] == 1
    assert result["national"]["gasoline_95_e5"][1] == 1
    assert result["excluded_prices"] == {"gasoline_95_e5": 1}


def test_duplicados_identicos_no_sesgan_y_conflictos_se_rechazan():
    raw = source()
    raw["ListaEESSPrecio"].append(deepcopy(raw["ListaEESSPrecio"][0]))
    assert parsed(raw)["duplicate_row_count"] == 1
    assert parsed(raw)["national"] == parsed()["national"]
    raw["ListaEESSPrecio"][-1]["Precio Gasoleo A"] = "1,200"
    with pytest.raises(ValueError, match="duplicada"):
        parsed(raw)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda s: s.update(Fecha="02/01/2007 0:00:00"),
        lambda s: s.update(ResultadoConsulta="Error"),
        lambda s: s.update(ListaEESSPrecio=[]),
        lambda s: s["ListaEESSPrecio"][0].update(IDProvincia="99"),
        lambda s: s["ListaEESSPrecio"][0].update(IDEESS="../12"),
        lambda s: s["ListaEESSPrecio"][0].update({"Precio Gasoleo A": "texto"}),
    ],
)
def test_rechaza_contratos_rotos(mutation):
    raw = source()
    mutation(raw)
    with pytest.raises(ValueError):
        parsed(raw)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda s: s.update(station_count=1),
        lambda s: s["provinces"].pop("28"),
        lambda s: s.update(retrieved_at="2006-12-01T00:00:00Z"),
        lambda s: s.update(public_station_count=5000),
        lambda s: s["national"]["diesel_a"].__setitem__(0, 2),
        lambda s: s["national"]["diesel_a"].__setitem__(1, 5199),
        lambda s: s.update(excluded_prices={"diesel_a": 1000}),
    ],
)
def test_control_cobertura_y_calculos(mutation):
    value = sample()
    history.validate_sample(value, DAY)
    mutation(value)
    with pytest.raises(ValueError):
        history.validate_sample(value, DAY)


def test_publicacion_huecos_y_conservacion_transaccional(tmp_path, monkeypatch):
    output = tmp_path / "output"
    history.publish([sample()], output, date(2007, 3, 1))
    manifest = (output / "manifest.json").read_bytes()
    m = json.loads(manifest)
    series = json.loads((output / "sets" / m["generation"] / "ES/diesel_a.json").read_bytes())
    assert series["observations"] == [
        ["2007-01-01", 1.25, 5200],
        ["2007-02-01", None, 0],
        ["2007-03-01", None, 0],
    ]
    assert m["sample_count"] == 1 and m["expected_count"] == 3
    original = history.atomic_write

    def fail(path, content):
        if path.name == "provenance.json":
            raise OSError("Fallo de disco")
        original(path, content)

    monkeypatch.setattr(history, "atomic_write", fail)
    with pytest.raises(OSError):
        history.publish([sample(), sample(date(2007, 2, 1))], output, date(2007, 3, 1))
    assert (output / "manifest.json").read_bytes() == manifest


def test_no_pierde_muestras_publicadas(tmp_path):
    history.publish([sample(), sample(date(2007, 2, 1))], tmp_path, date(2007, 2, 1))
    before = (tmp_path / "manifest.json").read_bytes()
    with pytest.raises(ValueError, match="perdería"):
        history.publish([sample()], tmp_path, date(2007, 2, 1))
    assert (tmp_path / "manifest.json").read_bytes() == before


def test_cli_incremental_cero_red_restaura_base(tmp_path, monkeypatch):
    output, cache = tmp_path / "output", tmp_path / "cache"
    history.publish([sample()], output, DAY)
    monkeypatch.setattr(history, "download", lambda day: pytest.fail("No debe repetir la descarga"))
    args = ["--end", str(DAY), "--output", str(output), "--cache", str(cache)]
    assert history.main(args) == 0
    assert (cache / f"{DAY}.json").exists()
    assert history.main([*args, "--end", "2007-02-01", "--max-downloads", "0"]) == 1
    assert json.loads((output / "manifest.json").read_bytes())["last_date"] == str(DAY)


class Response:
    status = 200
    headers: ClassVar = {"Content-Type": "application/json; charset=utf-8"}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, amount):
        return b"{}"


def test_descarga_reintentos_pausa_y_http_no_recuperable():
    calls, sleeps = [], []

    def opener(request, timeout):
        calls.append(request.full_url)
        if len(calls) == 1:
            raise HTTPError(request.full_url, 429, "slow", {"Retry-After": "7"}, None)
        if len(calls) == 2:
            raise URLError("temporal")
        return Response()

    assert history.download(DAY, opener=opener, sleeper=sleeps.append) == b"{}"
    assert len(calls) == 3 and sleeps == [7, 4]

    def bad(request, **kwargs):
        raise HTTPError(request.full_url, 400, "fecha inválida", {}, None)

    with pytest.raises(HTTPError):
        history.download(DAY, opener=bad, sleeper=lambda _: pytest.fail("Sin reintento para 400"))
