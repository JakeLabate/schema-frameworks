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


ORCID = re.compile(r"^https://orcid\.org/\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")
ROR = re.compile(r"^https://ror\.org/0[a-hj-km-np-tv-z0-9]{6}\d{2}$")
DOI = re.compile(r"^10\.\d{4,9}/\S+$")
PARTIAL_DATE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


# Formats a number the way JavaScript prints it (42.0 becomes "42").
def js_number(value):
    return str(int(value)) if float(value).is_integer() else repr(value)


def text_length(value):
    return len(value.strip()) if isinstance(value, str) else 0


# "2016", "2016-05", "2016-05-01" or a full ISO 8601 date time.
def to_temporal_point(value):
    m = PARTIAL_DATE.match(value) if isinstance(value, str) else None
    if m and m[3]:
        return to_iso_date(value)
    if m:
        return value if not m[2] or 1 <= int(m[2]) <= 12 else None
    return to_iso_date_time(value) if isinstance(value, str) and "T" in value else None


# ISO 8601 date or interval: "2008", "1950-01-01/2013-12-18", or "2013-12-19/.." for an open end.
def to_temporal_coverage(value):
    if not isinstance(value, str):
        return None
    parts = value.strip().split("/")
    start = parts[0]
    if len(parts) > 2 or not to_temporal_point(start):
        return None
    if len(parts) == 1:
        return start
    end = parts[1]
    if end == "..":
        return f"{start}/.."
    if not to_temporal_point(end):
        return None
    first = f"{start}-01-01" if len(start) == 4 else f"{start}-01" if len(start) == 7 else start[:10]
    last = f"{end}-12-31" if len(end) == 4 else f"{end}-31" if len(end) == 7 else end[:10]
    return f"{start}/{end}" if first <= last else None  # the interval must not run backwards


def is_lat_long(lat, long):
    return is_number(lat) and is_number(long) and abs(lat) <= 90 and abs(long) <= 180


# A named place, a GeoCoordinates point, or a GeoShape box ("lat1 long1 lat2 long2", latitude first).
def build_spatial_coverage(place):
    if isinstance(place, str):
        return place
    if not place:
        return None
    if place.get("point"):
        lat, long = place["point"].get("lat"), place["point"].get("long")
        if not is_lat_long(lat, long):
            return None
        return {"@type": "Place", "name": place.get("name"), "geo": {"@type": "GeoCoordinates", "latitude": lat, "longitude": long}}
    box = place.get("box")
    if isinstance(box, list) and len(box) == 4:
        if not is_lat_long(box[0], box[1]) or not is_lat_long(box[2], box[3]):
            return None
        return {"@type": "Place", "name": place.get("name"), "geo": {"@type": "GeoShape", "box": " ".join(js_number(n) for n in box)}}
    return place.get("name")


# Person: name, givenName, familyName, url, ORCID sameAs. Organization: name, url, ROR sameAs.
def build_agent(agent):
    if not agent or not agent.get("name"):
        return None
    url = agent.get("url") if is_absolute_url(agent.get("url")) else None
    if agent.get("type") == "person":
        return {
            "@type": "Person",
            "name": agent["name"],
            "givenName": agent.get("givenName"),
            "familyName": agent.get("familyName"),
            "url": url,
            "sameAs": agent.get("orcid") if ORCID.match(agent.get("orcid") or "") else None,
        }
    return {
        "@type": "Organization",
        "name": agent["name"],
        "url": url,
        "sameAs": agent.get("ror") if ROR.match(agent.get("ror") or "") else None,
    }


# Bare DOIs become resolvable https://doi.org/ URLs; other identifiers stay as given.
def to_identifier(value):
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    return f"https://doi.org/{text}" if DOI.match(text) else text


def build_variable(variable):
    if isinstance(variable, str):
        return variable
    if not variable or not variable.get("name"):
        return None
    return {"@type": "PropertyValue", "name": variable["name"], "unitText": variable.get("unit"), "description": variable.get("description")}


def build_distribution(file):
    # contentUrl is required on every DataDownload.
    if not file or not is_absolute_url(file.get("contentUrl")):
        return None
    return {"@type": "DataDownload", "contentUrl": file["contentUrl"], "encodingFormat": file.get("encodingFormat")}


# A related dataset as a URL, or as a Dataset with its own name and valid description.
def build_related_dataset(part):
    if is_absolute_url(part):
        return part
    if not isinstance(part, dict):
        return None
    length = text_length(part.get("description"))
    if not part.get("name") or length < 50 or length > 5000:
        return None
    url = part.get("url") if is_absolute_url(part.get("url")) else None
    return {"@type": "Dataset", "name": part["name"], "description": part["description"].strip(), "url": url}


def build_dataset_schema(source):
    # (a) Page gates: the indexable, self-canonical landing page for this dataset, with the metadata visible.
    if not passes_page_gates(source) or not is_absolute_url(source.get("url")):
        return None

    # (b) Required: name, and a description between 50 and 5000 characters.
    length = text_length(source.get("description"))
    if not source.get("name") or length < 50 or length > 5000:
        return None

    identifier = [i for i in (to_identifier(v) for v in source.get("identifiers") or []) if i]
    catalog = source.get("catalog") or {}

    # (c) Recommended properties, only when the source has them; (d) value rules inline.
    schema = {
        "@context": "https://schema.org",
        "@type": "Dataset",
        "@id": f"{source['url']}#dataset",
        "name": source["name"],
        "description": source["description"].strip(),
        "alternateName": source.get("alternateNames"),
        "url": source["url"],
        "sameAs": [u for u in source.get("sameAs") or [] if is_absolute_url(u)],  # the canonical page when republished
        "identifier": identifier,  # repeat for multiple DOIs or Compact Identifiers
        "version": source.get("version"),
        "keywords": source.get("keywords"),
        "license": source.get("license") if is_absolute_url(source.get("license")) else None,  # a URL for one specific license version
        "isAccessibleForFree": source.get("free") if isinstance(source.get("free"), bool) else None,
        "creator": [build_agent(a) for a in source.get("creators") or []],
        "funder": [build_agent(a) for a in source.get("funders") or []],
        "citation": [c for c in source.get("citations") or [] if to_identifier(c) not in identifier],  # related articles, not the dataset itself
        "temporalCoverage": to_temporal_coverage(source.get("temporalCoverage")),
        "spatialCoverage": build_spatial_coverage(source.get("spatialCoverage")),
        "variableMeasured": [build_variable(v) for v in source.get("variables") or []],
        "measurementTechnique": source.get("measurementTechniques"),
        "isPartOf": [build_related_dataset(p) for p in source.get("partOf") or []],
        "hasPart": [build_related_dataset(p) for p in source.get("parts") or []],
        "includedInDataCatalog": {
            "@type": "DataCatalog",
            "name": catalog["name"],
            "url": catalog.get("url") if is_absolute_url(catalog.get("url")) else None,
        } if catalog.get("name") else None,
        "distribution": [build_distribution(f) for f in source.get("files") or []],
    }

    # (e) Strip empty values.
    return compact(schema)
