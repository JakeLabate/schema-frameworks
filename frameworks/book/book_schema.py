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
from datetime import datetime, timezone

BOOK_FORMATS = ["AudiobookFormat", "EBook", "Hardcover", "Paperback"]
PLATFORMS = ["DesktopWebPlatform", "AndroidPlatform", "IOSPlatform"]
OFFER_CATEGORIES = ["nologinrequired", "free", "subscription", "purchase", "rental"]


# Google Search accepts ISBN-13 only: ISBN-10 is converted, checksums are verified.
def to_isbn13(value):
    raw = re.sub(r"[\s-]", "", str(value or "")).upper()
    if re.fullmatch(r"\d{9}[\dX]", raw):
        sum10 = sum((10 if c == "X" else int(c)) * (10 - i) for i, c in enumerate(raw))
        if sum10 % 11 != 0:
            return None
        digits = "978" + raw[:9]
    elif re.fullmatch(r"97[89]\d{10}", raw):
        digits = raw[:12]
    else:
        return None
    total = sum(int(c) * (3 if i % 2 else 1) for i, c in enumerate(digits))
    isbn = f"{digits}{(10 - total % 10) % 10}"
    return None if len(raw) == 13 and isbn != raw else isbn


def parse_instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# ReadAction needs an Offer (category + eligibleRegion); purchase and rental need a price.
def build_offer(offer, now):
    ends = to_iso_date_time(offer.get("availabilityEnds"))
    if ends and parse_instant(ends).astimezone(timezone.utc) < now:
        return None  # stale: drop it from the feed
    price = to_number(offer.get("price"))
    needs_price = offer.get("category") in ("purchase", "rental")
    regions = [r for r in offer.get("regions") or [] if re.fullmatch(r"[A-Z]{2}", r)]
    if offer.get("category") not in OFFER_CATEGORIES or not regions:
        return None
    if needs_price and (price is None or price < 0 or not is_currency_code(offer.get("currency"))):
        return None
    return {
        "@type": "Offer",
        "category": offer["category"],
        "price": price if needs_price else None,
        "priceCurrency": offer.get("currency") if needs_price else None,
        "availabilityStarts": to_iso_date_time(offer.get("availabilityStarts")),
        "availabilityEnds": ends,
        "eligibleRegion": [{"@type": "Country", "name": name} for name in regions],
    }


def build_action(action, now):
    platforms = [p for p in action.get("platforms") or [] if p in PLATFORMS]
    if not is_absolute_url(action.get("url")) or not platforms:
        return None
    target = {
        "@type": "EntryPoint",
        "urlTemplate": action["url"],
        "actionPlatform": [f"https://schema.org/{p}" for p in platforms],
    }
    if action.get("type") == "BorrowAction":
        if not is_absolute_url(action.get("libraryId")):
            return None  # lender @id, described in the library feed
        return {"@type": "BorrowAction", "target": target, "lender": {"@type": "LibrarySystem", "@id": action["libraryId"]}}
    offers = [o for o in (build_offer(x, now) for x in action.get("offers") or []) if o]
    return {"@type": "ReadAction", "target": target, "expectsAcceptanceOf": offers} if offers else None


def build_edition(edition, now):
    isbn = to_isbn13(edition.get("isbn"))
    actions = [a for a in (build_action(x, now) for x in edition.get("actions") or []) if a]
    if (not is_absolute_url(edition.get("id")) or edition.get("format") not in BOOK_FORMATS
            or not re.fullmatch(r"[a-z]{2}", edition.get("language") or "") or not isbn or not actions):
        return None
    published = str(edition.get("datePublished") or "")
    valid_published = re.fullmatch(r"\d{4}(-\d{2}-\d{2})?", published) and (len(published) == 4 or to_iso_date(published))
    return {
        "@type": "Book",
        "@id": edition["id"],
        "url": edition.get("url") if is_absolute_url(edition.get("url")) else None,
        "bookFormat": f"https://schema.org/{edition['format']}",
        "inLanguage": edition["language"],
        "isbn": isbn,
        "bookEdition": edition.get("bookEdition"),
        "datePublished": published if valid_published else None,
        "identifier": [
            {"@type": "PropertyValue", "propertyID": i["type"], "value": re.sub(r"^\D+", "", str(i["value"]))}
            for i in edition.get("identifiers") or []
            if i.get("type") in ("OCLC_NUMBER", "LCCN", "JP_E-CODE") and i.get("value")
        ],
        "sameAs": edition.get("sameAs") if is_absolute_url(edition.get("sameAs")) else None,
        "potentialAction": actions,
    }


# Builds one Book (work) entity for the dataFeedElement array of a Book actions feed.
def build_book_feed_entity(source, now=None):
    now = now or datetime.now(timezone.utc)
    if not passes_page_gates(source):
        return None

    # Required: work @id, name, author, canonical url and at least one valid edition.
    authors = [a for a in source.get("authors") or [] if a.get("name")]
    seen = {source.get("id"), source.get("url")}
    editions = []
    for e in (build_edition(x, now) for x in source.get("editions") or []):
        if not e:
            continue
        keys = [k for k in [e["@id"], e["url"], *(a["target"]["urlTemplate"] for a in e["potentialAction"])] if k]
        if any(k in seen for k in keys):
            continue  # @id, url and urlTemplate must be unique
        seen.update(keys)
        editions.append(e)
    if not is_absolute_url(source.get("id")) or not source.get("name") or not authors or not is_absolute_url(source.get("url")) or not editions:
        return None

    return compact({
        "@context": "https://schema.org",
        "@type": "Book",
        "@id": source["id"],
        "name": source["name"],
        "url": source["url"],
        "author": [
            {"@type": "Organization" if a.get("type") == "Organization" else "Person", "name": a["name"],
             "sameAs": a.get("sameAs") if is_absolute_url(a.get("sameAs")) else None}
            for a in authors
        ],
        "sameAs": source.get("sameAs") if is_absolute_url(source.get("sameAs")) else None,
        "workExample": editions,
    })
