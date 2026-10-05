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


LOCAL_BUSINESS_TYPES = {
    "restaurant": "Restaurant",
    "cafe": "CafeOrCoffeeShop",
    "bakery": "Bakery",
    "day_spa": "DaySpa",
    "gym": "HealthClub",
    "dentist": "Dentist",
    "auto_repair": "AutoRepair",
    "hardware_store": "HardwareStore",
}
FOOD_TYPES = ["Restaurant", "CafeOrCoffeeShop", "Bakery"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")
PHONE = re.compile(r"^\+\d")


# Use the most specific LocalBusiness subtype available.
def choose_local_business_type(source):
    return LOCAL_BUSINESS_TYPES.get(source.get("category"), "LocalBusiness")


def has_five_decimals(value):
    return isinstance(value, float) and bool(re.fullmatch(r"-?\d+\.\d{5,}", repr(value)))


def build_hours(spec):
    days = [d for d in spec.get("days") or [] if d in DAYS]
    if not days or not TIME.match(spec.get("opens") or "") or not TIME.match(spec.get("closes") or ""):
        return None
    # 24 hours: 00:00 to 23:59. Closed all day: 00:00 to 00:00. Past midnight: closes earlier than opens.
    return {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": [f"https://schema.org/{d}" for d in days],
        "opens": spec["opens"],
        "closes": spec["closes"],
        "validFrom": to_iso_date(spec.get("validFrom")),  # seasonal hours only
        "validThrough": to_iso_date(spec.get("validThrough")),
    }


def phone_or_none(value):
    return value if PHONE.match(value or "") else None


def build_local_business_schema(source):
    # (a) Page gates: indexable, self-canonical, business details visible on the page.
    if not passes_page_gates(source):
        return None

    # (b) Required: name, address.
    address = source.get("address") or {}
    if not source.get("name") or not address.get("street") or not address.get("locality"):
        return None

    business_type = choose_local_business_type(source)
    country = str(address.get("country") or "").upper()
    geo = source.get("geo") or {}
    url = source.get("url") if is_absolute_url(source.get("url")) else None
    is_food = business_type in FOOD_TYPES
    price_range = source.get("priceRange")
    rating = source.get("rating")

    # (c) Required + recommended properties, only when the source has them.
    schema = {
        "@context": "https://schema.org",
        "@type": business_type,
        "@id": f"{url}#business" if url else None,
        "name": source["name"],
        "url": url,
        "image": [u for u in source.get("images") or [] if is_absolute_url(u)],
        # (d) Custom rules: international phone, 5-decimal geo, hh:mm hours, short priceRange.
        "telephone": phone_or_none(source.get("telephone")),
        "address": {
            "@type": "PostalAddress",
            "streetAddress": address.get("street"),
            "addressLocality": address.get("locality"),
            "addressRegion": address.get("region"),
            "postalCode": address.get("postalCode"),
            "addressCountry": country if re.fullmatch(r"[A-Z]{2}", country) else None,
        },
        "geo": {"@type": "GeoCoordinates", "latitude": geo["latitude"], "longitude": geo["longitude"]}
        if has_five_decimals(geo.get("latitude")) and has_five_decimals(geo.get("longitude")) else None,
        "openingHoursSpecification": [build_hours(h) for h in source.get("hours") or []],
        "priceRange": price_range if price_range and len(price_range) < 100 else None,
        "menu": source.get("menuUrl") if is_food and is_absolute_url(source.get("menuUrl")) else None,
        "servesCuisine": source.get("cuisines") if is_food else None,
        "department": [
            {
                "@type": choose_local_business_type(dept),
                # "{store name} {department name}" unless the department name is its own brand.
                "name": dept["name"] if dept.get("branded") else f"{source['name']} {dept['name']}",
                "telephone": phone_or_none(dept.get("telephone")),
                "openingHoursSpecification": [build_hours(h) for h in dept.get("hours") or []],
            }
            for dept in source.get("departments") or []
        ],
        # Ratings only on sites that collect reviews about other businesses (no self-serving reviews).
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": rating.get("value"),
            "reviewCount": rating.get("count"),
        } if source.get("reviewsAreAboutOtherBusinesses") and rating else None,
    }

    # (e) Strip empty values.
    return compact(schema)
