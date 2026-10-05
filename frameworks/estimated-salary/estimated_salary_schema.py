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


# Pay period to ISO 8601 duration (schema.org QuantitativeValueDistribution.duration).
PAY_PERIODS = {"hour": "PT1H", "day": "P1D", "week": "P1W", "month": "P1M", "year": "P1Y"}
PERCENTILES = [
    ("p10", "percentile10"),
    ("p25", "percentile25"),
    ("median", "median"),
    ("p75", "percentile75"),
    ("p90", "percentile90"),
]
PLACE_TYPES = {"city": "City", "state": "State", "country": "Country"}


# One MonetaryAmountDistribution per pay period; None when the figures are unusable.
def build_distribution(range_, currency):
    duration = PAY_PERIODS.get(range_.get("period"))
    if not duration or not is_currency_code(currency):
        return None
    dist = {"@type": "MonetaryAmountDistribution", "name": range_.get("label"), "currency": currency, "duration": duration}
    previous = 0
    for key, prop in PERCENTILES:
        value = to_number(range_.get(key))
        if value is None:
            continue
        if value <= 0 or value < previous:  # positive and non-decreasing
            return None
        dist[prop] = value
        previous = value
    return dist if any(prop in dist for _, prop in PERCENTILES) else None


# Retired rich result: Google lists no required properties. This is schema.org
# Occupation markup for other consumers, gated on a minimum useful core.
def build_occupation_schema(source):
    if not passes_page_gates(source.get("page")):
        return None
    if not source.get("name"):
        return None

    estimated_salary = [
        dist for dist in (build_distribution(r, source.get("currency")) for r in source.get("salaryRanges") or [])
        if dist
    ]
    if not estimated_salary:
        return None

    locations = [
        {"@type": PLACE_TYPES[loc["kind"]], "name": loc["name"]}
        for loc in source.get("locations") or []
        if loc.get("kind") in PLACE_TYPES and loc.get("name")
    ]

    schema = {
        "@context": "https://schema.org",
        "@type": "Occupation",
        "name": source["name"],
        "description": source.get("description"),
        "url": source["page"]["url"],
        "occupationalCategory": source.get("occupationalCategory"),
        "occupationLocation": locations,
        "estimatedSalary": estimated_salary,
        "skills": source.get("skills"),
    }

    return compact(schema)


# Usage: json_ld = build_occupation_schema(source)  # same source dict as the JS example; None means emit nothing
