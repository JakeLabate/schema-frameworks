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


BOOLEAN_AMENITIES = {
    "ac", "airportShuttle", "balcony", "beachAccess", "childFriendly", "crib", "elevator", "fireplace",
    "freeBreakfast", "gymFitnessEquipment", "heating", "hotTub", "instantBookable", "ironingBoard", "kitchen",
    "microwave", "outdoorGrill", "ovenStove", "patio", "petsAllowed", "pool", "privateBeachAccess",
    "selfCheckinCheckout", "smokingAllowed", "tv", "washerDryer", "wheelchairAccessible", "wifi",
}
TEXT_AMENITIES = {
    "internetType": ["Free", "Paid", "None"],
    "parkingType": ["Free", "Paid", "None"],
    "poolType": ["Indoor", "Outdoor", "None"],
}
RENTAL_TYPES = ["Apartment", "Bungalow", "Cabin", "Chalet", "Cottage", "Gite", "HolidayVillageRental", "House", "Villa", "VacationRental"]
PLACE_TYPES = ["EntirePlace", "PrivateRoom", "SharedRoom"]
TIME = re.compile(r"^\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$")


def one_of(value, allowed):
    return value if value in allowed else None


# latitude and longitude need at least 5 decimal places in the emitted number.
def to_coordinate(value):
    num = to_number(value)
    return num if num is not None and re.fullmatch(r"-?\d+\.\d{5,}", repr(num)) else None


# Boolean amenities take true/false; typed amenities take their enum; licenseNum is repeatable text.
def build_amenities(amenities):
    features = []
    for name, value in (amenities or {}).items():
        if name in BOOLEAN_AMENITIES and isinstance(value, bool):
            features.append({"name": name, "value": value})
        elif value in TEXT_AMENITIES.get(name, []):
            features.append({"name": name, "value": value})
        elif name == "licenseNum":
            for v in value if isinstance(value, list) else [value]:
                if v:
                    features.append({"name": name, "value": str(v)})
    return [{"@type": "LocationFeatureSpecification", **f} for f in features]


def build_accommodation(unit):
    unit = unit or {}
    occupancy = to_number(unit.get("maxGuests"))
    if not isinstance(occupancy, int) or occupancy < 1:
        return None
    floor = unit.get("floorSize") or {}
    floor_area = to_number(floor.get("value"))
    return {
        "@type": "Accommodation",
        "additionalType": one_of(unit.get("placeType"), PLACE_TYPES),
        "occupancy": {"@type": "QuantitativeValue", "value": occupancy},
        "numberOfBedrooms": to_number(unit.get("bedrooms")),
        "numberOfBathroomsTotal": to_number(unit.get("bathrooms")),
        "numberOfRooms": to_number(unit.get("rooms")),
        "floorSize": {"@type": "QuantitativeValue", "value": floor_area, "unitCode": floor["unitCode"]}
        if floor_area and floor_area > 0 and floor.get("unitCode") in ("FTK", "SQFT", "MTK", "SQM") else None,
        "bed": [
            {"@type": "BedDetails", "numberOfBeds": b["count"], "typeOfBed": b.get("type")}
            for b in unit.get("beds") or []
            if isinstance(b.get("count"), int) and b["count"] > 0
        ],
        "amenityFeature": build_amenities(unit.get("amenities")),
    }


def build_vacation_rental_schema(source):
    if not passes_page_gates(source):
        return None

    # Required: name, identifier, 8+ images (bedroom, bathroom, common area), precise coordinates, one Accommodation.
    name = str(source.get("name") or "").strip()
    identifier = str(source.get("listingId") or "").strip()
    images = [img for img in source.get("images") or [] if is_absolute_url(img.get("url"))]
    rooms = {img.get("room") for img in images}
    has_room_mix = all(room in rooms for room in ("bedroom", "bathroom", "common"))
    latitude = to_coordinate(source.get("latitude"))
    longitude = to_coordinate(source.get("longitude"))
    contains_place = build_accommodation(source.get("unit"))
    if not name or not identifier or len(images) < 8 or not has_room_mix or latitude is None or longitude is None or not contains_place:
        return None

    address = source.get("address")
    country = address.get("country") if address and re.fullmatch(r"[A-Z]{2}", address.get("country") or "") else None

    # Reviews need datePublished; properties in France also need contentReferenceTime (start of the stay).
    reviews = []
    for r in source.get("reviews") or []:
        review = build_review(r)
        content_reference_time = to_iso_date_time(r.get("stayStartDate"))
        if not review or not review["datePublished"] or (country == "FR" and not content_reference_time):
            continue
        reviews.append({**review, "contentReferenceTime": content_reference_time})

    return compact({
        "@context": "https://schema.org",
        "@type": "VacationRental",
        "additionalType": one_of(source.get("rentalType"), RENTAL_TYPES),
        "name": name,
        "identifier": identifier,
        "url": source.get("url"),
        "description": source.get("description"),
        "brand": {"@type": "Brand", "name": source["hotelCenterBrandId"]} if source.get("hotelCenterBrandId") else None,
        "image": [img["url"] for img in images],
        "latitude": latitude,
        "longitude": longitude,
        "address": {
            "@type": "PostalAddress",
            "streetAddress": address.get("street"),
            "addressLocality": address.get("city"),
            "addressRegion": address.get("region"),
            "postalCode": address.get("postalCode"),
            "addressCountry": country,
        } if address else None,
        "checkinTime": source.get("checkinTime") if TIME.match(source.get("checkinTime") or "") else None,
        "checkoutTime": source.get("checkoutTime") if TIME.match(source.get("checkoutTime") or "") else None,
        "knowsLanguage": [l for l in source.get("hostLanguages") or [] if re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*", l)],
        "containsPlace": contains_place,
        "aggregateRating": build_rating(source.get("rating"), "AggregateRating"),
        "review": reviews,
    })
