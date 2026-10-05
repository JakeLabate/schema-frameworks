import re
from datetime import date, datetime

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


# Rating or AggregateRating; None when ratingValue falls outside worstRating..bestRating.
def build_rating(data, rating_type):
    if not data:
        return None
    best = to_number(data.get("bestRating"))
    best = 5 if best is None else best
    worst = to_number(data.get("worstRating"))
    worst = 1 if worst is None else worst
    value = to_number(data.get("ratingValue"))
    if value is None or worst >= best or value < worst or value > best:
        return None
    rating = {"@type": rating_type, "ratingValue": value, "bestRating": best, "worstRating": worst}
    if rating_type == "AggregateRating":
        rating_count = to_number(data.get("ratingCount")) or 0
        review_count = to_number(data.get("reviewCount")) or 0
        if rating_count <= 0 and review_count <= 0:
            return None
        rating["ratingCount"] = rating_count if rating_count > 0 else None
        rating["reviewCount"] = review_count if review_count > 0 else None
    return rating


# Review with a valid author name (under 100 characters) and an in-range rating.
def build_review(data):
    data = data or {}
    author_name = str(data.get("authorName") or "").strip()
    review_rating = build_rating(data.get("rating"), "Rating")
    if not author_name or len(author_name) >= 100 or not review_rating:
        return None
    return {
        "@type": "Review",
        "author": {"@type": "Organization" if data.get("authorType") == "Organization" else "Person", "name": author_name},
        "reviewRating": review_rating,
        "datePublished": to_iso_date(data.get("datePublished")),
    }


APP_CATEGORIES = {
    "GameApplication", "SocialNetworkingApplication", "TravelApplication", "ShoppingApplication",
    "SportsApplication", "LifestyleApplication", "BusinessApplication", "DesignApplication",
    "DeveloperApplication", "DriverApplication", "EducationalApplication", "HealthApplication",
    "FinanceApplication", "SecurityApplication", "BrowserApplication", "CommunicationApplication",
    "DesktopEnhancementApplication", "EntertainmentApplication", "MultimediaApplication",
    "HomeApplication", "UtilitiesApplication", "ReferenceApplication",
}


# VideoGame alone is not eligible, so games are always co-typed with an app type.
def choose_app_type(source):
    base = {"mobile": "MobileApplication", "web": "WebApplication"}.get(source.get("platform"), "SoftwareApplication")
    return ["VideoGame", base] if source.get("isGame") else base


def build_software_app_schema(source):
    if not passes_page_gates(source):
        return None

    # Required: name, offers.price (0 for free apps), and a rating or review.
    name = str(source.get("name") or "").strip()
    price = to_number(source.get("price"))
    if not name or price is None or price < 0:
        return None
    currency = source.get("currency") if is_currency_code(source.get("currency")) else None
    if price > 0 and not currency:
        return None

    aggregate_rating = build_rating(source.get("rating"), "AggregateRating")
    reviews = [r for r in (build_review(item) for item in source.get("reviews") or []) if r]
    if not aggregate_rating and not reviews:
        return None

    category = str(source.get("applicationCategory") or "").replace("https://schema.org/", "")

    return compact({
        "@context": "https://schema.org",
        "@type": choose_app_type(source),
        "name": name,
        "url": source.get("url") if is_absolute_url(source.get("url")) else None,
        "operatingSystem": source.get("operatingSystem"),
        "applicationCategory": category if category in APP_CATEGORIES else None,
        "offers": {"@type": "Offer", "price": price, "priceCurrency": currency},
        "aggregateRating": aggregate_rating,
        "review": reviews,
    })
