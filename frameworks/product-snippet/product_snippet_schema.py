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
from datetime import datetime, timezone

AVAILABILITY = ["BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "SoldOut"]
CONDITIONS = ["NewCondition", "RefurbishedCondition", "UsedCondition"]
VARIES_BY = ["color", "size", "suggestedAge", "suggestedGender", "material", "pattern"]
RETURN_CATEGORY = {"finite": "MerchantReturnFiniteReturnWindow", "none": "MerchantReturnNotPermitted", "unlimited": "MerchantReturnUnlimitedWindow"}
RETURN_FEES = {"free": "FreeReturn", "customer": "ReturnFeesCustomerResponsibility", "shipping": "ReturnShippingFees"}
RETURN_METHOD = {"kiosk": "ReturnAtKiosk", "mail": "ReturnByMail", "store": "ReturnInStore"}


def schema_enum(value, allowed):
    return f"https://schema.org/{value}" if value in allowed else None


def is_gtin(value):
    return re.fullmatch(r"\d{8}|\d{12,14}", str(value or "")) is not None


def is_sku(value):
    return isinstance(value, str) and re.fullmatch(r"\S+", value) is not None


# Merchant listing: the shopper can buy on this page. Product snippet: editorial or review page.
# More than one variant of the same product makes the top-level entity a ProductGroup.
def choose_product_type(source):
    return {
        "entity": "ProductGroup" if len(source.get("variants") or []) > 1 else "Product",
        "listing": "merchant" if source.get("purchasable") else "snippet",
    }


def days_range(pair):
    lo, hi = (list(pair or []) + [None, None])[:2]
    if isinstance(lo, int) and isinstance(hi, int) and 0 <= lo <= hi:
        return {"@type": "QuantitativeValue", "minValue": lo, "maxValue": hi, "unitCode": "DAY"}
    return None


def build_shipping(s):
    s = s or {}
    rate = to_number(s.get("rate"))
    if rate is None or rate < 0 or not is_currency_code(s.get("currency")) or not re.fullmatch(r"[A-Z]{2}", s.get("country") or ""):
        return None
    return {
        "@type": "OfferShippingDetails",
        "shippingRate": {"@type": "MonetaryAmount", "value": rate, "currency": s["currency"]},
        "shippingDestination": {"@type": "DefinedRegion", "addressCountry": s["country"]},
        "deliveryTime": {"@type": "ShippingDeliveryTime", "handlingTime": days_range(s.get("handlingDays")), "transitTime": days_range(s.get("transitDays"))},
    }


# Finite windows need merchantReturnDays; ReturnShippingFees needs returnShippingFeesAmount.
def build_return_policy(r):
    r = r or {}
    category = RETURN_CATEGORY.get(r.get("category"))
    days = to_number(r.get("days"))
    fee = to_number(r.get("feeAmount"))
    if not category or not re.fullmatch(r"[A-Z]{2}", r.get("country") or ""):
        return None
    if category == "MerchantReturnFiniteReturnWindow" and not (isinstance(days, int) and days > 0):
        return None
    if r.get("fees") == "shipping" and not (fee is not None and fee >= 0 and is_currency_code(r.get("currency"))):
        return None
    return {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": r["country"],
        "returnPolicyCategory": f"https://schema.org/{category}",
        "merchantReturnDays": days if category == "MerchantReturnFiniteReturnWindow" else None,
        "returnMethod": f"https://schema.org/{RETURN_METHOD[r['method']]}" if r.get("method") in RETURN_METHOD else None,
        "returnFees": f"https://schema.org/{RETURN_FEES[r['fees']]}" if r.get("fees") in RETURN_FEES else None,
        "returnShippingFeesAmount": {"@type": "MonetaryAmount", "value": fee, "currency": r["currency"]} if r.get("fees") == "shipping" else None,
    }


# Merchant listings need an Offer with price > 0 and priceCurrency; snippets accept price 0 or an AggregateOffer.
def build_offer(offer, listing, shared, now):
    if not offer:
        return None
    if "lowPrice" in offer:
        low = to_number(offer.get("lowPrice"))
        high = to_number(offer.get("highPrice"))
        if listing == "merchant" or low is None or low < 0 or not is_currency_code(offer.get("currency")):
            return None
        return {"@type": "AggregateOffer", "lowPrice": low, "highPrice": high if high is not None and high >= low else None,
                "offerCount": to_number(offer.get("offerCount")), "priceCurrency": offer["currency"]}
    price = to_number(offer.get("price"))
    currency = offer.get("currency") if is_currency_code(offer.get("currency")) else None
    if price is None or price < 0:
        return None
    if listing == "merchant" and (price <= 0 or not currency):
        return None
    valid_until = to_iso_date(offer.get("priceValidUntil"))
    still_valid = valid_until and datetime.fromisoformat(f"{valid_until}T23:59:59+00:00") >= now
    return {
        "@type": "Offer",
        "url": offer.get("url") if is_absolute_url(offer.get("url")) else None,
        "price": price,
        "priceCurrency": currency,
        "priceValidUntil": valid_until if still_valid else None,
        "availability": schema_enum(offer.get("availability"), AVAILABILITY),
        "itemCondition": schema_enum(offer.get("condition"), CONDITIONS),
        "shippingDetails": build_shipping(shared.get("shipping")) if listing == "merchant" else None,
        "hasMerchantReturnPolicy": build_return_policy(shared.get("returns")) if listing == "merchant" else None,
    }


# Pros and cons: editorial reviews only, and at least two statements across both lists.
def build_editorial_review(data, listing):
    review = build_review(data)
    if not review:
        return None

    def notes(items):
        return [{"@type": "ListItem", "position": i + 1, "name": n} for i, n in enumerate([x for x in items or [] if x])]

    pros, cons = notes(data.get("pros")), notes(data.get("cons"))
    if listing != "snippet" or len(pros) + len(cons) < 2:
        return review
    return {
        **review,
        "positiveNotes": {"@type": "ItemList", "itemListElement": pros} if pros else None,
        "negativeNotes": {"@type": "ItemList", "itemListElement": cons} if cons else None,
    }


def build_variant(variant, listing, shared, group_id, varies_by, now):
    images = [u for u in variant.get("images") or [] if is_absolute_url(u)]
    offers = build_offer(variant.get("offer"), listing, shared, now)
    if not variant.get("name") or (not is_sku(variant.get("sku")) and not is_gtin(variant.get("gtin"))):
        return None
    if listing == "merchant" and (not images or (offers or {}).get("@type") != "Offer"):
        return None
    return {
        "@type": "Product",
        "name": variant["name"],
        "sku": variant["sku"] if is_sku(variant.get("sku")) else None,
        "gtin": str(variant["gtin"]) if is_gtin(variant.get("gtin")) else None,
        "inProductGroupWithID": group_id,
        **{key: variant.get(key) for key in varies_by},
        "url": variant.get("url") if is_absolute_url(variant.get("url")) else None,
        "image": images,
        "offers": offers,
    }


def build_product_schema(source, now=None):
    now = now or datetime.now(timezone.utc)
    if not passes_page_gates(source):
        return None
    kind = choose_product_type(source)
    entity, listing = kind["entity"], kind["listing"]

    name = str(source.get("name") or "").strip()
    images = [u for u in source.get("images") or [] if is_absolute_url(u)]
    if not name:
        return None

    aggregate_rating = build_rating(source.get("rating"), "AggregateRating")
    reviews = [r for r in (build_editorial_review(x, listing) for x in source.get("reviews") or []) if r]
    shared = {
        "@context": "https://schema.org",
        "@type": entity,
        "name": name,
        "image": images,
        "description": source.get("description"),
        "brand": {"@type": "Brand", "name": source["brand"]} if source.get("brand") else None,
        "aggregateRating": aggregate_rating,
        "review": reviews,
    }

    if entity == "ProductGroup":
        group_id = source.get("groupId") if is_sku(source.get("groupId")) else None
        varies_by = [v for v in source.get("variesBy") or [] if v in VARIES_BY]
        ids, variants = set(), []
        for v in (build_variant(x, listing, source, group_id, varies_by, now) for x in source["variants"]):
            vid = v and (v["sku"] or v["gtin"])
            if not v or vid in ids:
                continue  # each variant needs a unique ID
            ids.add(vid)
            variants.append(v)
        if not group_id or not variants:
            return None
        return compact({
            **shared,
            "productGroupID": group_id,
            "url": None if source.get("variantPages") else source.get("url"),  # single-page sites only
            "variesBy": [f"https://schema.org/{v}" for v in varies_by],
            "hasVariant": variants,
        })

    # Merchant listing requires image and a valid Offer; product snippet requires review, rating or offers.
    offers = build_offer(source.get("offer"), listing, source, now)
    if listing == "merchant" and (not images or (offers or {}).get("@type") != "Offer"):
        return None
    if listing == "snippet" and not offers and not aggregate_rating and not reviews:
        return None

    return compact({
        **shared,
        "sku": source["sku"] if is_sku(source.get("sku")) else None,
        "mpn": source.get("mpn"),
        "gtin": str(source["gtin"]) if is_gtin(source.get("gtin")) else None,
        "offers": offers,
    })
