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


# Movie helpers
IMAGE_FILE = re.compile(r"\.(jpe?g|png|gif)$", re.I)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


# 6:9 (2:3) poster ratio; Google can crop images that are close to it.
def is_poster_ratio(img):
    if not img or not img.get("width") or not img.get("height"):
        return False
    return abs(img["width"] / img["height"] - 6 / 9) <= 0.05


def build_person(name):
    return {"@type": "Person", "name": name} if name else None


def build_rating(r, is_aggregate):
    if not r:
        return None
    best = r.get("bestRating", 5)
    worst = r.get("worstRating", 1)
    value = r.get("ratingValue")
    if not is_number(value) or value < worst or value > best:
        return None
    count = r.get("ratingCount")
    if is_aggregate and not (isinstance(count, int) and not isinstance(count, bool) and count > 0):
        return None
    return {
        "@type": "AggregateRating" if is_aggregate else "Rating",
        "ratingValue": value,
        "bestRating": best,
        "worstRating": worst,
        "ratingCount": count if is_aggregate else None,
    }


def build_review(review):
    rating = build_rating(review and review.get("rating"), False)
    if not rating or not review.get("authorName"):
        return None  # review needs author and rating
    return {
        "@type": "Review",
        "reviewRating": rating,
        "author": build_person(review["authorName"]),
        "datePublished": to_iso_date(review.get("datePublished")),
    }


# One Movie node. Required: name, image (crawlable .jpg/.png/.gif, about 6:9).
# Summary approach detail page: compact({"@context": "https://schema.org", **build_movie_schema(movie)})
def build_movie_schema(movie):
    images = [img for img in (movie.get("images") or [])
              if is_absolute_url(img.get("url")) and IMAGE_FILE.search(urlparse(img["url"]).path)
              and is_poster_ratio(img)]
    if not movie.get("name") or not images:
        return None
    return {
        "@type": "Movie",
        "url": movie.get("url") if is_absolute_url(movie.get("url")) else None,
        "name": movie["name"],
        "image": [img["url"] for img in images],
        "dateCreated": to_iso_date(movie.get("releaseDate")),
        "director": [build_person(n) for n in (movie.get("directors") or [])],
        "aggregateRating": build_rating(movie.get("aggregateRating"), True),
        "review": [build_review(r) for r in (movie.get("reviews") or [])],
    }


# Summary page (ListItem.url to detail pages) or all-in-one page (full Movie in each ListItem).
def choose_carousel_approach(source):
    return "all-in-one" if all(m.get("renderedOnThisPage") for m in source["movies"]) else "summary"


def build_movie_carousel_schema(source):
    page = source.get("page")
    movies = source.get("movies")
    if not passes_page_gates(page) or not isinstance(movies, list) or not movies:
        return None

    approach = choose_carousel_approach(source)
    host = urlparse(page["url"]).hostname
    entries = []
    for movie in movies:
        # Every item must be a Movie on the same domain as the list page.
        url = movie.get("url")
        if not is_absolute_url(url) or urlparse(url).hostname != host:
            continue
        if approach == "summary":
            entries.append({"url": url})
            continue
        # All-in-one: each item needs its own URL fragment on this page.
        if not url.startswith(page["url"] + "#"):
            continue
        node = build_movie_schema(movie)
        if node:
            entries.append({"item": node})
    if not entries:
        return None

    return compact({
        "@context": "https://schema.org",
        "@type": "ItemList",
        # Positions start at 1 and increase by 1 after filtering.
        "itemListElement": [{"@type": "ListItem", "position": i + 1, **entry} for i, entry in enumerate(entries)],
    })
