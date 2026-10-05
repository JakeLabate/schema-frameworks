import re
from datetime import date
from urllib.parse import urlparse
from datetime import datetime, timezone

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


HONORIFIC = re.compile(r"^(dr|mr|mrs|ms|prof)\.?\s+", re.I)
BYLINE_PREFIX = re.compile(r"^(posted by|written by|by)\s+", re.I)
MIN_IMAGE_PIXELS = 50000


def to_timestamp(value):
    if ISO_DATE.match(value):
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def choose_article_type(source):
    if source.get("template") == "news":
        return "NewsArticle"
    if source.get("template") == "blog":
        return "BlogPosting"
    return "Article"


# author.name holds only the name: strip byline prefixes and honorifics,
# and reject strings that join several people or carry a job title.
def clean_author_name(name, publisher_name):
    if not isinstance(name, str):
        return None
    clean = HONORIFIC.sub("", BYLINE_PREFIX.sub("", name.strip())).strip()
    if not clean or re.search(r",|\||\s(and|&)\s", clean, re.I):
        return None
    if publisher_name and publisher_name.lower() in clean.lower():
        return None
    return clean


def build_author(author, publisher_name):
    name = clean_author_name(author.get("name"), publisher_name)
    if not name:
        return None
    return {
        "@type": "Organization" if author.get("isOrganization") else "Person",
        "name": name,
        "url": author.get("url") if is_absolute_url(author.get("url")) else None,
    }


# Keep crawlable absolute images; drop any image known to be under 50K pixels.
def build_images(images):
    out = []
    for img in images or []:
        if not is_absolute_url(img.get("url")):
            continue
        w, h = img.get("width"), img.get("height")
        if w and h and w * h < MIN_IMAGE_PIXELS:
            continue
        out.append({"@type": "ImageObject", "url": img["url"], "width": w, "height": h})
    return out


def build_article_schema(source):
    if not passes_page_gates(source):
        return None
    # Google lists no required Article properties. This framework still
    # refuses to emit a node without the visible headline.
    if not source.get("headline"):
        return None

    date_published = to_iso_date_time(source.get("datePublished"))
    date_modified = to_iso_date_time(source.get("dateModified"))
    if date_published and date_modified and to_timestamp(date_modified) < to_timestamp(date_published):
        date_modified = None  # never emit a modified date earlier than the publish date

    authors = [build_author(a, source.get("publisherName")) for a in source.get("authors") or []]
    schema = {
        "@context": "https://schema.org",
        "@type": choose_article_type(source),
        "headline": source["headline"].strip(),
        "image": build_images(source.get("images")),
        "datePublished": date_published,
        "dateModified": date_modified,
        # Each author in its own entry, never one joined string.
        "author": [a for a in authors if a],
    }

    return compact(schema)


# Usage: json_ld = build_article_schema(source)  # same source dict as the JS example; None means emit nothing
