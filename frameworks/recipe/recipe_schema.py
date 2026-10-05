import re
from datetime import date, datetime

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


def to_number(value):
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num != num or num in (float("inf"), float("-inf")):
        return None
    return int(num) if num.is_integer() else num


def is_currency_code(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Z]{3}", value) is not None


# Rating or AggregateRating; None when ratingValue falls outside worstRating..bestRating.
def build_rating(data, rating_type):
    if not data:
        return None
    best = to_number(data.get("bestRating"))
    best = 5 if best is None else best
    worst = to_number(data.get("worstRating"))
    worst = 1 if worst is None else worst
    value = to_number(data.get("ratingValue"))
    if value is None or worst >= best or value < worst or value > best:
        return None
    rating = {"@type": rating_type, "ratingValue": value, "bestRating": best, "worstRating": worst}
    if rating_type == "AggregateRating":
        rating_count = to_number(data.get("ratingCount")) or 0
        review_count = to_number(data.get("reviewCount")) or 0
        if rating_count <= 0 and review_count <= 0:
            return None
        rating["ratingCount"] = rating_count if rating_count > 0 else None
        rating["reviewCount"] = review_count if review_count > 0 else None
    return rating


# Review with a valid author name (under 100 characters) and an in-range rating.
def build_review(data):
    data = data or {}
    author_name = str(data.get("authorName") or "").strip()
    review_rating = build_rating(data.get("rating"), "Rating")
    if not author_name or len(author_name) >= 100 or not review_rating:
        return None
    return {
        "@type": "Review",
        "author": {"@type": "Organization" if data.get("authorType") == "Organization" else "Person", "name": author_name},
        "reviewRating": review_rating,
        "datePublished": to_iso_date(data.get("datePublished")),
    }


ISO_DURATION = re.compile(r"^P(?=\d|T\d)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$")


# Minutes (int) become PT#H#M; strings must already be ISO 8601 durations.
def to_iso_duration(value):
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        hours, minutes = divmod(value, 60)
        return "PT" + (f"{hours}H" if hours else "") + (f"{minutes}M" if minutes else "")
    if isinstance(value, str) and ISO_DURATION.match(value.strip()):
        return value.strip()
    return None


STEP_LABEL = re.compile(r"^(directions|instructions|watch the video|step\s*\d+)\s*[:.\-]?\s*", re.I)


def absolute_urls(items):
    return [u for u in items or [] if is_absolute_url(u)]


# A step video is a Clip of the recipe video: name, startOffset (seconds) and a url that jumps to it.
def build_clip(clip, name):
    clip = clip or {}
    start = to_number(clip.get("startOffset"))
    end = to_number(clip.get("endOffset"))
    if not name or not isinstance(start, int) or start < 0 or not is_absolute_url(clip.get("url")):
        return None
    return {"@type": "Clip", "name": name, "startOffset": start,
            "endOffset": end if end is not None and end > start else None, "url": clip["url"]}


def build_step(step):
    step = step or {}
    text = STEP_LABEL.sub("", str(step.get("text") or ""), count=1).strip()
    if not text:
        return None
    raw_name = str(step.get("name") or "").strip()
    name = raw_name if raw_name and not re.fullmatch(r"step\s*\d+", raw_name, re.I) else None
    image = step.get("image")
    return {
        "@type": "HowToStep",
        "name": name,
        "text": text,
        "url": step.get("url") if is_absolute_url(step.get("url")) else None,
        "image": image if is_absolute_url(image) and re.search(r"\.(jpe?g|png|gif)(\?.*)?$", image, re.I) else None,
        "video": build_clip(step.get("clip"), name),
    }


# HowToSection needs a name and at least one valid HowToStep.
def build_instruction(item):
    if not isinstance((item or {}).get("steps"), list):
        return build_step(item)
    steps = [s for s in (build_step(x) for x in item["steps"]) if s]
    name = str(item.get("sectionName") or "").strip()
    return {"@type": "HowToSection", "name": name, "itemListElement": steps} if name and steps else None


def build_video(video):
    video = video or {}
    upload_date = to_iso_date_time(video.get("uploadDate"))
    if not video.get("name") or not is_absolute_url(video.get("thumbnailUrl")) or not upload_date or "T" not in upload_date:
        return None
    return {
        "@type": "VideoObject",
        "name": video["name"],
        "description": video.get("description"),
        "thumbnailUrl": video["thumbnailUrl"],
        "uploadDate": upload_date,
        "duration": to_iso_duration(video.get("duration")),
        "contentUrl": video.get("contentUrl") if is_absolute_url(video.get("contentUrl")) else None,
        "embedUrl": video.get("embedUrl") if is_absolute_url(video.get("embedUrl")) else None,
    }


def build_recipe_schema(source):
    if not passes_page_gates(source):
        return None

    # Required: name of the dish and at least one crawlable image of it.
    name = str(source.get("name") or "").strip()
    images = absolute_urls(source.get("images"))
    if not name or not images:
        return None

    # prepTime and cookTime only as a pair; totalTime stands alone.
    prep_time = to_iso_duration(source.get("prepTime"))
    cook_time = to_iso_duration(source.get("cookTime"))
    pair_ok = bool(prep_time and cook_time)

    # Per-serving calories require recipeYield with the number of servings.
    servings = to_number(source.get("servings"))
    recipe_yield = None
    if isinstance(servings, int) and servings > 0:
        recipe_yield = [str(servings), *(source.get("extraYields") or [])]

    taxonomy = [v.lower() for v in (source.get("category"), source.get("cuisine")) if v]
    keywords = [k for k in source.get("keywords") or [] if k.lower() not in taxonomy]

    return compact({
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": name,
        "image": images,
        "description": source.get("description"),
        "author": [
            {"@type": "Organization" if a.get("type") == "Organization" else "Person", "name": a.get("name"),
             "url": a.get("url") if is_absolute_url(a.get("url")) else None}
            for a in source.get("authors") or []
        ],
        "datePublished": to_iso_date(source.get("datePublished")),
        "prepTime": prep_time if pair_ok else None,
        "cookTime": cook_time if pair_ok else None,
        "totalTime": to_iso_duration(source.get("totalTime")),
        "recipeYield": recipe_yield,
        "recipeCategory": source.get("category"),
        "recipeCuisine": source.get("cuisine"),
        "keywords": ", ".join(keywords),
        "nutrition": {"@type": "NutritionInformation", "calories": f"{source['caloriesPerServing']} calories"}
        if recipe_yield and source.get("caloriesPerServing") else None,
        "recipeIngredient": [str(i).strip() for i in source.get("ingredients") or []],
        "recipeInstructions": [i for i in (build_instruction(x) for x in source.get("instructions") or []) if i],
        "aggregateRating": build_rating(source.get("rating"), "AggregateRating"),
        "video": build_video(source.get("video")),
    })
