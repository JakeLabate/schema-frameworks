import re
from datetime import date, datetime
from datetime import timezone

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


S = "https://schema.org/"
AVAILABILITY = ["BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "SoldOut"]
CONDITIONS = ["NewCondition", "RefurbishedCondition", "UsedCondition"]
RETURN_CATEGORY = {"finite": "MerchantReturnFiniteReturnWindow", "not_permitted": "MerchantReturnNotPermitted", "unlimited": "MerchantReturnUnlimitedWindow"}
RETURN_FEES = {"free": "FreeReturn", "customer_pays": "ReturnFeesCustomerResponsibility", "shipping_fee": "ReturnShippingFees"}
RETURN_METHOD = {"kiosk": "ReturnAtKiosk", "mail": "ReturnByMail", "in_store": "ReturnInStore"}
GENDERS = ["male", "female", "unisex"]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


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


def is_country_code(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Z]{2}", value) is not None


def is_region_code(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Z0-9]{1,3}", value) is not None


def is_gtin(value):  # numeric only, never a URL
    return re.fullmatch(r"\d{8}|\d{12,14}", str(value if value is not None else "")) is not None


def is_sku(value):  # no whitespace
    return isinstance(value, str) and re.fullmatch(r"\S+", value) is not None


def is_iso_time(value):
    return isinstance(value, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?(Z|[+-]\d{2}:\d{2})", value) is not None


def schema_enum(value, allowed):
    return S + value if value in allowed else None


# Comparable instant; date-only and offset-less values are read as UTC.
def to_instant(iso):
    if len(iso) == 10:
        iso += "T00:00:00"
    moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def whole_number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


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


def build_region(country, regions=None, postal_codes=None):
    if not is_country_code(country):
        return None
    return {
        "@type": "DefinedRegion",
        "addressCountry": country,
        "addressRegion": [r for r in (regions or []) if is_region_code(r)],  # ISO 3166-2 subdivision without the country prefix
        "postalCode": [p for p in (postal_codes or []) if isinstance(p, str) and p.strip()],
    }


def days_range(pair):
    lo, hi = (list(pair or []) + [None, None])[:2]
    if whole_number(lo) is not None and whole_number(hi) is not None and lo <= hi:
        return {"@type": "QuantitativeValue", "minValue": lo, "maxValue": hi, "unitCode": "DAY"}
    return None


# One OfferShippingDetails per destination: shippingRate, shippingDestination and deliveryTime are required in it.
def build_shipping(s, origin):
    s = s or {}
    origin = origin or {}
    destination = build_region(s.get("country"), s.get("regions"), s.get("postalCodes"))
    rate = to_number(s.get("rate"))
    handling_time = days_range(s.get("handlingDays"))
    transit_time = days_range(s.get("transitDays"))
    if not destination or rate is None or rate < 0 or not is_currency_code(s.get("currency")):
        return None  # value 0 means free shipping
    if not handling_time and not transit_time:
        return None
    days = [d for d in (s.get("businessDays") or []) if d in WEEKDAYS]
    return {
        "@type": "OfferShippingDetails",
        "shippingRate": {"@type": "MonetaryAmount", "value": rate, "currency": s["currency"]},
        "shippingDestination": destination,
        "shippingOrigin": build_region(origin.get("country"), origin.get("regions")),
        "deliveryTime": {
            "@type": "ShippingDeliveryTime",
            "handlingTime": handling_time,
            "transitTime": transit_time,
            "cutoffTime": s["cutoffTime"] if is_iso_time(s.get("cutoffTime")) else None,
            "businessDays": {"@type": "OpeningHoursSpecification", "dayOfWeek": [S + d for d in days]} if days else None,
        },
    }


# Finite windows need merchantReturnDays; ReturnShippingFees needs returnShippingFeesAmount.
def build_return_policy(r):
    r = r or {}
    countries = [c for c in (r.get("countries") or []) if is_country_code(c)][:50]
    category = RETURN_CATEGORY.get(r.get("category"))
    if not category or not countries:
        return None
    finite = category == "MerchantReturnFiniteReturnWindow"
    days = whole_number(r.get("days"))
    if finite and not (days is not None and days > 0):
        return None
    fee = to_number(r.get("feeAmount"))
    charges_shipping = r.get("fees") == "shipping_fee"
    if charges_shipping and not (fee is not None and fee >= 0 and is_currency_code(r.get("feeCurrency"))):
        return None
    return {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": countries,
        "returnPolicyCountry": [c for c in (r.get("returnToCountries") or []) if is_country_code(c)],
        "returnPolicyCategory": S + category,
        "merchantReturnDays": days if finite else None,
        "returnMethod": [S + RETURN_METHOD[m] for m in (r.get("methods") or []) if m in RETURN_METHOD],
        "returnFees": S + RETURN_FEES[r["fees"]] if r.get("fees") in RETURN_FEES else None,
        "returnShippingFeesAmount": {"@type": "MonetaryAmount", "value": fee, "currency": r["feeCurrency"]} if charges_shipping else None,
        "merchantReturnLink": r["link"] if is_absolute_url(r.get("link")) else None,
    }


# Extra UnitPriceSpecification entries: strikethrough, member tier and unit pricing.
# An active price has neither priceType nor validForMemberTier; never combine the two.
def build_price_specifications(offer, price, currency):
    specs = []
    was = to_number(offer.get("strikethroughPrice"))
    if was is not None and was > price:
        specs.append({"@type": "UnitPriceSpecification", "priceType": S + "StrikethroughPrice", "price": was, "priceCurrency": currency})
    member = offer.get("memberPrice") or {}
    member_price = to_number(member.get("price"))
    if member_price is not None and member_price > 0 and is_absolute_url(member.get("tierId")):
        specs.append({
            "@type": "UnitPriceSpecification",
            "price": member_price,
            "priceCurrency": currency,
            "validForMemberTier": {"@id": member["tierId"]},  # tier defined under Organization.hasMemberProgram
            "membershipPointsEarned": whole_number(member.get("pointsEarned")),
        })
    unit = offer.get("unitPricing") or {}
    quantity = to_number(unit.get("value"))
    base = to_number(unit.get("baseValue"))
    if quantity is not None and quantity > 0 and re.fullmatch(r"[A-Z0-9]{2,3}", unit.get("unitCode") or ""):
        specs.append({
            "@type": "UnitPriceSpecification",
            "price": price,
            "priceCurrency": currency,
            "referenceQuantity": {
                "@type": "QuantitativeValue",
                "value": quantity,
                "unitCode": unit["unitCode"],  # for example ML
                "valueReference": {"@type": "QuantitativeValue", "value": base, "unitCode": unit.get("baseUnitCode") or unit["unitCode"]}
                if base is not None and base > 0 else None,
            },
        })
    return specs


# A single Offer (AggregateOffer is not supported) with price > 0 and an ISO 4217 currency.
def build_offer(offer, source, now):
    if not offer or "lowPrice" in offer:
        return None
    price = to_number(offer.get("price"))
    currency = offer.get("currency")
    if not (price is not None and price > 0) or not is_currency_code(currency):
        return None

    # Sale window: validFrom must not be later than validThrough or priceValidUntil.
    valid_until = to_iso_date(offer.get("priceValidUntil"))
    price_valid_until = valid_until if valid_until and to_instant(valid_until + "T23:59:59") >= now else None  # a past date can hide the listing
    valid_from = to_iso_date_time(offer.get("validFrom"))
    valid_through = to_iso_date_time(offer.get("validThrough"))
    end = to_instant(valid_through) if valid_through else to_instant(price_valid_until + "T23:59:59") if price_valid_until else None
    if valid_from and end is not None and to_instant(valid_from) > end:
        valid_from = valid_through = None

    return {
        "@type": "Offer",
        "url": offer["url"] if is_absolute_url(offer.get("url")) else None,
        "price": price,
        "priceCurrency": currency,
        "priceSpecification": build_price_specifications(offer, price, currency),
        "priceValidUntil": price_valid_until,
        "validFrom": valid_from,
        "validThrough": valid_through,
        "availability": schema_enum(offer.get("availability"), AVAILABILITY),
        "itemCondition": schema_enum(offer.get("condition"), CONDITIONS),
        "shippingDetails": [build_shipping(s, source.get("shipsFrom")) for s in (source.get("shipping") or [])],
        "hasMerchantReturnPolicy": build_return_policy(source.get("returns")),
    }


def build_audience(a):
    if not a:
        return None
    lo = to_number(a.get("minAge"))
    hi = to_number(a.get("maxAge"))
    return {
        "@type": "PeopleAudience",
        "suggestedGender": a.get("gender") if a.get("gender") in GENDERS else None,
        "suggestedMinAge": lo if lo is not None and lo >= 0 else None,
        "suggestedMaxAge": hi if hi is not None and hi >= 0 and (lo is None or hi >= lo) else None,
    }


def build_merchant_listing_schema(source, now=None):
    now = now or datetime.now(timezone.utc)
    if not passes_page_gates(source):
        return None
    if source.get("purchasable") is not True:
        return None  # no checkout on this page: use the Product snippet framework

    name = str(source.get("name") or "").strip()
    images = [i for i in (source.get("images") or []) if is_absolute_url(i)]
    offers = build_offer(source.get("offer"), source, now)
    if not name or not images or not offers:
        return None  # name, image and offers are required

    return compact({
        "@context": "https://schema.org",
        "@type": "Product",
        "name": name,
        "image": images,
        "description": source.get("description"),
        "sku": source["sku"] if is_sku(source.get("sku")) else None,
        "mpn": source.get("mpn"),
        "gtin": str(source["gtin"]) if is_gtin(source.get("gtin")) else None,
        "brand": {"@type": "Brand", "name": source["brand"]} if source.get("brand") else None,
        "category": source.get("category"),
        "color": source.get("color"),
        "material": source.get("material"),
        "pattern": source.get("pattern"),
        "size": source.get("size"),
        "audience": build_audience(source.get("audience")),
        "aggregateRating": build_rating(source.get("rating"), "AggregateRating"),
        "review": [r for r in (build_review(x) for x in (source.get("reviews") or [])) if r],
        "offers": offers,
    })
