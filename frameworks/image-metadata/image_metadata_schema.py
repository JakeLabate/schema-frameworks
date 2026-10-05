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


# Image metadata helpers
def build_creator(creator):
    if not creator or not creator.get("name"):
        return None  # creator object needs name
    return {
        "@type": "Organization" if creator.get("type") == "Organization" else "Person",
        "name": creator["name"],
        "url": creator.get("url") if is_absolute_url(creator.get("url")) else None,
    }


# One ImageObject per image; contentUrl tells Google which image the metadata applies to.
def build_image_object_schema(source):
    page = source.get("page")
    image = source.get("image") or {}
    if not passes_page_gates(page) or not image.get("visibleOnPage"):
        return None

    # Required: contentUrl (absolute).
    if not is_absolute_url(image.get("contentUrl")):
        return None

    license_url = image.get("licenseUrl") if is_absolute_url(image.get("licenseUrl")) else None
    creators = [c for c in (build_creator(c) for c in (image.get("creators") or [])) if c]
    schema = {
        "@context": "https://schema.org",
        "@type": "ImageObject",
        "contentUrl": image["contentUrl"],
        "license": license_url,  # needed for the Licensable badge
        "acquireLicensePage": image.get("acquireLicenseUrl")
        if is_absolute_url(image.get("acquireLicenseUrl")) else None,
        "creditText": image.get("creditText"),
        "copyrightNotice": image.get("copyrightNotice"),
        "creator": creators if len(creators) > 1 else (creators[0] if creators else None),
    }

    # Required either-or: at least one of creator, creditText, copyrightNotice, license.
    if not any(schema[k] for k in ("creator", "creditText", "copyrightNotice", "license")):
        return None

    return compact(schema)
