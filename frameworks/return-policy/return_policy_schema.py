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


def choose_organization_type(org):
    return ORGANIZATION_TYPES.get(org.get("kind"), "Organization")


def to_country_code(value):
    code = str(value or "").upper()
    return code if re.fullmatch(r"[A-Z]{2}", code) else None


# ISO 3166-1 alpha-2 codes, at most 50; None when any code is invalid or the list is too long.
def to_country_list(values):
    codes = [to_country_code(v) for v in values or []]
    if None in codes or len(codes) > 50:
        return None
    return list(dict.fromkeys(codes))


def to_whole_number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def map_enum(keys, table):
    return [table[k] for k in keys or [] if k in table]


def build_money(amount):
    currency = str((amount or {}).get("currency") or "").upper()
    if not amount or not is_number(amount.get("value")) or amount["value"] < 0 or not re.fullmatch(r"[A-Z]{3}", currency):
        return None
    return {"@type": "MonetaryAmount", "value": amount["value"], "currency": currency}


# restockingFee: a Number is a percentage of the price paid, a MonetaryAmount is a fixed fee.
def build_restocking_fee(fee):
    if not fee:
        return None
    if is_number(fee.get("percent")):
        return fee["percent"] if 0 <= fee["percent"] <= 100 else None
    return build_money(fee)


# Fee type and label source; the shipping fee amount only (and always) with ReturnShippingFees.
def build_fees(group):
    if not group:
        return {}
    amount = build_money(group.get("shippingFee"))
    fees = RETURN_FEES.get(group.get("fees"))
    if fees == RETURN_FEES["shipping_fee"] and not amount:
        fees = None
    return {"fees": fees, "label": RETURN_LABEL.get(group.get("label")), "amount": amount if fees == RETURN_FEES["shipping_fee"] else None}


def build_seasonal_override(season):
    category = RETURN_CATEGORY.get(season.get("category"))
    if not category:
        return None  # returnPolicyCategory is required in an override
    days = to_whole_number(season.get("days"))
    if category == RETURN_CATEGORY["finite"] and days is None:
        return None
    start_date, end_date = to_iso_date(season.get("start")), to_iso_date(season.get("end"))
    if not start_date or not end_date or end_date < start_date:
        return None  # a dated window, end on or after start
    return {
        "@type": "MerchantReturnPolicySeasonalOverride",
        "startDate": start_date,
        "endDate": end_date,
        "returnPolicyCategory": category,
        "merchantReturnDays": days if category == RETURN_CATEGORY["finite"] else None,
    }


def build_return_policy(policy):
    link = policy.get("link") if is_absolute_url(policy.get("link")) else None
    countries = to_country_list(policy.get("countries"))
    category = RETURN_CATEGORY.get(policy.get("category"))
    if countries is None:
        return None  # invalid code or more than 50 countries

    # Required option: applicableCountry + returnPolicyCategory, or merchantReturnLink alone.
    if not (countries and category):
        return {"@type": "MerchantReturnPolicy", "merchantReturnLink": link} if link else None
    days = to_whole_number(policy.get("days"))
    if category == RETURN_CATEGORY["finite"] and days is None:
        return None  # finite window needs merchantReturnDays

    base = {"@type": "MerchantReturnPolicy", "applicableCountry": countries, "returnPolicyCategory": category, "merchantReturnLink": link}
    # No returns: fees, methods and days are not meaningful.
    if category == RETURN_CATEGORY["not_permitted"]:
        return base

    main = build_fees(policy)
    remorse = build_fees(policy.get("customerRemorse"))
    defect = build_fees(policy.get("itemDefect"))
    return {
        **base,
        "merchantReturnDays": days if category == RETURN_CATEGORY["finite"] else None,
        "returnPolicyCountry": to_country_list(policy.get("returnToCountries")),
        "returnMethod": map_enum(policy.get("methods"), RETURN_METHOD),
        "returnFees": main.get("fees"),
        "returnShippingFeesAmount": main.get("amount"),
        "returnLabelSource": main.get("label"),
        "refundType": map_enum(policy.get("refundTypes"), REFUND_TYPE),
        "itemCondition": map_enum(policy.get("conditions"), ITEM_CONDITION),
        "restockingFee": build_restocking_fee(policy.get("restockingFee")),
        "customerRemorseReturnFees": remorse.get("fees"),
        "customerRemorseReturnShippingFeesAmount": remorse.get("amount"),
        "customerRemorseReturnLabelSource": remorse.get("label"),
        "itemDefectReturnFees": defect.get("fees"),
        "itemDefectReturnShippingFeesAmount": defect.get("amount"),
        "itemDefectReturnLabelSource": defect.get("label"),
        "returnPolicySeasonalOverride": [build_seasonal_override(s) for s in policy.get("seasonalOverrides") or []],
    }


def build_return_policy_schema(source):
    # (a) Page gates: indexable, self-canonical, visible policy text, on the page that describes the return policy.
    if not passes_page_gates(source) or source.get("pageRole") != "return_policy":
        return None

    # (b) At least one policy must pass Google's required option (country + category, or merchantReturnLink).
    policies = [p for p in (build_return_policy(p) for p in source.get("policies") or []) if p]
    if not policies:
        return None

    # House rule: nest under the Organization, identified by name, home URL and the same @id as the home page markup.
    org = source.get("organization") or {}
    if not org.get("name") or not is_absolute_url(org.get("url")):
        return None

    # (c) and (d) applied inside build_return_policy; (e) strip empty values.
    return compact({
        "@context": "https://schema.org",
        "@type": choose_organization_type(org),
        "@id": f"{org['url']}#organization",
        "name": org["name"],
        "url": org["url"],
        "hasMerchantReturnPolicy": policies,
    })
