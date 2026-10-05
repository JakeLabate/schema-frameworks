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


PROMO = re.compile(r"[$€£]\s?\d|\d+\s?%\s?off|\b(sale|discount|deal|cheap|free|best|top|only|make money)\b", re.I)
DESCRIPTION_DISPLAY_LIMIT = 60


# A real course title: no prices, discounts, superlatives or non-course phrases.
def is_course_name(name):
    return isinstance(name, str) and name.strip() != "" and not PROMO.search(name)


# Google shows about 60 characters; prefer a short summary when the full text is longer.
def pick_description(course):
    full = (course.get("description") or "").strip()
    short = (course.get("shortDescription") or "").strip()
    if len(full) > DESCRIPTION_DISPLAY_LIMIT and short and len(short) <= DESCRIPTION_DISPLAY_LIMIT:
        return short
    return full or short or None


# Course detail page (summary pattern): one Course node per detail page.
def build_course_schema(source):
    if not passes_page_gates(source):
        return None
    # Course markup only earns a course list when a summary page lists the course.
    if not is_absolute_url(source.get("listedOnUrl")):
        return None
    if not is_course_name(source.get("name")):
        return None
    description = pick_description(source)
    if not description:
        return None

    provider = source.get("provider") or {}
    return compact({
        "@context": "https://schema.org",
        "@type": "Course",
        "name": source["name"].strip(),
        "description": description,
        "provider": {
            "@type": "Organization",
            "name": provider["name"],
            "sameAs": provider.get("url") if is_absolute_url(provider.get("url")) else None,
        } if provider.get("name") else None,
    })


# Summary page: an ItemList of at least three course detail URLs.
# Usage: build_course_list_schema({**page_gates, "url": url, "courseUrls": [url1, url2, url3]})
def build_course_list_schema(source):
    if not passes_page_gates(source):
        return None
    raw = source.get("courseUrls") or []
    urls = [u for u in raw if is_absolute_url(u)]
    if len(urls) < 3 or len(urls) != len(raw):
        return None
    if len(set(urls)) != len(urls):
        return None  # unique detail URLs
    if len({urlparse(u).hostname for u in urls}) != 1:
        return None  # one domain

    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [{"@type": "ListItem", "position": i + 1, "url": u} for i, u in enumerate(urls)],
    }


# Usage: json_ld = build_course_schema(source)  # same source dict as the JS example; None means emit nothing
