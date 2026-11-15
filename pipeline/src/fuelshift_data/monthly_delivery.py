"""Recuperación y entrega del histórico mensual, sin Git ni despliegues propios."""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from fuelshift_data.monthly_history import (
    DEFAULT_USER_AGENT,
    atomic_write,
    encode,
    publish,
    validate_sample,
)

DEFAULT_ROOT = Path("public/data/historico-miteco")
SITE_PATH = "/data/historico-miteco"


def _generation(manifest: dict) -> str:
    generation = manifest["generation"]
    if not isinstance(generation, str) or not re.fullmatch(r"[a-f0-9]{20}", generation):
        raise ValueError("Generación mensual inválida")
    return generation


def _validate(manifest: dict, samples: list[dict]) -> None:
    generation = _generation(manifest)
    if hashlib.sha256(encode(samples)).hexdigest()[:20] != generation:
        raise ValueError("La huella de procedencia mensual no coincide")
    end = date.fromisoformat(manifest["last_date"])
    if end > datetime.now(UTC).date():
        raise ValueError("El histórico contiene fechas futuras")
    # El mismo productor comprueba cobertura, fechas, precios y recuentos, y
    # reproduce todos los metadatos. No se confía solo en el hash del artefacto.
    with TemporaryDirectory() as temporary:
        root = Path(temporary)
        publish(samples, root, end)
        if json.loads((root / "manifest.json").read_bytes()) != manifest:
            raise ValueError("El manifiesto no coincide con sus muestras")


def check(root: Path) -> tuple[dict, list[dict]]:
    """Valida manifiesto, procedencia y las 159 series, incluidos sus huecos."""
    manifest = json.loads((root / "manifest.json").read_bytes())
    generation = _generation(manifest)
    samples = json.loads((root / "sets" / generation / "provenance.json").read_bytes())
    _validate(manifest, samples)
    with TemporaryDirectory() as temporary:
        expected = Path(temporary)
        publish(samples, expected, date.fromisoformat(manifest["last_date"]))
        for file in (expected / "sets" / generation).rglob("*.json"):
            if (root / file.relative_to(expected)).read_bytes() != file.read_bytes():
                raise ValueError(f"Serie mensual corrupta: {file.relative_to(expected)}")
    return manifest, samples


def fetch_json(url: str) -> object:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": DEFAULT_USER_AGENT,
            "Cache-Control": "no-cache",
        },
    )
    with urlopen(request, timeout=45) as response:
        if response.status != 200 or response.headers.get_content_type() != "application/json":
            raise ValueError("Respuesta publicada mensual inválida")
        content = response.read(50 * 1024 * 1024 + 1)
        if len(content) > 50 * 1024 * 1024:
            raise ValueError("Respuesta publicada mensual demasiado grande")
        return json.loads(content)


def recover(
    root: Path,
    cache: Path,
    site_url: str,
    artifact: Path | None = None,
    *,
    fetch=fetch_json,
) -> bool:
    """Une base, copia pública y artefacto; cualquier conflicto bloquea la entrega.

    Pages conserva la última copia publicada aunque caduquen los artefactos.
    Un fallo HTTP/contrato se propaga: no permite desplegar una base anterior.
    Solo un 404 del manifiesto significa que falta el primer despliegue mensual.
    """
    url = urlsplit(site_url)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.path not in ("", "/")
        or url.query
        or url.fragment
    ):
        raise ValueError("La URL de producción debe ser un origen HTTPS sin credenciales")
    baseline, base_samples = check(root)
    sources = [(baseline, base_samples)]
    published = None
    try:
        published = fetch(site_url.rstrip("/") + SITE_PATH + "/manifest.json")
        if published is None:
            raise ValueError("Manifiesto publicado vacío")
    except HTTPError as error:
        if error.code != 404:
            raise
    if published is not None:
        generation = _generation(published)
        samples = fetch(site_url.rstrip("/") + SITE_PATH + f"/sets/{generation}/provenance.json")
        _validate(published, samples)
        sources.append((published, samples))
    if artifact is not None:
        sources.append(check(artifact))

    merged = {}
    for _, samples in sources:
        for sample in samples:
            day = sample["date"]
            if day in merged and encode(merged[day]) != encode(sample):
                raise ValueError(f"La recuperación modificaría una muestra válida del {day}")
            merged[day] = sample
    # Validar también la caché antes de escribir nada: no sustituir una muestra
    # por otra silenciosamente ni reutilizar precios corruptos en el siguiente mes.
    for day, sample in merged.items():
        target = cache / f"{day}.json"
        if target.exists():
            saved = json.loads(target.read_bytes())
            validate_sample(saved, date.fromisoformat(day))
            if encode(saved) != encode(sample):
                raise ValueError(f"Conflicto en la caché mensual del {day}")
    for day, sample in merged.items():
        atomic_write(cache / f"{day}.json", encode(sample))
    end = max(date.fromisoformat(manifest["last_date"]) for manifest, _ in sources)
    publish(list(merged.values()), root, end)
    manifest, _ = check(root)
    return published is None or manifest["generation"] != published["generation"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["recover", "check"])
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--cache", type=Path, default=Path("data/cache/miteco-monthly"))
    parser.add_argument("--site-url")
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--against", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "recover":
            changed = recover(args.root, args.cache, args.site_url or "", args.artifact)
            if os.environ.get("GITHUB_OUTPUT"):
                with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
                    output.write(f"changed={str(changed).lower()}\n")
            print(f"Histórico mensual recuperado; cambios pendientes: {changed}")
        else:
            manifest, _ = check(args.root)
            if args.against and manifest != check(args.against)[0]:
                raise ValueError("El build no incluye la generación mensual seleccionada")
            print(f"Histórico mensual validado: {manifest['sample_count']} muestras, 159 series")
        return 0
    except (ValueError, KeyError, TypeError, OSError, URLError) as error:
        print(
            f"Entrega mensual bloqueada; se conserva la última publicación: {error}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
