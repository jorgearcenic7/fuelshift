"""Interfaz de línea de comandos para la ingesta MITECO."""

import argparse
import json
import logging
from decimal import Decimal, InvalidOperation
from pathlib import Path

from fuelshift_data.download import HttpClientConfig, MitecoHttpClient
from fuelshift_data.exceptions import FuelShiftDataError
from fuelshift_data.pipeline import run_ingestion
from fuelshift_data.validation import QualityThresholds


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fuelshift-data",
        description="Descarga y publica localmente las estaciones oficiales de MITECO.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/processed/miteco"),
        help="Directorio local de publicación (por defecto: data/processed/miteco).",
    )
    parser.add_argument("--timeout-seconds", type=float, default=45.0)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--minimum-stations", type=int, default=10_000)
    parser.add_argument("--max-rejection-ratio", type=_ratio, default=Decimal("0.02"))
    parser.add_argument("--max-station-drop-ratio", type=_ratio, default=Decimal("0.20"))
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        downloader = MitecoHttpClient(
            config=HttpClientConfig(
                timeout_seconds=args.timeout_seconds,
                max_attempts=args.max_attempts,
            )
        )
        thresholds = QualityThresholds(
            minimum_station_count=args.minimum_stations,
            maximum_rejection_ratio=args.max_rejection_ratio,
            maximum_station_drop_ratio=args.max_station_drop_ratio,
        )
        report = run_ingestion(args.output, downloader=downloader, thresholds=thresholds)
    except (FuelShiftDataError, ValueError) as error:
        logging.error("La ingesta no se publicó: %s", error)
        return 1

    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2, sort_keys=True))
    return 0


def _ratio(value: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as error:
        raise argparse.ArgumentTypeError("debe ser un decimal entre 0 y 1") from error
    if not Decimal("0") <= parsed < Decimal("1"):
        raise argparse.ArgumentTypeError("debe estar entre 0 y 1")
    return parsed
