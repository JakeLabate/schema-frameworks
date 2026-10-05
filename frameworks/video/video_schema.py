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


# Video helpers
REGION_CODE = re.compile(r"^[A-Z]{2,3}$")
VIDEO_FILE = re.compile(r"\.(3gp|3g2|asf|avi|divx|m2v|m3u|m3u8|m4v|mkv|mov|mp4|mpeg|ogv|qvt|ram|rm|vob|webm|wmv|xap)$", re.I)


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def parse_dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# Seconds to ISO 8601 duration, e.g. 754 -> "PT12M34S".
def to_iso_duration(seconds):
    if not is_int(seconds) or seconds <= 0:
        return None
    h, m, s = seconds // 3600, (seconds % 3600) // 60, seconds % 60
    return "PT" + (f"{h}H" if h else "") + (f"{m}M" if m else "") + (f"{s}S" if s else "")


def with_time_param(page_url, value):
    return page_url + ("&" if "?" in page_url else "?") + f"t={value}"


def build_party(party):
    if not party or not party.get("name"):
        return None  # creator/author needs name
    return {
        "@type": "Person" if party.get("type") == "Person" else "Organization",
        "name": party["name"],
        "url": party.get("url") if is_absolute_url(party.get("url")) else None,
    }


# Key moments, option 1: Clip per chapter (video must be 30s or longer).
def build_clips(chapters, duration_seconds, page_url):
    if not is_int(duration_seconds) or duration_seconds < 30:
        return []
    valid = sorted(
        (c for c in (chapters or [])
         if c and c.get("name") and is_int(c.get("startSeconds"))
         and 0 <= c["startSeconds"] < duration_seconds),
        key=lambda c: c["startSeconds"],
    )
    clips, seen_starts = [], set()
    for c in valid:
        if c["startSeconds"] in seen_starts:
            continue  # no two clips may share a start time
        seen_starts.add(c["startSeconds"])
        end = c.get("endSeconds")
        end_ok = is_int(end) and c["startSeconds"] < end <= duration_seconds
        clips.append({
            "@type": "Clip",
            "name": c["name"],
            "startOffset": c["startSeconds"],
            "endOffset": end if end_ok else None,
            "url": with_time_param(page_url, c["startSeconds"]),  # same URL path as the video
        })
    return clips


# Key moments, option 2: SeekToAction when the player deep links via ?t=.
def build_seek_to_action(source, page_url):
    duration = source.get("durationSeconds")
    if not source.get("supportsTimeParam") or not is_int(duration) or duration < 30:
        return None
    return {
        "@type": "SeekToAction",
        "target": with_time_param(page_url, "{seek_to_second_number}"),
        "startOffset-input": "required name=seek_to_second_number",
    }


# LIVE badge: BroadcastEvent with startDate and a (possibly approximate) endDate.
def build_broadcast_event(live):
    if not live:
        return None
    start = to_iso_datetime(live.get("startDate"))
    end = to_iso_datetime(live.get("endDate"))
    if not start or not end or parse_dt(end) <= parse_dt(start):
        return None
    return {"@type": "BroadcastEvent", "isLiveBroadcast": True, "startDate": start, "endDate": end}


def build_video_object_schema(source):
    page = source.get("page")
    if not passes_page_gates(page):
        return None

    # Required: name, thumbnailUrl, uploadDate (with timezone).
    thumbnails = [u for u in (source.get("thumbnailUrls") or []) if is_absolute_url(u)]
    upload_date = to_iso_datetime(source.get("uploadDate"))
    if not source.get("title") or not thumbnails or not upload_date:
        return None

    # contentUrl must be a supported video file; neither URL may be the watch page.
    content_url = source.get("contentUrl")
    if not (is_absolute_url(content_url) and content_url != page["url"]
            and VIDEO_FILE.search(urlparse(content_url).path)):
        content_url = None
    embed_url = source.get("embedUrl")
    if not (is_absolute_url(embed_url) and embed_url != page["url"]):
        embed_url = None

    expires = to_iso_datetime(source.get("expires"))
    regions_allowed = [c for c in (source.get("regionsAllowed") or []) if REGION_CODE.match(c)]
    # Use regionsAllowed or ineligibleRegion, never both.
    ineligible_region = [] if regions_allowed else [
        c for c in (source.get("ineligibleRegion") or []) if REGION_CODE.match(c)]
    views = source.get("viewCount")
    views = views if is_int(views) and views >= 0 else None
    clips = build_clips(source.get("chapters"), source.get("durationSeconds"), page["url"])

    schema = {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": source["title"],
        "description": source.get("description"),
        "thumbnailUrl": thumbnails,
        "uploadDate": upload_date,
        "duration": to_iso_duration(source.get("durationSeconds")),
        "contentUrl": content_url,
        "embedUrl": embed_url,
        "expires": expires if expires and parse_dt(expires) > parse_dt(upload_date) else None,
        "creator": build_party(source.get("creator")),
        "regionsAllowed": regions_allowed,
        "ineligibleRegion": ineligible_region,
        "interactionStatistic": None if views is None else {
            "@type": "InteractionCounter",
            "interactionType": {"@type": "WatchAction"},
            "userInteractionCount": views,
        },
        "hasPart": clips,
        "potentialAction": None if clips else build_seek_to_action(source, page["url"]),
        "publication": build_broadcast_event(source.get("live")),
    }

    return compact(schema)
