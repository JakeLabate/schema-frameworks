import math
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
TIER_BENEFIT = {"points": S + "TierBenefitLoyaltyPoints", "member_price": S + "TierBenefitLoyaltyPrice"}
KEY = re.compile(r"^[a-z0-9-]+$")
MISSING = object()  # no requirement: anyone can join for free


def choose_organization_type(org):
    return ORGANIZATION_TYPES.get(org.get("kind"), "Organization")


def is_positive_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def to_currency_code(value):
    code = str(value or "").upper()
    return code if re.fullmatch(r"[A-Z]{3}", code) else None


# Stable fragment id per tier, reused by Offer and OfferShippingDetails validForMemberTier.
def tier_id(org_url, key):
    return f"{org_url}#tier-{key}" if KEY.match(str(key or "")) else None


# hasTierRequirement variants. MISSING = no requirement (free to join), None = invalid.
def build_tier_requirement(req):
    if not req or req.get("type") == "none":
        return MISSING
    kind = req.get("type")
    if kind == "credit_card":
        return {"@type": "CreditCard", "name": req["name"]} if req.get("name") else None
    if kind == "min_spend":
        currency = to_currency_code(req.get("currency"))
        if is_positive_number(req.get("value")) and currency:
            return {"@type": "MonetaryAmount", "value": req["value"], "currency": currency}
        return None
    if kind == "paid_membership":
        price_currency = to_currency_code(req.get("currency"))
        increment = req.get("billingIncrement")
        ok = (is_positive_number(req.get("price")) and price_currency and is_positive_number(req.get("billingDuration"))
              and isinstance(increment, int) and not isinstance(increment, bool) and increment > 0
              and re.fullmatch(r"[A-Z0-9]{3}", str(req.get("unitCode") or "")))
        if not ok:
            return None
        return {
            "@type": "UnitPriceSpecification",
            "price": req["price"],
            "priceCurrency": price_currency,
            "billingDuration": req["billingDuration"],
            "billingIncrement": increment,
            "unitCode": req["unitCode"],
        }
    if kind == "text":
        text = req.get("text")
        return text.strip() if isinstance(text, str) and text.strip() else None
    return None


def build_tier(tier, org_url):
    tid = tier_id(org_url, tier.get("key"))
    has_tier_benefit = list(dict.fromkeys(TIER_BENEFIT[b] for b in tier.get("benefits") or [] if b in TIER_BENEFIT))
    if not tid or not tier.get("name") or not has_tier_benefit:
        return None  # name and hasTierBenefit are required

    # A points tier must state how many points are earned.
    earns_points = TIER_BENEFIT["points"] in has_tier_benefit
    if earns_points and not is_positive_number(tier.get("pointsPerCurrencyUnit")):
        return None

    # An invalid requirement is not dropped silently: omitting it would claim the tier is free to join.
    requirement = build_tier_requirement(tier.get("requirement"))
    if requirement is None:
        return None

    return {
        "@type": "MemberProgramTier",
        "@id": tid,
        "name": tier["name"],
        "hasTierBenefit": has_tier_benefit,
        "hasTierRequirement": None if requirement is MISSING else requirement,
        "membershipPointsEarned": {"@type": "QuantitativeValue", "value": tier["pointsPerCurrencyUnit"]} if earns_points else None,
        "url": tier.get("signupUrl") if is_absolute_url(tier.get("signupUrl")) else None,
    }


def build_member_program(program, org_url):
    if not program or not program.get("name") or not program.get("description"):
        return None  # required
    if not KEY.match(str(program.get("key") or "")):
        return None
    tiers = program.get("tiers") or []
    keys = [t.get("key") for t in tiers]
    if len(set(keys)) != len(keys):
        return None  # duplicate tier @id
    has_tiers = [build_tier(t, org_url) for t in tiers]
    if not has_tiers or None in has_tiers:
        return None  # publish every visible tier or none
    return {
        "@type": "MemberProgram",
        "@id": f"{org_url}#program-{program['key']}",
        "name": program["name"],
        "description": program["description"],
        "url": program.get("signupUrl") if is_absolute_url(program.get("signupUrl")) else None,  # a single URL
        "hasTiers": has_tiers,
    }


def build_loyalty_program_schema(source):
    # (a) Page gates, and only on the page that carries the Organization details and policies.
    if not passes_page_gates(source) or source.get("pageRole") != "organization_details":
        return None

    org = source.get("organization") or {}
    if not org.get("name") or not is_absolute_url(org.get("url")):
        return None

    # (b) Required: name, description, at least one valid tier with name and hasTierBenefit.
    programs = [build_member_program(p, org["url"]) for p in source.get("memberPrograms") or []]
    if not programs or None in programs:
        return None

    # (c) and (d) applied in build_member_program and build_tier; (e) strip empty values.
    return compact({
        "@context": "https://schema.org",
        "@type": choose_organization_type(org),
        "@id": f"{org['url']}#organization",
        "name": org["name"],
        "url": org["url"],
        "hasMemberProgram": programs[0] if len(programs) == 1 else programs,
    })
