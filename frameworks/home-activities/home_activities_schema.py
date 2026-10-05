# Shared helpers
import re
from datetime import date, datetime
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


TICKET_AVAILABILITY = {
    "in_stock": "https://schema.org/InStock",
    "sold_out": "https://schema.org/SoldOut",
    "pre_order": "https://schema.org/PreOrder",
}


# Seconds to ISO 8601 duration, for example 2700 -> "PT45M".
def to_iso_duration(seconds):
    if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds <= 0:
        return None
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return "PT" + (f"{h}H" if h else "") + (f"{m}M" if m else "") + (f"{s}S" if s else "")


def parse_datetime(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# Home activities rich results were removed Jun 4, 2024. What still qualifies:
# a scheduled session with a physical venue (Event, optionally also streamed),
# or a recording (VideoObject). Online-only live sessions get no markup type.
def choose_home_activity_type(source):
    venue = source.get("venue") or {}
    if source.get("startDate") and venue.get("name") and venue.get("streetAddress"):
        return "Event"
    if (source.get("recording") or {}).get("uploadDate"):
        return "VideoObject"
    return None


def build_event(source):
    # Google Event required: name, startDate, location (Place with address).
    start_date = to_iso_datetime(source.get("startDate"))
    if not source.get("name") or not start_date:
        return None
    end_date = to_iso_datetime(source.get("endDate"))
    venue = source["venue"]
    streamed = is_absolute_url(source.get("streamUrl"))
    offer = source.get("offer") or {}
    price = to_number(offer.get("price"))
    organizer = source.get("organizer") or {}

    return {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": source["name"],
        "description": source.get("description"),
        "startDate": start_date,
        "endDate": end_date if end_date and parse_datetime(end_date) > parse_datetime(start_date) else None,
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/MixedEventAttendanceMode"
        if streamed else "https://schema.org/OfflineEventAttendanceMode",
        # Google's Event doc requires location as a Place; VirtualLocation entries fail
        # validation, so the stream link stays in the visible page content.
        "location": {
            "@type": "Place",
            "name": venue["name"],
            "address": {
                "@type": "PostalAddress",
                "streetAddress": venue["streetAddress"],
                "addressLocality": venue.get("locality"),
                "addressRegion": venue.get("region"),
                "postalCode": venue.get("postalCode"),
                "addressCountry": venue.get("country")
                if re.fullmatch(r"[A-Z]{2}", venue.get("country") or "") else None,
            },
        },
        "image": [url for url in source.get("images") or [] if is_absolute_url(url)],
        "offers": {
            "@type": "Offer",
            "price": price,
            "priceCurrency": offer["currency"],
            "availability": TICKET_AVAILABILITY.get(offer.get("availability")),
            "validFrom": to_iso_datetime(offer.get("validFrom")),
            "url": offer.get("url") if is_absolute_url(offer.get("url")) else None,
        } if price is not None and price >= 0 and is_currency_code(offer.get("currency")) else None,
        "organizer": {
            "@type": "Organization",
            "name": organizer["name"],
            "url": organizer.get("url") if is_absolute_url(organizer.get("url")) else None,
        } if organizer.get("name") else None,
        "performer": {"@type": "Person", "name": source["instructor"]} if source.get("instructor") else None,
    }


def build_recording(source):
    # Google Video required: name, thumbnailUrl, uploadDate (DateTime with offset).
    rec = source["recording"]
    thumbnails = [url for url in rec.get("thumbnailUrls") or [] if is_absolute_url(url)]
    upload_date = to_iso_datetime(rec.get("uploadDate"))
    if not source.get("name") or not thumbnails or not upload_date:
        return None
    content_url = rec.get("contentUrl")
    return {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": source["name"],
        "description": source.get("description"),
        "thumbnailUrl": thumbnails,
        "uploadDate": upload_date,
        "duration": to_iso_duration(rec.get("durationSeconds")),
        "contentUrl": content_url
        if is_absolute_url(content_url) and content_url != source["page"]["url"] else None,
    }


def build_home_activity_schema(source):
    if not passes_page_gates(source.get("page")):
        return None
    type_ = choose_home_activity_type(source)
    if type_ == "Event":
        schema = build_event(source)
    elif type_ == "VideoObject":
        schema = build_recording(source)
    else:
        schema = None
    return compact(schema) if schema else None


# Usage: json_ld = build_home_activity_schema(source)  # same source dict as the JS example; None means emit nothing
