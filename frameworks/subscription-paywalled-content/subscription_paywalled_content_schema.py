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


# Paywall helpers
CLASS_SELECTOR = re.compile(r"^\.[A-Za-z_-][A-Za-z0-9_-]*$")  # only .class selectors are supported


def parse_dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def choose_creative_work_type(source):
    if source.get("contentType") == "news":
        return "NewsArticle"
    if source.get("contentType") == "article":
        return "Article"
    return "WebPage"


def build_author(author):
    if not author or not author.get("name"):
        return None
    return {
        "@type": "Organization" if author.get("type") == "Organization" else "Person",
        "name": author["name"],
        "url": author.get("url") if is_absolute_url(author.get("url")) else None,
    }


# One WebPageElement per paywalled section; sections must not be nested.
def build_paywalled_parts(sections):
    valid = [s for s in (sections or [])
             if s and isinstance(s.get("selector"), str) and CLASS_SELECTOR.match(s["selector"])
             and (s.get("matchCount") or 0) > 0]
    if any(s.get("containsOtherSection") or s.get("insideOtherSection") for s in valid):
        return None
    return [{"@type": "WebPageElement", "isAccessibleForFree": False, "cssSelector": s["selector"]}
            for s in valid]


def build_paywalled_content_schema(source):
    page = source.get("page")
    if not passes_page_gates(page):
        return None

    # Required: isAccessibleForFree as a real boolean.
    if not isinstance(source.get("isAccessibleForFree"), bool):
        return None

    has_part = []
    if source["isAccessibleForFree"] is False:
        has_part = build_paywalled_parts(source.get("paywalledSections"))
        # Nested sections cannot be described correctly: emit nothing.
        if has_part is None:
            return None

    schema_type = choose_creative_work_type(source)
    is_article = schema_type != "WebPage"
    published = to_iso_datetime(source.get("datePublished"))
    modified = to_iso_datetime(source.get("dateModified"))

    return compact({
        "@context": "https://schema.org",
        "@type": schema_type,
        "headline" if is_article else "name": source.get("title"),
        "url": page["url"],
        "image": [u for u in (source.get("images") or []) if is_absolute_url(u)] if is_article else None,
        "datePublished": published,
        "dateModified": modified if modified and published and parse_dt(modified) >= parse_dt(published) else None,
        "author": [build_author(a) for a in (source.get("authors") or [])] if is_article else None,
        "isAccessibleForFree": source["isAccessibleForFree"],
        "hasPart": has_part,
    })
