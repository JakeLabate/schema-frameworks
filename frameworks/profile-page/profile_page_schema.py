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


# Stats about the profile entity itself, counted on this platform only.
PROFILE_STATS = {
    "followers": "https://schema.org/FollowAction",
    "likes": "https://schema.org/LikeAction",
    "friends": "https://schema.org/BefriendAction",
}
# Stats about what the entity does: following, liking, posting, resharing.
AGENT_STATS = {
    "following": "https://schema.org/FollowAction",
    "likesGiven": "https://schema.org/LikeAction",
    "posts": "https://schema.org/WriteAction",
    "reshares": "https://schema.org/ShareAction",
}
PLACEHOLDER_IMAGE = re.compile(r"default|placeholder|avatar-blank|blank-avatar|gravatar\.com/avatar/[^?]*\?.*d=", re.I)


def to_timestamp(value):
    if ISO_DATE.match(value):
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def choose_profile_entity_type(source):
    return "Organization" if source.get("isOrganization") else "Person"


def build_counters(stats, allowed):
    return [
        {"@type": "InteractionCounter", "interactionType": allowed[key], "userInteractionCount": count}
        for key, count in (stats or {}).items()
        if key in allowed and isinstance(count, int) and not isinstance(count, bool) and count >= 0
    ]


def build_profile_page_schema(source):
    if not passes_page_gates(source):
        return None
    # The page must be about one person or organization affiliated with the site.
    if not source.get("isAffiliatedWithSite"):
        return None

    # Prefer the real name; a handle in name is fine when it is the only identifier.
    name = (source.get("realName") or source.get("handle") or "").strip()
    if not name:
        return None
    alternate_name = source["handle"] if source.get("realName") and source.get("handle") else None

    image_url = source.get("imageUrl")
    image = image_url if is_absolute_url(image_url) and not PLACEHOLDER_IMAGE.search(image_url) else None

    date_created = to_iso_date_time(source.get("dateCreated"))
    date_modified = to_iso_date_time(source.get("dateModified"))
    if date_created and date_modified and to_timestamp(date_modified) < to_timestamp(date_created):
        date_modified = None

    return compact({
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        "dateCreated": date_created,
        "dateModified": date_modified,
        "mainEntity": {
            "@type": choose_profile_entity_type(source),
            "name": name,
            "alternateName": alternate_name,
            "identifier": str(source["internalId"]) if source.get("internalId") is not None else None,
            "description": source.get("byline"),
            "image": image,
            "sameAs": [u for u in source.get("externalProfiles") or [] if is_absolute_url(u)],
            "interactionStatistic": build_counters(source.get("profileStats"), PROFILE_STATS),
            "agentInteractionStatistic": build_counters(source.get("activityStats"), AGENT_STATS),
        },
    })


# Usage: json_ld = build_profile_page_schema(source)  # same source dict as the JS example; None means emit nothing
