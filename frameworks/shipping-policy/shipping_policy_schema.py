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


S = "https://schema.org/"
ORGANIZATION_TYPES = {"online_store": "OnlineStore", "online_business": "OnlineBusiness", "corporation": "Corporation"}
DAYS = {"mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday", "fri": "Friday", "sat": "Saturday", "sun": "Sunday"}
REGION_COUNTRIES = ("US", "AU", "JP")  # addressRegion support
POSTAL_COUNTRIES = ("AU", "CA", "US")  # postalCode support
WEIGHT_UNITS = {"lb": "LBR", "kg": "KGM"}
ISO_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(Z|[+-]\d{2}:\d{2})$")


def choose_organization_type(org):
    return ORGANIZATION_TYPES.get(org.get("kind"), "Organization")


def to_country_code(value):
    code = str(value or "").upper()
    return code if re.fullmatch(r"[A-Z]{2}", code) else None


def to_currency_code(value):
    code = str(value or "").upper()
    return code if re.fullmatch(r"[A-Z]{3}", code) else None


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def to_whole_number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


# A min/max range; either end may be open, but min must not exceed max.
def to_range(rng):
    rng = rng or {}
    low = rng.get("min") if is_number(rng.get("min")) and rng["min"] >= 0 else None
    high = rng.get("max") if is_number(rng.get("max")) and rng["max"] >= 0 else None
    if low is None and high is None:
        return None
    if low is not None and high is not None and low > high:
        return None
    return {"minValue": low, "maxValue": high}


def build_region(region):
    country = to_country_code((region or {}).get("country"))
    if not country:
        return None  # addressCountry is required in a DefinedRegion
    return {
        "@type": "DefinedRegion",
        "addressCountry": country,
        # addressRegion: ISO 3166-2 code without the country prefix, US, AU and JP only.
        "addressRegion": [r for r in region.get("regions") or [] if re.fullmatch(r"[A-Z0-9]{2,3}", r)] if country in REGION_COUNTRIES else None,
        "postalCode": region.get("postalCodes") if country in POSTAL_COUNTRIES else None,  # AU, CA and US only
    }


# handlingTime and transitTime: whole days, minValue <= maxValue, unitCode DAY.
def build_service_period(period):
    if not period:
        return None
    low, high = (list(period.get("days") or []) + [None, None])[:2]
    if to_whole_number(low) is None or to_whole_number(high) is None or low > high:
        return None
    cutoff = period.get("cutoffTime") if ISO_TIME.match(period.get("cutoffTime") or "") else None
    return {
        "@type": "ServicePeriod",
        "duration": {"@type": "QuantitativeValue", "minValue": low, "maxValue": high, "unitCode": "DAY"},
        "businessDays": [S + DAYS[d] for d in period.get("businessDays") or [] if d in DAYS],
        "cutoffTime": cutoff,
    }


# shippingRate: MonetaryAmount with currency and exactly one of value (0 = free) or maxValue,
# or ShippingRateSettings with orderPercentage or weightPercentage between 0 and 1.
def build_shipping_rate(rate, currency):
    if not rate:
        return None
    has_value, has_max = is_number(rate.get("value")), is_number(rate.get("maxValue"))
    if has_value or has_max:
        if has_value == has_max or not currency:
            return None  # never both, currency required
        amount = rate["value"] if has_value else rate["maxValue"]
        if amount < 0:
            return None
        return {"@type": "MonetaryAmount", "currency": currency, ("value" if has_value else "maxValue"): amount}
    if is_number(rate.get("orderPercentage")):
        pct = ("orderPercentage", rate["orderPercentage"])
    elif is_number(rate.get("weightPercentage")):
        pct = ("weightPercentage", rate["weightPercentage"])
    else:
        return None
    if pct[1] < 0 or pct[1] > 1:
        return None
    return {"@type": "ShippingRateSettings", pct[0]: pct[1]}


# seasonalOverride needs at least one of validFrom or validThrough.
def build_seasonal_override(season):
    if not season:
        return None
    valid_from, valid_through = to_iso_date(season.get("from")), to_iso_date(season.get("through"))
    if not valid_from and not valid_through:
        return None
    if valid_from and valid_through and valid_through < valid_from:
        return None
    return {"@type": "OpeningHoursSpecification", "validFrom": valid_from, "validThrough": valid_through}


def build_shipping_conditions(rule):
    destination = [r for r in (build_region(d) for d in rule.get("destinations") or []) if r]
    if not destination:
        return None  # house rule: every condition names where it applies
    currency = to_currency_code(rule.get("currency"))
    order_value, weight, num_items = to_range(rule.get("orderValue")), to_range(rule.get("weight")), to_range(rule.get("numItems"))
    seasonal = build_seasonal_override(rule.get("seasonal")) if rule.get("seasonal") else None
    if rule.get("seasonal") and not seasonal:
        return None  # an invalid season must not widen the condition to all year
    weight_unit = WEIGHT_UNITS.get((rule.get("weight") or {}).get("unit"))

    conditions = {
        "@type": "ShippingConditions",
        "shippingDestination": destination,
        "shippingOrigin": build_region(rule["origin"]) if rule.get("origin") else None,
        "seasonalOverride": seasonal,
        "orderValue": {"@type": "MonetaryAmount", "currency": currency, **order_value} if order_value and currency else None,
        "weight": {"@type": "QuantitativeValue", **weight, "unitCode": weight_unit} if weight and weight_unit else None,
        "numItems": {"@type": "QuantitativeValue", **num_items} if num_items else None,
    }
    # No shipping to this destination: no rate and no transit time.
    if rule.get("doesNotShip") is True:
        return {**conditions, "doesNotShip": True}

    shipping_rate = build_shipping_rate(rule.get("rate"), currency)
    if not shipping_rate:
        return None  # house rule: a shippable condition must state its cost
    return {**conditions, "shippingRate": shipping_rate, "transitTime": build_service_period(rule.get("transit"))}


def build_shipping_service(service):
    # shippingConditions is required: keep the service only when at least one condition is valid.
    conditions = [c for c in (build_shipping_conditions(r) for r in service.get("conditions") or []) if c]
    if not conditions:
        return None
    tier = service.get("memberTierId")
    return {
        "@type": "ShippingService",
        "@id": service.get("id") if is_absolute_url(service.get("id")) else None,
        "name": service.get("name"),  # unique per service, for example "Standard shipping"
        "description": service.get("description"),
        "fulfillmentType": S + ("FulfillmentTypeCollectionPoint" if service.get("pickup") else "FulfillmentTypeDelivery"),
        "handlingTime": build_service_period(service.get("handling")),
        "validForMemberTier": {"@type": "MemberProgramTier", "@id": tier} if is_absolute_url(tier) else None,
        "shippingConditions": conditions,
    }


def build_shipping_policy_schema(source):
    # (a) Page gates: indexable, self-canonical, visible policy text, on the page that describes the shipping policy.
    if not passes_page_gates(source) or source.get("pageRole") != "shipping_policy":
        return None

    # (b) Each ShippingService requires shippingConditions; emit nothing when no service survives.
    services = [s for s in (build_shipping_service(s) for s in source.get("services") or []) if s]
    if not services:
        return None

    # House rule: nest under the Organization, identified by name, home URL and the same @id as the home page markup.
    org = source.get("organization") or {}
    if not org.get("name") or not is_absolute_url(org.get("url")):
        return None

    # (c) and (d) applied in the builders above; (e) strip empty values.
    return compact({
        "@context": "https://schema.org",
        "@type": choose_organization_type(org),
        "@id": f"{org['url']}#organization",
        "name": org["name"],
        "url": org["url"],
        "hasShippingService": services,
    })
