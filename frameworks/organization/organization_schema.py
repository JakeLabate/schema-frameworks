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
ORGANIZATION_TYPES = {
    "online_store": "OnlineStore",
    "online_business": "OnlineBusiness",
    "corporation": "Corporation",
    "ngo": "NGO",
    "school": "EducationalOrganization",
}  # physical local businesses: use the LocalBusiness framework instead
RETURN_CATEGORY = {
    "finite": S + "MerchantReturnFiniteReturnWindow",
    "not_permitted": S + "MerchantReturnNotPermitted",
    "unlimited": S + "MerchantReturnUnlimitedWindow",
}
RETURN_FEES = {"free": S + "FreeReturn", "customer_pays": S + "ReturnFeesCustomerResponsibility", "shipping_fee": S + "ReturnShippingFees"}
RETURN_METHOD = {"kiosk": S + "ReturnAtKiosk", "mail": S + "ReturnByMail", "in_store": S + "ReturnInStore"}
RETURN_LABEL = {"customer": S + "ReturnLabelCustomerResponsibility", "download": S + "ReturnLabelDownloadAndPrint", "in_box": S + "ReturnLabelInBox"}
REFUND_TYPE = {"exchange": S + "ExchangeRefund", "full": S + "FullRefund", "store_credit": S + "StoreCreditRefund"}
ITEM_CONDITION = {"new": S + "NewCondition", "refurbished": S + "RefurbishedCondition", "used": S + "UsedCondition", "damaged": S + "DamagedCondition"}
TIER_BENEFIT = {"points": S + "TierBenefitLoyaltyPoints", "member_price": S + "TierBenefitLoyaltyPrice"}
ICD_PREFIX = {"lei": "0199", "duns": "0060", "gln": "0088"}  # ISO 6523 International Code Designators
WEEKDAYS = [S + d for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]]


def choose_organization_type(source):
    return ORGANIZATION_TYPES.get(source.get("kind"), "Organization")


def to_country_code(value):
    code = str(value or "").upper()
    return code if re.fullmatch(r"[A-Z]{2}", code) else None


def to_whole_number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def map_enum(keys, table):
    return [table[k] for k in keys or [] if k in table]


def phone_or_none(value):
    return value if re.match(r"^\+\d", value or "") else None


def build_money(amount):
    currency = str((amount or {}).get("currency") or "").upper()
    if not amount or not is_number(amount.get("value")) or amount["value"] < 0 or not re.fullmatch(r"[A-Z]{3}", currency):
        return None
    return {"@type": "MonetaryAmount", "value": amount["value"], "currency": currency}


def build_service_period(days, cutoff_time=None):
    # Durations are non-negative whole days, minValue <= maxValue, unitCode DAY.
    low, high = (list(days or []) + [None, None])[:2]
    if to_whole_number(low) is None or to_whole_number(high) is None or low > high:
        return None
    return {
        "@type": "ServicePeriod",
        "duration": {"@type": "QuantitativeValue", "minValue": low, "maxValue": high, "unitCode": "DAY"},
        "businessDays": WEEKDAYS,
        "cutoffTime": cutoff_time,
    }


def build_return_policy(policy):
    # Either applicableCountry + returnPolicyCategory, or merchantReturnLink alone.
    countries = [c for c in (to_country_code(v) for v in policy.get("countries") or []) if c]
    category = RETURN_CATEGORY.get(policy.get("category"))
    link = policy.get("link") if is_absolute_url(policy.get("link")) else None
    if len(countries) > 50:
        return None  # at most 50 countries
    if not (countries and category) and not link:
        return None
    days = to_whole_number(policy.get("days"))
    if category == RETURN_CATEGORY["finite"] and days is None:
        return None  # finite window needs days
    if category == RETURN_CATEGORY["not_permitted"]:
        return {"@type": "MerchantReturnPolicy", "applicableCountry": countries, "returnPolicyCategory": category, "merchantReturnLink": link}
    # returnShippingFeesAmount only (and always) together with ReturnShippingFees.
    fee_amount = build_money(policy.get("shippingFee"))
    fees = RETURN_FEES.get(policy.get("fees"))
    if fees == RETURN_FEES["shipping_fee"] and not fee_amount:
        fees = None
    restocking = policy.get("restockingFeePercent")
    return {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": countries,
        "returnPolicyCountry": [c for c in (to_country_code(v) for v in policy.get("returnToCountries") or []) if c],
        "returnPolicyCategory": category,
        "merchantReturnDays": days if category == RETURN_CATEGORY["finite"] else None,
        "merchantReturnLink": link,
        "returnMethod": map_enum(policy.get("methods"), RETURN_METHOD),
        "returnFees": fees,
        "returnShippingFeesAmount": fee_amount if fees == RETURN_FEES["shipping_fee"] else None,
        "returnLabelSource": RETURN_LABEL.get(policy.get("label")),
        "refundType": map_enum(policy.get("refundTypes"), REFUND_TYPE),
        "itemCondition": map_enum(policy.get("conditions"), ITEM_CONDITION),
        "restockingFee": restocking if is_number(restocking) else None,
    }


def build_shipping_conditions(rule):
    destination = []
    for d in rule.get("destinations") or []:
        code = to_country_code(d.get("country"))
        if code:
            destination.append({
                "@type": "DefinedRegion",
                "addressCountry": code,
                # addressRegion is supported for US, AU and JP only
                "addressRegion": d.get("regions") if code in ("US", "AU", "JP") else None,
            })
    if not destination:
        return None
    base = {"@type": "ShippingConditions", "shippingDestination": destination}
    if rule.get("doesNotShip"):
        return {**base, "doesNotShip": True}  # no rate or transit time when not shipping
    currency = str(rule.get("currency") or "").upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        return None
    # shippingRate: currency plus value (0 = free) or maxValue, never both.
    rate, max_rate = rule.get("rate"), rule.get("maxRate")
    if is_number(rate) and rate >= 0:
        shipping_rate = {"@type": "MonetaryAmount", "value": rate, "currency": currency}
    elif is_number(max_rate) and max_rate >= 0:
        shipping_rate = {"@type": "MonetaryAmount", "maxValue": max_rate, "currency": currency}
    else:
        shipping_rate = None
    origin = to_country_code(rule.get("originCountry"))
    min_order = rule.get("minOrderValue")
    return {
        **base,
        "shippingOrigin": origin and {"@type": "DefinedRegion", "addressCountry": origin},
        "orderValue": {"@type": "MonetaryAmount", "minValue": min_order, "currency": currency} if is_number(min_order) else None,
        "shippingRate": shipping_rate,
        "transitTime": build_service_period(rule.get("transitDays")),
    }


def build_shipping_service(service):
    conditions = [c for c in (build_shipping_conditions(r) for r in service.get("conditions") or []) if c]
    if not conditions:
        return None  # shippingConditions is required
    return {
        "@type": "ShippingService",
        "name": service.get("name"),
        "description": service.get("description"),
        "fulfillmentType": S + ("FulfillmentTypeCollectionPoint" if service.get("pickup") else "FulfillmentTypeDelivery"),
        "handlingTime": build_service_period(service.get("handlingDays"), service.get("cutoffTime")),
        "shippingConditions": conditions,
    }


def build_tier_requirement(req):
    if not req:
        return None  # no requirement: anyone can join for free
    if req.get("type") == "card":
        return {"@type": "CreditCard", "name": req["name"]} if req.get("name") else None
    if req.get("type") == "spend":
        return build_money(req)
    return req.get("text") if isinstance(req.get("text"), str) else None


def build_member_program(program):
    if not program or not program.get("name") or not program.get("description"):
        return None  # name, description, hasTiers required
    tiers = []
    for tier in program.get("tiers") or []:
        benefits = map_enum(tier.get("benefits"), TIER_BENEFIT)
        if not tier.get("name") or not benefits:
            continue
        points = to_whole_number(tier.get("pointsPerUnit"))
        earns_points = TIER_BENEFIT["points"] in benefits
        if earns_points and points is None:
            continue  # TierBenefitLoyaltyPoints requires membershipPointsEarned
        tiers.append({
            "@type": "MemberProgramTier",
            "@id": tier.get("id") if is_absolute_url(tier.get("id")) else None,  # referenced by Offer validForMemberTier
            "name": tier["name"],
            "hasTierBenefit": benefits,
            "hasTierRequirement": build_tier_requirement(tier.get("requirement")),
            "membershipPointsEarned": {"@type": "QuantitativeValue", "value": points} if earns_points else None,
            "url": tier.get("url") if is_absolute_url(tier.get("url")) else None,
        })
    if not tiers:
        return None
    return {
        "@type": "MemberProgram",
        "name": program["name"],
        "description": program["description"],
        "url": program.get("url") if is_absolute_url(program.get("url")) else None,  # a single URL only
        "hasTiers": tiers,
    }


def build_organization_schema(source):
    # (a) Page gates: indexable, self-canonical, and the home or about page that describes the organization.
    if not passes_page_gates(source):
        return None
    if source.get("pageRole") not in ("home", "about"):
        return None

    # (b) Google lists no required properties. House rule: a name and an absolute home page URL.
    name = source.get("siteName") or source.get("name")  # same name as the WebSite site name markup
    home_url = source.get("homeUrl")
    if not name or not is_absolute_url(home_url):
        return None

    address = source.get("address") or {}
    country = to_country_code(address.get("country"))
    ids = source.get("identifiers") or {}
    icd = next((k for k in ("lei", "duns", "gln") if ids.get(k)), None)
    logo = source.get("logo") or {}
    employees = source.get("employees") or {}
    small_logo = any(is_number(logo.get(k)) and logo[k] < 112 for k in ("width", "height"))
    value, low, high = (to_whole_number(employees.get(k)) for k in ("value", "min", "max"))
    if value is not None:
        number_of_employees = {"@type": "QuantitativeValue", "value": value}
    elif low is not None and high is not None and low <= high:
        number_of_employees = {"@type": "QuantitativeValue", "minValue": low, "maxValue": high}
    else:
        number_of_employees = None

    # (c) Recommended properties, only when the source has them; (d) value rules inline.
    schema = {
        "@context": "https://schema.org",
        "@type": choose_organization_type(source),
        "@id": f"{home_url}#organization",
        "name": name,
        "alternateName": source.get("alternateNames"),  # same order as the WebSite alternateName
        "legalName": source.get("legalName"),
        "description": source.get("description"),
        "url": home_url,
        "logo": {"@type": "ImageObject", "url": logo["url"], "width": logo.get("width"), "height": logo.get("height")}
        if is_absolute_url(logo.get("url")) and not small_logo else None,  # at least 112x112px
        "sameAs": [u for u in source.get("profiles") or [] if is_absolute_url(u)],
        "telephone": phone_or_none(source.get("telephone")),
        "email": source.get("email"),
        "address": address.get("street") and {
            "@type": "PostalAddress",
            "streetAddress": address.get("street"),
            "addressLocality": address.get("locality"),
            "addressRegion": address.get("region"),
            "postalCode": address.get("postalCode"),
            "addressCountry": country,
        },
        "contactPoint": [
            {
                "@type": "ContactPoint",
                "contactType": cp.get("type"),
                "telephone": phone_or_none(cp.get("telephone")),
                "email": cp.get("email"),
            }
            for cp in source.get("contactPoints") or []
        ],
        "foundingDate": to_iso_date(source.get("foundingDate")),
        "numberOfEmployees": number_of_employees,
        "iso6523Code": f"{ICD_PREFIX[icd]}:{ids[icd]}" if icd else None,  # preferred over duns and leiCode
        "globalLocationNumber": ids.get("gln"),
        "naics": ids.get("naics"),
        "vatID": ids.get("vatId"),
        "taxID": ids.get("taxId") if ids.get("taxId") and ids.get("taxIdCountry") == country else None,  # must match the address country
        "hasMerchantReturnPolicy": [build_return_policy(p) for p in source.get("returnPolicies") or []],
        "hasShippingService": [build_shipping_service(s) for s in source.get("shippingServices") or []],
        "hasMemberProgram": build_member_program(source.get("loyaltyProgram")),
    }

    # (e) Strip empty values.
    return compact(schema)
