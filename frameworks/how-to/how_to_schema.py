import re
from urllib.parse import urlparse


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


ISO_DURATION = re.compile(r"^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$")


def to_iso_duration(value):
    # accepts an ISO 8601 duration string or a whole number of minutes
    if isinstance(value, str):
        return value.strip() if ISO_DURATION.match(value.strip()) else None
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        return None
    hours, minutes = divmod(value, 60)
    return "PT" + (f"{hours}H" if hours else "") + (f"{minutes}M" if minutes else "")


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


def build_step(step, index, page_url):
    text = (step.get("text") or "").strip()
    if not text:
        return None
    return {
        "@type": "HowToStep",
        "position": index + 1,
        "name": step.get("name"),
        "text": text,
        "url": page_url + "#" + step["anchor"] if step.get("anchor") else None,
        "image": step.get("image") if is_absolute_url(step.get("image")) else None,
    }


def build_how_to_schema(source):
    # Google retired How-to rich results in Sep 2023: no rich result, no Google required properties.
    # Emit only when the steps are visible on the page, for schema.org semantics and other consumers.
    if source.get("indexable") is False:
        return None
    if not is_absolute_url(source.get("url")):
        return None
    if source.get("canonicalUrl") and source["canonicalUrl"] != source["url"]:
        return None
    if source.get("stepsVisible") is not True:
        return None

    name = (source.get("title") or "").strip()
    steps = [build_step(s, i, source["url"]) for i, s in enumerate(source.get("steps") or [])]
    if not name or not steps or None in steps:
        return None

    schema = {
        "@context": "https://schema.org",
        "@type": "HowTo",
        "name": name,
        "description": source.get("description"),
        "image": source.get("image") if is_absolute_url(source.get("image")) else None,
        "totalTime": to_iso_duration(source.get("totalMinutes")),
        "supply": [{"@type": "HowToSupply", "name": s} for s in source.get("supplies") or []],
        "tool": [{"@type": "HowToTool", "name": t} for t in source.get("tools") or []],
        "step": steps,
    }

    return compact(schema)


# Usage:
# build_how_to_schema({
#     "url": "https://www.example.com/guides/replace-bike-chain",
#     "canonicalUrl": "https://www.example.com/guides/replace-bike-chain",
#     "indexable": True,
#     "stepsVisible": True,
#     "title": "How to replace a bike chain",
#     "description": "Swap a worn 11-speed chain with a chain tool and a quick link.",
#     "image": "https://www.example.com/guides/replace-bike-chain/hero.jpg",
#     "totalMinutes": 25,
#     "supplies": ["11-speed chain", "Quick link"],
#     "tools": ["Chain tool", "Chain checker"],
#     "steps": [
#         {"name": "Check wear", "text": "Measure the old chain with a chain checker; replace it at 0.5% stretch.", "anchor": "step-1"},
#         {"name": "Remove the old chain", "text": "Open the quick link or push out a pin with the chain tool.", "anchor": "step-2"},
#         {"name": "Size and fit the new chain", "text": "Match the old chain length, thread it through the derailleur and close the quick link.", "anchor": "step-3", "image": "https://www.example.com/guides/replace-bike-chain/quick-link.jpg"},
#     ],
# })
