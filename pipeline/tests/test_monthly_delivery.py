"""Entrega mensual con fixtures locales: ningún test usa red, Git o Cloudflare."""

import json
from datetime import date
from urllib.error import HTTPError, URLError

import pytest

from fuelshift_data import monthly_delivery as delivery
from fuelshift_data import monthly_history as history
from test_monthly_history import DAY, sample

FEB = date(2007, 2, 1)
MAR = date(2007, 3, 1)


def published(root, days):
    history.publish([sample(day) for day in days], root, days[-1])
    return delivery.check(root)


def site(manifest, samples):
    def fetch(url):
        return manifest if url.endswith("/manifest.json") else samples

    return fetch


def missing(url):
    raise HTTPError(url, 404, "Primera publicación", {}, None)


def test_recupera_union_base_sitio_y_artefacto_sin_redescargar(tmp_path):
    root, artifact, cache = (tmp_path / name for name in ("root", "artifact", "cache"))
    published(root, [DAY])
    public, samples = published(tmp_path / "site", [DAY, FEB])
    published(artifact, [DAY, FEB, MAR])
    assert delivery.recover(
        root, cache, "https://fuelshift.pages.dev", artifact, fetch=site(public, samples)
    )
    manifest, restored = delivery.check(root)
    assert manifest["sample_count"] == 3
    assert restored == [sample(day) for day in (DAY, FEB, MAR)]
    assert sorted(p.stem for p in cache.glob("*.json")) == [str(DAY), str(FEB), str(MAR)]


def test_artefacto_caducado_utiliza_sitio_y_no_retrocede_a_base(tmp_path):
    root, cache = tmp_path / "root", tmp_path / "cache"
    published(root, [DAY])
    public, samples = published(tmp_path / "site", [DAY, FEB])
    assert not delivery.recover(
        root, cache, "https://fuelshift.pages.dev", fetch=site(public, samples)
    )
    assert delivery.check(root)[0]["sample_count"] == 2
    # Segunda recuperación con caché caliente: mismo conjunto y sin nuevos cambios.
    before = (root / "manifest.json").read_bytes()
    assert not delivery.recover(
        root, cache, "https://fuelshift.pages.dev", fetch=site(public, samples)
    )
    assert (root / "manifest.json").read_bytes() == before


def test_primera_publicacion_usa_base_404_sin_inventar_huecos(tmp_path):
    root, cache = tmp_path / "root", tmp_path / "cache"
    value = sample()
    del value["provinces"]["52"]["fuels"]["gasoline_98_e5"]
    value["national"]["gasoline_98_e5"][1] -= 100
    history.publish([value], root, DAY)
    assert delivery.recover(root, cache, "https://fuelshift.pages.dev", fetch=missing)
    manifest, _ = delivery.check(root)
    file = root / "sets" / manifest["generation"] / "52/gasoline_98_e5.json"
    assert json.loads(file.read_bytes())["observations"] == [[str(DAY), None, 0]]


@pytest.mark.parametrize(
    "error", [URLError("sin conexión"), HTTPError("https://example.org", 503, "temporal", {}, None)]
)
def test_error_sitio_no_publica_base_obsoleta(tmp_path, error):
    root, cache = tmp_path / "root", tmp_path / "cache"
    published(root, [DAY])
    before = (root / "manifest.json").read_bytes()

    def fetch(url):
        raise error

    with pytest.raises(URLError):
        delivery.recover(root, cache, "https://fuelshift.pages.dev", fetch=fetch)
    assert (root / "manifest.json").read_bytes() == before
    assert not cache.exists()


def test_200_vacio_no_se_confunde_con_primera_publicacion(tmp_path):
    published(tmp_path, [DAY])
    with pytest.raises(ValueError, match="vacío"):
        delivery.recover(
            tmp_path, tmp_path / "cache", "https://fuelshift.pages.dev", fetch=lambda _: None
        )


def test_artefacto_corrupto_o_conflictivo_no_sustituye_datos_buenos(tmp_path):
    root, artifact = tmp_path / "root", tmp_path / "artifact"
    original, samples = published(root, [DAY])
    manifest, _ = published(artifact, [DAY, FEB])
    path = artifact / "sets" / manifest["generation"] / "ES/diesel_a.json"
    path.write_bytes(b"{}")
    before = (root / "manifest.json").read_bytes()
    with pytest.raises(ValueError, match="corrupta"):
        delivery.recover(
            root,
            tmp_path / "cache",
            "https://fuelshift.pages.dev",
            artifact,
            fetch=site(original, samples),
        )
    assert (root / "manifest.json").read_bytes() == before
    other = sample()
    other["retrieved_at"] = "2026-11-15T13:00:00Z"
    history.publish([other], tmp_path / "conflict", DAY)
    with pytest.raises(ValueError, match="modificaría"):
        delivery.recover(
            root,
            tmp_path / "cache",
            "https://fuelshift.pages.dev",
            tmp_path / "conflict",
            fetch=missing,
        )
    assert (root / "manifest.json").read_bytes() == before


def test_build_exige_misma_generacion_y_cli_informa_cambios(tmp_path, monkeypatch):
    root, output = tmp_path / "root", tmp_path / "build"
    published(root, [DAY, FEB])
    published(output, [DAY])
    assert delivery.main(["check", "--root", str(output), "--against", str(root)]) == 1
    assert delivery.main(["check", "--root", str(root), "--against", str(root)]) == 0
    monkeypatch.setattr(delivery, "recover", lambda *args: True)
    github_output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    assert (
        delivery.main(["recover", "--root", str(root), "--site-url", "https://fuelshift.pages.dev"])
        == 0
    )
    assert github_output.read_text().strip() == "changed=true"


def test_copia_publicada_sin_procedencia_o_cabecera_corrupta_bloquea(tmp_path):
    root = tmp_path / "root"
    manifest, samples = published(root, [DAY])
    before = (root / "manifest.json").read_bytes()
    bad = {**manifest, "sample_count": 500}
    with pytest.raises(ValueError, match="manifiesto"):
        delivery.recover(
            root, tmp_path / "cache", "https://fuelshift.pages.dev", fetch=site(bad, samples)
        )
    with pytest.raises(HTTPError):
        delivery.recover(
            root,
            tmp_path / "cache",
            "https://fuelshift.pages.dev",
            fetch=lambda url: manifest if url.endswith("/manifest.json") else missing(url),
        )
    assert (root / "manifest.json").read_bytes() == before


def test_url_no_permite_credenciales_ni_rutas(tmp_path):
    for url in (
        "http://example.org",
        "https://user:secret@example.org",
        "https://example.org/other",
    ):
        with pytest.raises(ValueError, match="HTTPS"):
            delivery.recover(
                tmp_path, tmp_path / "cache", url, fetch=lambda _: pytest.fail("No debe consultar")
            )
