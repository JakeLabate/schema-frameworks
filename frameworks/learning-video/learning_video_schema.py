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


# Seconds to ISO 8601 duration, for example 754 -> "PT12M34S".
def to_iso_duration(seconds):
    if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds <= 0:
        return None
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return "PT" + (f"{h}H" if h else "") + (f"{m}M" if m else "") + (f"{s}S" if s else "")


def parse_datetime(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# Key moments: unique integer startOffset, endOffset after start, url = page URL + ?t=.
def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def build_clips(chapters, page_url, duration_seconds):
    clips, seen = [], set()
    for c in chapters or []:
        start, end = c.get("start"), c.get("end")
        if not c.get("name") or not is_int(start) or start < 0 or start in seen:
            continue
        seen.add(start)
        if is_int(duration_seconds) and start >= duration_seconds:
            continue
        clips.append({
            "@type": "Clip",
            "name": c["name"],
            "startOffset": start,
            "endOffset": end if is_int(end) and end > start else None,
            "url": f"{page_url}?t={start}",
        })
    return clips


# LearningResource is added only when the page states learning metadata.
# It earns no Google rich result (retired Sep 9, 2025); VideoObject still does.
def choose_video_type(source):
    learning = source.get("learning") or {}
    if learning.get("educationalLevel") or learning.get("teaches"):
        return ["VideoObject", "LearningResource"]
    return "VideoObject"


def build_learning_video_schema(source):
    page = source.get("page")
    if not passes_page_gates(page):
        return None

    # Google Video required: name, thumbnailUrl, uploadDate (DateTime with offset).
    thumbnails = [url for url in source.get("thumbnailUrls") or [] if is_absolute_url(url)]
    upload_date = to_iso_datetime(source.get("uploadDate"))
    if not source.get("name") or not thumbnails or not upload_date:
        return None

    # contentUrl and embedUrl must be absolute and must not be the watch page itself.
    def media_url(url):
        return url if is_absolute_url(url) and url != page["url"] else None

    expires = to_iso_datetime(source.get("expires"))
    views = source.get("viewCount")
    if not isinstance(views, int) or isinstance(views, bool) or views < 0:
        views = None
    creator = source.get("creator") or {}
    learning = source.get("learning") or {}
    type_ = choose_video_type(source)

    schema = {
        "@context": "https://schema.org",
        "@type": type_,
        "name": source["name"],
        "description": source.get("description"),
        "thumbnailUrl": thumbnails,
        "uploadDate": upload_date,
        "duration": to_iso_duration(source.get("durationSeconds")),
        "contentUrl": media_url(source.get("contentUrl")),
        "embedUrl": media_url(source.get("embedUrl")),
        "expires": expires if expires and parse_datetime(expires) > parse_datetime(upload_date) else None,
        "creator": {
            "@type": "Organization" if creator.get("type") == "Organization" else "Person",
            "name": creator["name"],
            "url": creator.get("url") if is_absolute_url(creator.get("url")) else None,
        } if creator.get("name") else None,
        "hasPart": build_clips(source.get("chapters"), page["url"], source.get("durationSeconds")),
        "interactionStatistic": None if views is None else {
            "@type": "InteractionCounter",
            "interactionType": {"@type": "WatchAction"},
            "userInteractionCount": views,
        },
    }

    if isinstance(type_, list):
        schema.update({
            "educationalLevel": learning.get("educationalLevel"),
            "learningResourceType": learning.get("learningResourceType"),
            "teaches": learning.get("teaches"),
            "inLanguage": learning.get("inLanguage"),
        })

    return compact(schema)


# Usage: json_ld = build_learning_video_schema(source)  # same source dict as the JS example; None means emit nothing
