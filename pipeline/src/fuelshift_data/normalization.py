"""Adaptación del contrato real de MITECO al dominio de FuelShift."""

import json
import re
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation

from pydantic import ValidationError

from fuelshift_data.exceptions import SourceContractError
from fuelshift_data.models import Coordinates, FuelCode, FuelPrice, Station

PRODUCT_FIELDS: dict[str, FuelCode] = {
    "Precio Adblue": FuelCode.ADBLUE,
    "Precio Amoniaco": FuelCode.AMMONIA,
    "Precio Biodiesel": FuelCode.BIODIESEL,
    "Precio Bioetanol": FuelCode.BIOETHANOL,
    "Precio Biogas Natural Comprimido": FuelCode.COMPRESSED_NATURAL_BIOGAS,
    "Precio Biogas Natural Licuado": FuelCode.LIQUEFIED_NATURAL_BIOGAS,
    "Precio Diésel Renovable": FuelCode.RENEWABLE_DIESEL,
    "Precio Gas Natural Comprimido": FuelCode.COMPRESSED_NATURAL_GAS,
    "Precio Gas Natural Licuado": FuelCode.LIQUEFIED_NATURAL_GAS,
    "Precio Gases licuados del petróleo": FuelCode.LIQUEFIED_PETROLEUM_GAS,
    "Precio Gasoleo A": FuelCode.DIESEL_A,
    "Precio Gasoleo B": FuelCode.DIESEL_B,
    "Precio Gasoleo Premium": FuelCode.PREMIUM_DIESEL,
    "Precio Gasolina 95 E10": FuelCode.GASOLINE_95_E10,
    "Precio Gasolina 95 E25": FuelCode.GASOLINE_95_E25,
    "Precio Gasolina 95 E5": FuelCode.GASOLINE_95_E5,
    "Precio Gasolina 95 E5 Premium": FuelCode.PREMIUM_GASOLINE_95_E5,
    "Precio Gasolina 95 E85": FuelCode.GASOLINE_95_E85,
    "Precio Gasolina 98 E10": FuelCode.GASOLINE_98_E10,
    "Precio Gasolina 98 E5": FuelCode.GASOLINE_98_E5,
    "Precio Gasolina Renovable": FuelCode.RENEWABLE_GASOLINE,
    "Precio Hidrogeno": FuelCode.HYDROGEN,
    "Precio Metanol": FuelCode.METHANOL,
}

ROOT_FIELDS = {"Fecha", "ListaEESSPrecio", "Nota", "ResultadoConsulta"}
BASE_RECORD_FIELDS = {
    "C.P.",
    "Dirección",
    "Horario",
    "Latitud",
    "Localidad",
    "Longitud (WGS84)",
    "Municipio",
    "Provincia",
    "Rótulo",
    "IDEESS",
    "IDMunicipio",
    "IDProvincia",
    "IDCCAA",
}
DECIMAL_COMMA_PATTERN = re.compile(r"^-?\d+,\d+$")
SPAIN_LATITUDE_MIN = Decimal("27.5")
SPAIN_LATITUDE_MAX = Decimal("44.0")
SPAIN_LONGITUDE_MIN = Decimal("-18.5")
SPAIN_LONGITUDE_MAX = Decimal("4.5")


@dataclass(frozen=True, slots=True)
class SourceDataset:
    """Respuesta de MITECO validada en su nivel superior."""

    reported_at_raw: str
    reported_at_local: datetime
    note: str
    result: str
    records: tuple[Mapping[str, object], ...]


@dataclass(frozen=True, slots=True)
class RejectedRecord:
    """Registro descartado con una razón estable y auditable."""

    index: int
    station_id: str | None
    reason: str
    detail: str


@dataclass(frozen=True, slots=True)
class NormalizationResult:
    """Resultado completo, incluidos los descartes."""

    stations: tuple[Station, ...]
    rejections: tuple[RejectedRecord, ...]
    source_count: int


class RecordRejection(ValueError):
    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


def parse_source_payload(content: bytes) -> SourceDataset:
    """Decodificar UTF-8 y validar la envoltura exacta observada en la API."""

    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise SourceContractError("La respuesta no usa UTF-8 válido") from error

    try:
        payload = json.loads(decoded)
    except json.JSONDecodeError as error:
        raise SourceContractError("La respuesta de MITECO no contiene JSON válido") from error

    if not isinstance(payload, dict):
        raise SourceContractError("La raíz JSON de MITECO debe ser un objeto")
    missing = ROOT_FIELDS - payload.keys()
    unexpected = payload.keys() - ROOT_FIELDS
    if missing or unexpected:
        raise SourceContractError(
            "La raíz JSON no coincide con el contrato verificado; "
            f"faltan={sorted(missing)}, sobran={sorted(unexpected)}"
        )

    result = payload["ResultadoConsulta"]
    if result != "OK":
        raise SourceContractError(f"MITECO comunicó ResultadoConsulta={result!r}")

    records = payload["ListaEESSPrecio"]
    if not isinstance(records, list) or not records:
        raise SourceContractError("ListaEESSPrecio debe ser una lista no vacía")
    if not all(isinstance(record, dict) for record in records):
        raise SourceContractError("ListaEESSPrecio contiene elementos que no son objetos")

    reported_at_raw = payload["Fecha"]
    if not isinstance(reported_at_raw, str):
        raise SourceContractError("Fecha debe ser una cadena")
    try:
        reported_at_local = datetime.strptime(reported_at_raw, "%d/%m/%Y %H:%M:%S")
    except ValueError as error:
        raise SourceContractError(
            f"Fecha no usa el formato verificado DD/MM/YYYY HH:MM:SS: {reported_at_raw!r}"
        ) from error

    note = payload["Nota"]
    if not isinstance(note, str):
        raise SourceContractError("Nota debe ser una cadena")

    return SourceDataset(
        reported_at_raw=reported_at_raw,
        reported_at_local=reported_at_local,
        note=note,
        result=result,
        records=tuple(records),
    )


def normalize_dataset(source: SourceDataset) -> NormalizationResult:
    """Normalizar todas las estaciones y conservar las razones de descarte."""

    observed_price_fields = {
        key
        for record in source.records
        for key in record
        if isinstance(key, str) and key.startswith("Precio ")
    }
    unknown_price_fields = observed_price_fields - PRODUCT_FIELDS.keys()
    if unknown_price_fields:
        raise SourceContractError(
            f"La respuesta contiene productos no reconocidos: {sorted(unknown_price_fields)}"
        )

    identifiers = [
        value.strip()
        for record in source.records
        if isinstance((value := record.get("IDEESS")), str) and value.strip()
    ]
    duplicates = sorted(
        identifier for identifier, count in Counter(identifiers).items() if count > 1
    )
    if duplicates:
        sample = ", ".join(duplicates[:10])
        raise SourceContractError(f"La respuesta contiene IDEESS duplicados: {sample}")

    stations: list[Station] = []
    rejections: list[RejectedRecord] = []
    for index, record in enumerate(source.records):
        station_id = _optional_string(record.get("IDEESS"))
        try:
            stations.append(normalize_station(record))
        except RecordRejection as error:
            rejections.append(
                RejectedRecord(
                    index=index,
                    station_id=station_id,
                    reason=error.reason,
                    detail=error.detail,
                )
            )

    stations.sort(key=lambda station: (station.province_id, int(station.station_id)))
    return NormalizationResult(
        stations=tuple(stations),
        rejections=tuple(rejections),
        source_count=len(source.records),
    )


def normalize_station(record: Mapping[str, object]) -> Station:
    """Normalizar una estación o rechazarla completa ante un dato no fiable."""

    required_fields = BASE_RECORD_FIELDS | PRODUCT_FIELDS.keys()
    missing = sorted(required_fields - record.keys())
    if missing:
        raise RecordRejection("missing_source_fields", f"faltan campos: {missing}")

    latitude = _decimal_comma(_required_string(record, "Latitud"), "Latitud")
    longitude = _decimal_comma(_required_string(record, "Longitud (WGS84)"), "Longitud (WGS84)")
    if not (
        SPAIN_LATITUDE_MIN <= latitude <= SPAIN_LATITUDE_MAX
        and SPAIN_LONGITUDE_MIN <= longitude <= SPAIN_LONGITUDE_MAX
    ):
        raise RecordRejection(
            "coordinates_outside_supported_extent",
            f"latitud={latitude}, longitud={longitude}",
        )

    prices: list[FuelPrice] = []
    for source_field, product in PRODUCT_FIELDS.items():
        raw_value = _required_value(record, source_field).strip()
        if not raw_value:
            continue
        try:
            amount = _decimal_comma(raw_value, source_field)
            prices.append(FuelPrice(product=product, amount=amount))
        except (RecordRejection, ValidationError) as error:
            raise RecordRejection(
                "invalid_price", f"{source_field}={raw_value!r}: {error}"
            ) from error

    if not prices:
        raise RecordRejection("no_prices", "la estación no comunica ningún precio vigente")

    try:
        return Station(
            station_id=_required_string(record, "IDEESS"),
            province_id=_required_string(record, "IDProvincia"),
            municipality_id=_required_string(record, "IDMunicipio"),
            province=_required_string(record, "Provincia"),
            municipality=_required_string(record, "Municipio"),
            locality=_optional_record_string(record, "Localidad"),
            postal_code=_required_string(record, "C.P."),
            address=_required_string(record, "Dirección"),
            coordinates=Coordinates(latitude=latitude, longitude=longitude),
            brand=_optional_record_string(record, "Rótulo"),
            opening_hours=_optional_record_string(record, "Horario"),
            prices=tuple(sorted(prices, key=lambda price: price.product.value)),
        )
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        location = ".".join(str(part) for part in first["loc"])
        raise RecordRejection("invalid_station", f"{location}: {first['msg']}") from error


def _required_value(record: Mapping[str, object], field: str) -> str:
    value = record.get(field)
    if not isinstance(value, str):
        raise RecordRejection("invalid_field_type", f"{field} debe ser una cadena")
    return value


def _required_string(record: Mapping[str, object], field: str) -> str:
    value = _required_value(record, field).strip()
    if not value:
        raise RecordRejection("missing_required_value", f"{field} está vacío")
    return value


def _optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _optional_record_string(record: Mapping[str, object], field: str) -> str | None:
    value = record.get(field)
    if not isinstance(value, str):
        raise RecordRejection("invalid_field_type", f"{field} debe ser una cadena")
    return _optional_string(value)


def _decimal_comma(value: str, field: str) -> Decimal:
    if not DECIMAL_COMMA_PATTERN.fullmatch(value):
        raise RecordRejection("invalid_decimal", f"{field} no usa coma decimal: {value!r}")
    try:
        return Decimal(value.replace(",", "."))
    except InvalidOperation as error:
        raise RecordRejection("invalid_decimal", f"{field} no es decimal: {value!r}") from error
