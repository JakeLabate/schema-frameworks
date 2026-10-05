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


EVENT_STATUS = {
    "scheduled": "https://schema.org/EventScheduled",
    "cancelled": "https://schema.org/EventCancelled",
    "postponed": "https://schema.org/EventPostponed",
    "rescheduled": "https://schema.org/EventRescheduled",
}
TICKET_AVAILABILITY = {
    "in_stock": "https://schema.org/InStock",
    "sold_out": "https://schema.org/SoldOut",
    "pre_order": "https://schema.org/PreOrder",
}


def parse_instant(value):
    text = value.replace("Z", "+00:00") if "T" in value else value + "T00:00:00+00:00"
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def build_postal_address(address):
    address = address or {}
    country = str(address.get("country") or "").upper()
    return {
        "@type": "PostalAddress",
        "streetAddress": address.get("street"),
        "addressLocality": address.get("locality"),
        "addressRegion": address.get("region"),
        "postalCode": address.get("postalCode"),
        "addressCountry": country if re.fullmatch(r"[A-Z]{2}", country) else None,
    }


def build_offer(ticket):
    currency = str(ticket.get("currency") or "").upper()
    price = ticket.get("price")
    # Price includes fees; 0 means free. Currency is a 3-letter ISO 4217 code.
    if isinstance(price, bool) or not isinstance(price, (int, float)) or price < 0:
        return None
    if not re.fullmatch(r"[A-Z]{3}", currency):
        return None
    return {
        "@type": "Offer",
        "name": ticket.get("name"),
        "price": price,
        "priceCurrency": currency,
        "availability": TICKET_AVAILABILITY.get(ticket.get("availability")),
        "validFrom": to_iso_date_time(ticket.get("onSaleFrom")),
        "url": ticket.get("url") if is_absolute_url(ticket.get("url")) else None,
    }


def build_event_schema(source):
    # (a) Page gates: indexable, self-canonical, event visible on this leaf page.
    if not passes_page_gates(source):
        return None

    # (b) Required: name, startDate, location (a physical Place with a PostalAddress).
    venue = source.get("venue") or {}
    to_date = to_iso_date if source.get("allDay") else to_iso_date_time  # all-day: date only
    start_date = to_date(source.get("startDate"))
    if not source.get("name") or not start_date:
        return None
    if source.get("attendanceMode") == "online" or not venue.get("address"):
        return None  # virtual-only events are not supported
    if venue.get("name") and venue.get("name") == source["name"]:
        return None  # the event title must not be the venue name

    # (d) Custom rules: status enum, endDate not before startDate, previousStartDate only when rescheduled.
    status = EVENT_STATUS.get(source.get("status"), EVENT_STATUS["scheduled"])
    end_date = to_date(source.get("endDate"))
    if end_date and parse_instant(end_date) < parse_instant(start_date):
        end_date = None
    previous_start = (
        [to_date(d) for d in source.get("previousStartDates") or []]
        if status == EVENT_STATUS["rescheduled"] else None
    )

    organizer = source.get("organizer")
    # (c) Required + recommended properties, only when the source has them.
    schema = {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": source["name"],
        "description": source.get("description"),
        "startDate": start_date,  # keep startDate even when cancelled or postponed
        "endDate": end_date,
        "eventStatus": status,
        "previousStartDate": previous_start,
        "location": {
            "@type": "Place",
            "name": venue.get("name"),
            "address": build_postal_address(venue.get("address")),
        },
        "image": [u for u in source.get("images") or [] if is_absolute_url(u)],
        "offers": [build_offer(t) for t in source.get("tickets") or []],  # one Offer per ticket type
        "organizer": organizer and {
            "@type": "Person" if organizer.get("type") == "Person" else "Organization",
            "name": organizer.get("name"),
            "url": organizer.get("url") if is_absolute_url(organizer.get("url")) else None,
        },
        "performer": [
            {"@type": "Person" if p.get("type") == "Person" else "PerformingGroup", "name": p.get("name")}
            for p in source.get("performers") or []
        ],
    }

    # (e) Strip empty values.
    return compact(schema)
