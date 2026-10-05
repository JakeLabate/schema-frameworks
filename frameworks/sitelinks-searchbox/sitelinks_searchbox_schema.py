import re
from urllib.parse import urlparse


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def is_root_url(value):
    # site name markup works at domain or subdomain level only, never a subdirectory
    if not is_absolute_url(value):
        return False
    parsed = urlparse(value)
    return parsed.path == "/" and not parsed.query and not parsed.fragment


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


LEGAL_SUFFIX = re.compile(r",?\s+(inc|llc|ltd|gmbh|corp)\.?$", re.I)


def build_search_action(template):
    # optional and earns no Google feature since Nov 2024; keep only if real site search exists
    if not is_absolute_url(template) or "{search_term_string}" not in template:
        return None
    return {
        "@type": "SearchAction",
        "target": {"@type": "EntryPoint", "urlTemplate": template},
        "query-input": "required name=search_term_string",
    }


def build_website_schema(source):
    # home page gates: indexable, self-canonical, root of the domain or subdomain
    if source.get("indexable") is False:
        return None
    if not is_root_url(source.get("url")):
        return None
    if source.get("canonicalUrl") and source["canonicalUrl"] != source["url"]:
        return None

    # site name: required, concise, no legal suffix, same as og:site_name and the title
    name = (source.get("siteName") or "").strip()
    if not name or LEGAL_SUFFIX.search(name):
        return None

    schema = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": name,
        "alternateName": [n for n in source.get("alternateNames") or [] if n and n != name],  # order of preference
        "url": source["url"],
        "potentialAction": build_search_action(source.get("searchUrlTemplate")) if source.get("hasSiteSearch") else None,
    }

    return compact(schema)


# Usage:
# build_website_schema({
#     "url": "https://www.example.com/",
#     "canonicalUrl": "https://www.example.com/",
#     "indexable": True,
#     "siteName": "Example Outfitters",
#     "alternateNames": ["EO", "Example Outfitters Store"],
#     "hasSiteSearch": True,
#     "searchUrlTemplate": "https://www.example.com/search?q={search_term_string}",
# })
