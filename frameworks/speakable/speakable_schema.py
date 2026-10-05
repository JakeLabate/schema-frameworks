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


# Speakable helpers
# Google: about 20 to 30 seconds per section, roughly two to three sentences.
# 75 words is our ceiling (about 30 seconds at a typical speaking pace).
MAX_SPEAKABLE_WORDS = 75
EN_LANG = re.compile(r"^en(-|$)", re.I)


def choose_speakable_type(source):
    return "NewsArticle" if source.get("isNewsArticle") else "WebPage"


# Keep sections that matched in the rendered page and fit the length guideline.
# Skip datelines, photo captions and source attributions.
def select_speakable_sections(sections):
    return [
        s for s in (sections or [])
        if s and s.get("selector") and (s.get("matchCount") or 0) > 0
        and 0 < (s.get("wordCount") or 0) <= MAX_SPEAKABLE_WORDS
        and s.get("role") not in ("dateline", "caption", "attribution")
    ]


def build_speakable_schema(source):
    page = source.get("page")
    if not passes_page_gates(page):
        return None
    # Feature only serves English-language content (U.S. Google Home users).
    if not EN_LANG.match(page.get("lang") or ""):
        return None

    sections = select_speakable_sections(source.get("speakableSections"))
    # Use cssSelector or xpath, never both: pick one addressing mode per page.
    mode = "css" if any(s.get("kind") == "css" for s in sections) else "xpath"
    selectors = [s["selector"] for s in sections if s.get("kind") == mode]
    # Required: speakable with at least one cssSelector or xpath.
    if not selectors:
        return None

    schema_type = choose_speakable_type(source)
    return compact({
        "@context": "https://schema.org",
        "@type": schema_type,
        "name" if schema_type == "WebPage" else "headline": source.get("title"),
        "url": page["url"],
        "speakable": {
            "@type": "SpeakableSpecification",
            "cssSelector" if mode == "css" else "xpath": selectors,
        },
    })
