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


REVIEWABLE_TYPES = [
    "Book", "Course", "CreativeWorkSeason", "CreativeWorkSeries", "Episode", "Event", "Game", "HowTo",
    "LocalBusiness", "MediaObject", "Movie", "MusicPlaylist", "MusicRecording", "Organization", "Product",
    "Recipe", "SoftwareApplication",
]  # add the subtypes you use (for example Restaurant, MobileApplication)
SELF_SERVING_TYPES = ["LocalBusiness", "Organization"]


def to_number(value):
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        number = float(value)  # "4,4" fails here: Google needs a dot decimal separator
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return int(number) if number.is_integer() else number


def build_rating(rating_type, raw):
    rating_value = to_number(raw.get("value"))
    best = to_number(raw.get("best"))
    worst = to_number(raw.get("worst"))
    best = 5 if best is None else best
    worst = 1 if worst is None else worst
    if rating_value is None or worst >= best:
        return None
    if rating_value < worst or rating_value > best:
        return None
    return {"@type": rating_type, "ratingValue": rating_value, "bestRating": best, "worstRating": worst}


def positive_int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


# One visible review: Review. A visible average across many reviewers: AggregateRating.
def choose_review_type(source):
    if source.get("aggregate"):
        return "AggregateRating"
    return "Review" if source.get("review") else None


def build_review_snippet_schema(source):
    # (a) Page gates: indexable, self-canonical, review content immediately visible on the page.
    if not passes_page_gates(source):
        return None

    # (b) Required: itemReviewed with a supported @type and a name.
    item = source.get("item") or {}
    if not item.get("name") or item.get("type") not in REVIEWABLE_TYPES:
        return None
    # Self-serving: an organization or local business reviewed on a site it controls is ineligible.
    if item["type"] in SELF_SERVING_TYPES and source.get("siteControlledByReviewedEntity"):
        return None

    item_reviewed = {
        "@type": item["type"],
        "name": item["name"],
        "url": item.get("url") if is_absolute_url(item.get("url")) else None,
    }
    review_type = choose_review_type(source)

    if review_type == "Review":
        # Review: author (name under 100 characters) and reviewRating.ratingValue are required.
        review = source["review"]
        author_name = (review.get("authorName") or "").strip()
        review_rating = build_rating("Rating", review.get("rating") or {})
        if not author_name or len(author_name) >= 100 or not review_rating:
            return None
        return compact({
            "@context": "https://schema.org",
            "@type": "Review",
            "itemReviewed": item_reviewed,
            "author": {
                "@type": "Organization" if review.get("authorIsOrganization") else "Person",
                "name": author_name,
            },
            "reviewRating": review_rating,
            "datePublished": to_iso_date(review.get("datePublished")),
        })

    if review_type == "AggregateRating":
        # AggregateRating: ratingValue plus ratingCount or reviewCount are required.
        agg = source["aggregate"]
        rating = build_rating("AggregateRating", agg)
        rating_count = positive_int(agg.get("ratingCount"))
        review_count = positive_int(agg.get("reviewCount"))
        if not rating or (rating_count is None and review_count is None):
            return None
        return compact({
            "@context": "https://schema.org",
            **rating,
            "itemReviewed": item_reviewed,
            "ratingCount": rating_count,
            "reviewCount": review_count,
        })

    return None
