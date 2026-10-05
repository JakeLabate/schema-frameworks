import re
from datetime import date, datetime, timezone

ISO_DATE_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$")
ABSOLUTE_URL = re.compile(r"^https?://[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$", re.I)


def is_absolute_url(value):
    return isinstance(value, str) and bool(ABSOLUTE_URL.match(value))


# Returns the ISO 8601 string unchanged (timezone offset kept), or None if unparseable.
def to_iso_date_time(value):
    if not isinstance(value, str):
        return None
    text = value.strip()
    m = ISO_DATE_TIME.match(text)
    if not m:
        return None
    y, mo, d = int(m[1]), int(m[2]), int(m[3])
    try:
        date(y, mo, d)
    except ValueError:
        return None
    if int(m[4] or 0) > 23 or int(m[5] or 0) > 59 or int(m[6] or 0) > 59:
        return None
    return text


def to_iso_date(value):
    iso = to_iso_date_time(value)
    return iso[:10] if iso else None


# Drops None, "", [] and {} recursively.
def compact(value):
    if isinstance(value, list):
        items = [c for c in (compact(v) for v in value) if c is not None]
        return items or None
    if isinstance(value, dict):
        out = {k: c for k, c in ((k, compact(v)) for k, v in value.items()) if c is not None}
        return out or None
    return None if value is None or value == "" else value


def passes_page_gates(source):
    if source.get("indexable") is False:
        return False
    if source.get("canonicalUrl") and source.get("url") and source["canonicalUrl"] != source["url"]:
        return False
    return source.get("contentVisible") is not False


def to_count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def to_number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return int(number) if number.is_integer() else number


def build_employer_rating_schema(source):
    # (a) Page gates: indexable, self-canonical, ratings visible on this page.
    if not passes_page_gates(source):
        return None
    # Users must be able to post ratings on this site, and the site must host them.
    if not source.get("acceptsUserRatings") or not source.get("ratingsHostedOnSite"):
        return None

    # (b) Required: itemReviewed (Organization with name), ratingValue, ratingCount or reviewCount.
    employer = source.get("employer") or {}
    rating_count = to_count(source.get("ratingCount"))
    review_count = to_count(source.get("reviewCount"))
    if not employer.get("name") or (rating_count is None and review_count is None):
        return None

    # (d) ratingValue must sit within worstRating..bestRating (defaults 1..5).
    best = to_number(source.get("bestRating"))
    worst = to_number(source.get("worstRating"))
    best = 5 if best is None else best
    worst = 1 if worst is None else worst
    rating_value = to_number(source.get("ratingValue"))
    if rating_value is None:
        return None
    if worst >= best or rating_value < worst or rating_value > best:
        return None

    # (c) Required + recommended properties, only when the source has them.
    schema = {
        "@context": "https://schema.org",
        "@type": "EmployerAggregateRating",
        "itemReviewed": {
            "@type": "Organization",
            "name": employer["name"],
            "sameAs": employer.get("url") if is_absolute_url(employer.get("url")) else None,
        },
        "ratingValue": rating_value,
        "ratingCount": rating_count,
        "reviewCount": review_count,
        "bestRating": best,
        "worstRating": worst,
    }

    # (e) Strip empty values.
    return compact(schema)
