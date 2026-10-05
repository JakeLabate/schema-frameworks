import math
import re
from datetime import date, datetime
from urllib.parse import urlparse


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISO_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$")


def to_iso_date(value):
    if not isinstance(value, str) or not ISO_DATE.match(value.strip()):
        return None
    try:
        date.fromisoformat(value.strip())
    except ValueError:
        return None
    return value.strip()


def to_iso_datetime(value):
    if not isinstance(value, str) or not ISO_DATETIME.match(value.strip()):
        return None
    # keep the original string so the timezone offset survives
    try:
        datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return value.strip()


def compact(value):
    if isinstance(value, list):
        items = [kept for kept in (compact(item) for item in value) if kept is not None]
        return items or None
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            kept = compact(item)
            if kept is not None:
                out[key] = kept
        return out or None
    if value is None or value == "":
        return None
    return value


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def build_rating(verdict):
    # the textual verdict is required: alternateName, or name when alternateName is absent
    label = (verdict.get("label") or "").strip()
    if not label:
        return None
    rating = {"@type": "Rating", "alternateName": label, "name": label}

    value, worst, best = verdict.get("value"), verdict.get("worst"), verdict.get("best")
    if all(is_number(n) for n in (value, worst, best)):
        # worstRating at least 1 and below bestRating; ratingValue inside the scale
        if worst < 1 or worst >= best or value < worst or value > best:
            return None
        rating.update({"ratingValue": value, "worstRating": worst, "bestRating": best})
    return rating


def build_claim(claim):
    if not claim:
        return None
    return {
        "@type": "Claim",
        "author": {
            "@type": "Person" if claim.get("authorType") == "Person" else "Organization",
            "name": claim["authorName"],
            "sameAs": claim.get("authorSameAs") if is_absolute_url(claim.get("authorSameAs")) else None,
        } if claim.get("authorName") else None,
        "datePublished": to_iso_datetime(claim.get("datePublished")) or to_iso_date(claim.get("datePublished")),
        "appearance": [u for u in claim.get("appearances") or [] if is_absolute_url(u)],
        "firstAppearance": claim.get("firstAppearance") if is_absolute_url(claim.get("firstAppearance")) else None,
    }


def build_claim_review_schema(source):
    # Google is phasing out ClaimReview rich results; emit only for a visible fact check
    # (schema.org semantics, Fact Check Explorer and other consumers)
    if source.get("indexable") is False:
        return None
    if not is_absolute_url(source.get("url")):
        return None
    if source.get("canonicalUrl") and source["canonicalUrl"] != source["url"]:
        return None
    if source.get("verdictVisible") is not True:
        return None  # claim and conclusion must be readable on the page
    reviews_on_page = source.get("claimReviewsOnPage")
    if (1 if reviews_on_page is None else reviews_on_page) != 1:
        return None  # one ClaimReview per page

    claim_reviewed = (source.get("claimSummary") or "").strip()
    if not claim_reviewed:
        return None
    review_rating = build_rating(source.get("verdict") or {})
    if not review_rating:
        return None

    publisher = source.get("publisher")
    schema = {
        "@context": "https://schema.org",
        "@type": "ClaimReview",
        "url": source["url"],  # the page hosting the full fact check article
        "claimReviewed": claim_reviewed,  # keep under 75 characters to limit wrapping on mobile
        "reviewRating": review_rating,
        "author": {
            "@type": "Organization",
            "name": publisher.get("name"),
            "url": publisher.get("url") if is_absolute_url(publisher.get("url")) else None,
        } if publisher else None,
        "itemReviewed": build_claim(source.get("claim")),
    }

    return compact(schema)


# Usage:
# build_claim_review_schema({
#     "url": "https://www.example.com/fact-checks/2026/moon-cheese",
#     "canonicalUrl": "https://www.example.com/fact-checks/2026/moon-cheese",
#     "indexable": True,
#     "verdictVisible": True,
#     "claimReviewsOnPage": 1,
#     "claimSummary": "The moon is made of cheese",
#     "verdict": {"label": "False", "value": 1, "worst": 1, "best": 5},
#     "publisher": {"name": "Example Fact Desk", "url": "https://www.example.com/about/corrections-policy"},
#     "claim": {
#         "authorName": "Square Moon Society",
#         "authorSameAs": "https://www.example.org/square-moon-society",
#         "datePublished": "2026-04-02",
#         "appearances": ["https://www.example.org/posts/moon-facts"],
#         "firstAppearance": "https://www.example.org/posts/moon-facts",
#     },
# })
