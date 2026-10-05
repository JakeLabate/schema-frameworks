# Shared helpers
import re
from datetime import date
from urllib.parse import urlparse

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
ISO_DATETIME = re.compile(r"^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$")


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    try:
        parts = urlparse(value)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.hostname)


def to_iso_date(value):
    if not isinstance(value, str) or not ISO_DATE.match(value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


# Keeps the original timezone offset; rejects naive or unparseable values.
def to_iso_datetime(value):
    match = ISO_DATETIME.match(value) if isinstance(value, str) else None
    return value if match and to_iso_date(match.group(1)) else None


# Drops None, "", [] and {} recursively.
def compact(value):
    if isinstance(value, list):
        items = [kept for kept in (compact(item) for item in value) if kept is not None]
        return items or None
    if isinstance(value, dict):
        out = {key: kept for key, kept in ((k, compact(v)) for k, v in value.items()) if kept is not None}
        return out or None
    return None if value is None or value == "" else value


# Page gates: indexable, self-canonical, marked-up content visible.
def passes_page_gates(page):
    if not page or page.get("noindex") or page.get("robotsBlocked"):
        return False
    if not is_absolute_url(page.get("url")):
        return False
    if page.get("canonicalUrl") and page["canonicalUrl"] != page["url"]:
        return False
    return page.get("contentVisible") is True


def to_number(value):
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num != num or num in (float("inf"), float("-inf")):
        return None
    return int(num) if num.is_integer() else num


def is_currency_code(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Z]{3}", value) is not None


def is_vin(value):
    return isinstance(value, str) and re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", value) is not None


VEHICLE_TYPES = {"car": "Car", "motorcycle": "Motorcycle", "bus": "BusOrCoach", "ebike": "MotorizedBicycle"}
CONDITIONS = {
    "new": "https://schema.org/NewCondition",
    "used": "https://schema.org/UsedCondition",
    "refurbished": "https://schema.org/RefurbishedCondition",
}
AVAILABILITY = {
    "in_stock": "https://schema.org/InStock",
    "sold_out": "https://schema.org/SoldOut",
    "pre_order": "https://schema.org/PreOrder",
}
ODOMETER_UNITS = {"mi": "SMI", "km": "KMT"}
DRIVE_WHEELS = {
    "awd": "https://schema.org/AllWheelDriveConfiguration",
    "fwd": "https://schema.org/FrontWheelDriveConfiguration",
    "rwd": "https://schema.org/RearWheelDriveConfiguration",
    "4wd": "https://schema.org/FourWheelDriveConfiguration",
}


# Vehicle and its subtypes are Product subtypes in schema.org.
def choose_vehicle_type(source):
    return VEHICLE_TYPES.get(source.get("vehicleClass"), "Vehicle")


# Vehicle listing rich results are retired (Sep 9, 2025). The output is still a
# Product subtype, so it is gated on the Product rules validators apply to it:
# name, absolute image, and an Offer with price > 0 in an ISO 4217 currency.
def build_vehicle_schema(source):
    page = source.get("page")
    if not passes_page_gates(page):
        return None

    images = [url for url in source.get("images") or [] if is_absolute_url(url)]
    offer = source.get("offer") or {}
    price = to_number(offer.get("price"))
    if not source.get("name") or not images:
        return None
    if price is None or price <= 0 or not is_currency_code(offer.get("currency")):
        return None

    condition = CONDITIONS.get(source.get("condition"))
    mileage_src = source.get("mileage") or {}
    mileage = to_number(mileage_src.get("value"))
    mileage_unit = ODOMETER_UNITS.get(mileage_src.get("unit"))
    valid_until = to_iso_date(offer.get("validUntil"))
    stock = source.get("stockNumber")
    year = str(source.get("modelYear") or "")

    schema = {
        "@context": "https://schema.org",
        "@type": choose_vehicle_type(source),
        "name": source["name"],
        "description": source.get("description"),
        "image": images,
        "url": page["url"],
        "category": source.get("category"),
        "sku": stock if isinstance(stock, str) and not re.search(r"\s", stock) else None,
        "vehicleIdentificationNumber": source["vin"] if is_vin(source.get("vin")) else None,
        "brand": {"@type": "Brand", "name": source["make"]} if source.get("make") else None,
        "model": source.get("model"),
        "vehicleModelDate": year if re.fullmatch(r"\d{4}", year) else None,
        "bodyType": source.get("bodyType"),
        "color": source.get("color"),
        "fuelType": source.get("fuelType"),
        "vehicleTransmission": source.get("transmission"),
        "driveWheelConfiguration": DRIVE_WHEELS.get(source.get("drivetrain")),
        "numberOfDoors": to_number(source.get("doors")),
        "mileageFromOdometer": {"@type": "QuantitativeValue", "value": mileage, "unitCode": mileage_unit}
        if mileage is not None and mileage >= 0 and mileage_unit else None,
        "itemCondition": condition,
        "offers": {
            "@type": "Offer",
            "price": price,
            "priceCurrency": offer["currency"],
            "availability": AVAILABILITY.get(offer.get("availability")),
            "itemCondition": condition,
            "url": page["url"],
            "priceValidUntil": valid_until if valid_until and valid_until >= date.today().isoformat() else None,
            "seller": {"@type": "AutoDealer", "name": offer["dealerName"]} if offer.get("dealerName") else None,
        },
    }

    return compact(schema)


# Usage: json_ld = build_vehicle_schema(source)  # same source dict as the JS example; None means emit nothing
