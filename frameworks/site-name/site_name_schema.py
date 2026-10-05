import re
from datetime import date, datetime, timezone
from urllib.parse import urlsplit

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


# Legal suffixes belong in Organization legalName, not in the site name ("Google", not "Google, Inc").
LEGAL_SUFFIX = re.compile(r"(?:,\s*|\s+)(?:inc|llc|ltd|limited|corp|corporation|gmbh|plc)\.?$", re.I)


def clean_name(value):
    text = re.sub(r"\s+", " ", value.strip()) if isinstance(value, str) else ""
    return text if text and not LEGAL_SUFFIX.search(text) else None


# The canonical home page of a domain or subdomain: root path, no query or fragment.
def to_home_url(value):
    if not is_absolute_url(value):
        return None
    url = urlsplit(value)
    if url.path != "/" or url.query or url.fragment:
        return None
    return f"{url.scheme.lower()}://{url.netloc.lower()}/"


def build_website_schema(source):
    # (a) Page gates: indexable, self-canonical, and the home page at the domain or subdomain root.
    #     Subdirectory home pages such as https://example.com/news are not supported.
    if not passes_page_gates(source):
        return None
    home_url = to_home_url(source.get("url"))
    if not home_url:
        return None

    # (b) Required: name and url. The name must be concise and match og:site_name,
    #     the title and the Organization name; a mismatch is fixed in the source, not shipped.
    name = clean_name(source.get("siteName"))
    if not name:
        return None
    other_names = [n for n in (source.get("ogSiteName"), source.get("organizationName")) if n]
    if any(other.strip() != name for other in other_names):
        return None
    if source.get("title") and name not in source["title"]:
        return None

    # alternateName: in order of preference, deduplicated, never the name itself.
    alternate_name = []
    for alt in (clean_name(a) for a in source.get("alternateNames") or []):
        if alt and alt.lower() != name.lower() and alt not in alternate_name:
            alternate_name.append(alt)

    # (c) Required plus recommended properties; (d) one WebSite node per site: if the page already
    #     has WebSite markup, merge into it. No SearchAction: the sitelinks search box was retired in Nov 2024.
    schema = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": f"{home_url}#website",
        "name": name,
        "alternateName": alternate_name,
        "url": home_url,
        "publisher": {"@id": source["organizationId"]} if is_absolute_url(source.get("organizationId")) else None,
    }

    # (e) Strip empty values.
    return compact(schema)
