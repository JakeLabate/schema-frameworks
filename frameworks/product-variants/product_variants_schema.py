import re
import json
from datetime import date, datetime
from urllib.parse import quote, urlsplit

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
VARIES_BY = ["color", "size", "suggestedAge", "suggestedGender", "material", "pattern"]
AVAILABILITY = ["BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "SoldOut"]
CONDITIONS = ["NewCondition", "RefurbishedCondition", "UsedCondition"]
RETURN_CATEGORY = {"finite": "MerchantReturnFiniteReturnWindow", "not_permitted": "MerchantReturnNotPermitted", "unlimited": "MerchantReturnUnlimitedWindow"}
RETURN_FEES = {"free": "FreeReturn", "customer_pays": "ReturnFeesCustomerResponsibility"}
GENDERS = ["male", "female", "unisex"]


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


def is_gtin(value):
    return re.fullmatch(r"\d{8}|\d{12,14}", str(value if value is not None else "")) is not None


def is_sku(value):
    return isinstance(value, str) and re.fullmatch(r"\S+", value) is not None


def schema_enum(value, allowed):
    return S + value if value in allowed else None


def whole_number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def base_url(url):
    return re.split(r"[?#]", url)[0]


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


def days_range(pair):
    lo, hi = (list(pair or []) + [None, None])[:2]
    if whole_number(lo) is not None and whole_number(hi) is not None and lo <= hi:
        return {"@type": "QuantitativeValue", "minValue": lo, "maxValue": hi, "unitCode": "DAY"}
    return None


# Shared by every variant. Full shipping and return options: see the Merchant Listing framework.
def build_shipping(s):
    s = s or {}
    rate = to_number(s.get("rate"))
    handling_time = days_range(s.get("handlingDays"))
    transit_time = days_range(s.get("transitDays"))
    if rate is None or rate < 0 or not is_currency_code(s.get("currency")) or not is_country_code(s.get("country")):
        return None
    if not handling_time and not transit_time:
        return None
    return {
        "@type": "OfferShippingDetails",
        "shippingRate": {"@type": "MonetaryAmount", "value": rate, "currency": s["currency"]},
        "shippingDestination": {"@type": "DefinedRegion", "addressCountry": s["country"]},
        "deliveryTime": {"@type": "ShippingDeliveryTime", "handlingTime": handling_time, "transitTime": transit_time},
    }


def build_return_policy(r):
    r = r or {}
    category = RETURN_CATEGORY.get(r.get("category"))
    days = whole_number(r.get("days"))
    if not category or not is_country_code(r.get("country")):
        return None
    if category == "MerchantReturnFiniteReturnWindow" and not (days is not None and days > 0):
        return None
    return {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": r["country"],
        "returnPolicyCategory": S + category,
        "merchantReturnDays": days if category == "MerchantReturnFiniteReturnWindow" else None,
        "returnFees": S + RETURN_FEES[r["fees"]] if r.get("fees") in RETURN_FEES else None,
    }


# Each variant meets merchant listing rules: one Offer, price > 0, ISO 4217 currency.
def build_variant_offer(offer, url, shared):
    offer = offer or {}
    price = to_number(offer.get("price"))
    if not (price is not None and price > 0) or not is_currency_code(offer.get("currency")):
        return None
    return {
        "@type": "Offer",
        "url": url,
        "price": price,
        "priceCurrency": offer["currency"],
        "availability": schema_enum(offer.get("availability"), AVAILABILITY),
        "itemCondition": schema_enum(offer.get("condition") or "NewCondition", CONDITIONS),
        "shippingDetails": build_shipping(shared.get("shipping")),
        "hasMerchantReturnPolicy": build_return_policy(shared.get("returns")),
    }


# Single-page: every variant is preselected on the group URL with query parameters (?color=green&size=m).
# Multi-page: each variant has its own page, and each page repeats the full group markup.
def choose_variant_approach(source):
    group_url = base_url(source["url"]) if is_absolute_url(source.get("url")) else None
    variants = source.get("variants") or []

    def on_group_url(v):
        return isinstance(v.get("url"), str) and v["url"].startswith(f"{group_url}?")

    return "single-page" if group_url and variants and all(on_group_url(v) for v in variants) else "multi-page"


# Values for each variesBy property; None when a variant does not state one.
def variant_attributes(variant, varies_by):
    attributes = {}
    for key in varies_by:
        value = variant.get(key)
        if value is None or value == "":
            return None
        attributes[key] = value
    return attributes


def build_variant(variant, ctx):
    name = str(variant.get("name") or "").strip()
    sku = variant["sku"] if is_sku(variant.get("sku")) else None
    gtin = str(variant["gtin"]) if is_gtin(variant.get("gtin")) else None
    images = [i for i in (variant.get("images") or []) if is_absolute_url(i)]
    attributes = variant_attributes(variant, ctx["variesBy"])
    url = variant["url"] if is_absolute_url(variant.get("url")) else None  # a distinct URL that preselects this variant
    offers = build_variant_offer(variant.get("offer"), url, ctx["shared"])
    if not name or (not sku and not gtin) or attributes is None or not url or not images or not offers:
        return None

    gender = attributes.pop("suggestedGender", None)  # audience attributes go on PeopleAudience
    age = attributes.pop("suggestedAge", None)
    min_age, max_age = (list(age or []) + [None, None])[:2]
    return {
        "@type": "Product",
        "name": name,
        "sku": sku,
        "gtin": gtin,
        "image": images,
        "description": variant.get("description"),
        "inProductGroupWithID": ctx["groupId"],
        "isVariantOf": {"@id": ctx["groupRef"]},
        **attributes,
        "audience": {
            "@type": "PeopleAudience",
            "suggestedGender": gender if gender in GENDERS else None,
            "suggestedMinAge": to_number(min_age),
            "suggestedMaxAge": to_number(max_age),
        } if gender or age else None,
        "url": url,
        "offers": offers,
    }


def build_product_group_schema(source):
    if not passes_page_gates(source):
        return None
    name = str(source.get("name") or "").strip()
    group_id = source["groupId"] if is_sku(source.get("groupId")) else None  # productGroupID, usually the parent sku
    varies_by = [v for v in (source.get("variesBy") or []) if v in VARIES_BY]
    if not name or not group_id or not varies_by or not is_absolute_url(source.get("url")):
        return None

    approach = choose_variant_approach(source)
    group_url = base_url(source["url"])
    parts = urlsplit(group_url)
    group_ref = f"{parts.scheme}://{parts.netloc}/#product-group-" + quote(group_id, safe="-_.!~*'()")  # same @id on every page
    ctx = {
        "approach": approach,
        "groupUrl": group_url,
        "groupId": group_id,
        "groupRef": group_ref,
        "variesBy": varies_by,
        "shared": source,
    }

    # Unique variant IDs (sku or gtin) and a distinct combination of variesBy values per variant.
    ids, combos, variants = set(), set(), []
    for item in source.get("variants") or []:
        variant = build_variant(item, ctx)
        if not variant:
            continue
        variant_id = variant["sku"] or variant["gtin"]
        combo = json.dumps([item.get(key) for key in varies_by])
        if variant_id in ids or combo in combos:
            continue
        ids.add(variant_id)
        combos.add(combo)
        variants.append(variant)
    if len(variants) < 2:
        return None  # one variant: use the Merchant Listing framework

    return compact({
        "@context": "https://schema.org",
        "@type": "ProductGroup",
        "@id": ctx["groupRef"],
        "name": name,
        "description": source.get("description"),
        "url": group_url if approach == "single-page" else None,  # single-page sites only, without variant selectors
        "brand": {"@type": "Brand", "name": source["brand"]} if source.get("brand") else None,
        "aggregateRating": build_rating(source.get("rating"), "AggregateRating"),  # representative of all variants
        "review": [r for r in (build_review(x) for x in (source.get("reviews") or [])) if r],
        "productGroupID": group_id,
        "variesBy": [S + key for key in varies_by],
        "hasVariant": variants,
    })
