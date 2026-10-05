import re
from datetime import date
from urllib.parse import urlparse

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
ISO_DATE_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.hostname)


def is_real_date(y, m, d):
    try:
        date(int(y), int(m), int(d))
        return True
    except ValueError:
        return False


# Calendar date (YYYY-MM-DD); a full date-time is cut to its date part.
def to_iso_date(value):
    if not isinstance(value, str):
        return None
    v = value.strip()
    m = ISO_DATE.match(v) or ISO_DATE_TIME.match(v)
    return v[:10] if m and is_real_date(m[1], m[2], m[3]) else None


# Date-time with Z or an offset (kept as written), or a plain date.
# A date-time without a timezone is rejected instead of guessed.
def to_iso_date_time(value):
    if not isinstance(value, str):
        return None
    v = value.strip()
    m = ISO_DATE.match(v) or ISO_DATE_TIME.match(v)
    return v if m and is_real_date(m[1], m[2], m[3]) else None


# Drop None, "", [] and {} recursively.
def compact(value):
    if isinstance(value, list):
        items = [c for c in (compact(v) for v in value) if c is not None]
        return items or None
    if isinstance(value, dict):
        out = {}
        for key, v in value.items():
            c = compact(v)
            if c is not None:
                out[key] = c
        return out or None
    if value is None or value == "":
        return None
    return value


# Page gates: indexable, self-canonical, and the marked-up content is visible.
def passes_page_gates(source):
    if not source.get("isIndexable") or not source.get("isContentVisible"):
        return False
    if not is_absolute_url(source.get("url")):
        return False
    return not source.get("canonicalUrl") or source.get("canonicalUrl") == source.get("url")


# trail: ordered crumbs as shown on the page, [{ name, url }].
# The last crumb (usually the current page) may omit url.
def build_breadcrumb_schema(source):
    if not passes_page_gates(source):
        return None

    trail = [c for c in source.get("trail") or [] if c and c.get("name")]
    if len(trail) < 2:
        return None  # Google needs at least two ListItems

    last_index = len(trail) - 1
    item_list_element = []
    for index, crumb in enumerate(trail):
        has_url = is_absolute_url(crumb.get("url"))
        # Every crumb except the last must carry an absolute item URL.
        if not has_url and index != last_index:
            return None
        item_list_element.append({
            "@type": "ListItem",
            "position": index + 1,  # 1..n, no gaps or duplicates
            "name": str(crumb["name"]).strip(),
            "item": crumb["url"] if has_url else None,
        })

    return compact({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": item_list_element,
    })


# Usage: json_ld = build_breadcrumb_schema(source)  # same source dict as the JS example; None means emit nothing
