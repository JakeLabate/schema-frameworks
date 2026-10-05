import re
from datetime import date
from urllib.parse import urlparse

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


# Host carousels only support these item types, each with its own required fields.
REQUIRED_BY_TYPE = {
    "Course": ["name", "description"],
    "Movie": ["name", "image"],
    "Recipe": ["name", "image"],
    "Restaurant": ["name", "image"],
}


def host_of(url):
    return urlparse(url).hostname if is_absolute_url(url) else None


# Summary page: every item links to its own detail page, all on one domain.
# All-in-one page: every item is described on this page under its own anchor.
def choose_carousel_pattern(source):
    items = source.get("items") or []
    hosts = {host_of(i.get("detailUrl")) for i in items}
    if items and len(hosts) == 1 and None not in hosts:
        return "summary"
    if items and all(i.get("anchor") and i.get("properties") for i in items):
        return "allInOne"
    return None


def build_summary_elements(items):
    urls = [i["detailUrl"] for i in items]
    if len(set(urls)) != len(urls):
        return None  # every url must be unique
    return [{"@type": "ListItem", "position": index + 1, "url": i["detailUrl"]} for index, i in enumerate(items)]


def build_all_in_one_elements(source):
    item_type = source.get("itemType")
    required = REQUIRED_BY_TYPE.get(item_type)
    if not required:
        return None  # Course, Movie, Recipe or Restaurant only
    anchors = [i["anchor"] for i in source["items"]]
    if len(set(anchors)) != len(anchors):
        return None  # one unique anchor per item

    elements = []
    for index, i in enumerate(source["items"]):
        # item.url is this page plus the anchor of the visible item.
        item = compact({"@type": item_type, **i["properties"], "url": f"{source['url']}#{i['anchor']}"})
        if not item or any(key not in item for key in required):
            return None
        images = item.get("image")
        if images is not None:
            images = images if isinstance(images, list) else [images]
            if not all(is_absolute_url(u if isinstance(u, str) else u.get("url")) for u in images):
                return None
        elements.append({"@type": "ListItem", "position": index + 1, "item": item})
    return elements


def build_carousel_schema(source):
    if not passes_page_gates(source):
        return None
    items = source.get("items") or []
    if len(items) < 2:
        return None  # an ItemList needs at least two ListItems

    pattern = choose_carousel_pattern(source)
    if pattern == "summary":
        item_list_element = build_summary_elements(items)
    elif pattern == "allInOne":
        item_list_element = build_all_in_one_elements(source)
    else:
        item_list_element = None  # never mix patterns in one list
    if not item_list_element:
        return None

    return compact({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": item_list_element,
    })


# Usage: json_ld = build_carousel_schema(source)  # same source dict as the JS example; None means emit nothing
