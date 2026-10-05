const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/;

function isAbsoluteUrl(value) {
  return typeof value === "string" && /^https?:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i.test(value);
}

// Returns the ISO 8601 string unchanged (timezone offset kept), or null if unparseable.
function toIsoDateTime(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const m = text.match(ISO_DATE_TIME);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) return null;
  if (+h > 23 || +mi > 59 || +s > 59) return null;
  return text;
}

function toIsoDate(value) {
  const iso = toIsoDateTime(value);
  return iso ? iso.slice(0, 10) : null;
}

// Drops null, undefined, "", [] and {} recursively.
function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const c = compact(v);
      if (c !== undefined) out[key] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null || value === undefined || value === "" ? undefined : value;
}

function passesPageGates(source) {
  if (source.indexable === false) return false;
  if (source.canonicalUrl && source.url && source.canonicalUrl !== source.url) return false;
  return source.contentVisible !== false;
}


const S = "https://schema.org/";
const ORGANIZATION_TYPES = { online_store: "OnlineStore", online_business: "OnlineBusiness", corporation: "Corporation" };
const TIER_BENEFIT = { points: S + "TierBenefitLoyaltyPoints", member_price: S + "TierBenefitLoyaltyPrice" };

function chooseOrganizationType(org) {
  return ORGANIZATION_TYPES[org.kind] || "Organization";
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toCurrencyCode(value) {
  const code = String(value || "").toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

// Stable fragment id per tier, reused by Offer and OfferShippingDetails validForMemberTier.
function tierId(orgUrl, key) {
  return /^[a-z0-9-]+$/.test(String(key || "")) ? `${orgUrl}#tier-${key}` : null;
}

// hasTierRequirement variants. undefined = no requirement (free to join), null = invalid.
function buildTierRequirement(req) {
  if (!req || req.type === "none") return undefined;
  if (req.type === "credit_card") {
    return req.name ? { "@type": "CreditCard", name: req.name } : null;
  }
  if (req.type === "min_spend") {
    const currency = toCurrencyCode(req.currency);
    return isPositiveNumber(req.value) && currency ? { "@type": "MonetaryAmount", value: req.value, currency } : null;
  }
  if (req.type === "paid_membership") {
    const priceCurrency = toCurrencyCode(req.currency);
    const ok = isPositiveNumber(req.price) && priceCurrency && isPositiveNumber(req.billingDuration) &&
      Number.isInteger(req.billingIncrement) && req.billingIncrement > 0 && /^[A-Z0-9]{3}$/.test(String(req.unitCode || ""));
    return ok ? {
      "@type": "UnitPriceSpecification",
      price: req.price,
      priceCurrency,
      billingDuration: req.billingDuration,
      billingIncrement: req.billingIncrement,
      unitCode: req.unitCode
    } : null;
  }
  if (req.type === "text") return typeof req.text === "string" && req.text.trim() ? req.text.trim() : null;
  return null;
}

function buildTier(tier, orgUrl) {
  const id = tierId(orgUrl, tier.key);
  const hasTierBenefit = [...new Set((tier.benefits || []).map((b) => TIER_BENEFIT[b]).filter(Boolean))];
  if (!id || !tier.name || !hasTierBenefit.length) return null; // name and hasTierBenefit are required

  // A points tier must state how many points are earned.
  const earnsPoints = hasTierBenefit.includes(TIER_BENEFIT.points);
  if (earnsPoints && !isPositiveNumber(tier.pointsPerCurrencyUnit)) return null;

  // An invalid requirement is not dropped silently: omitting it would claim the tier is free to join.
  const hasTierRequirement = buildTierRequirement(tier.requirement);
  if (hasTierRequirement === null) return null;

  return {
    "@type": "MemberProgramTier",
    "@id": id,
    name: tier.name,
    hasTierBenefit,
    hasTierRequirement,
    membershipPointsEarned: earnsPoints ? { "@type": "QuantitativeValue", value: tier.pointsPerCurrencyUnit } : null,
    url: isAbsoluteUrl(tier.signupUrl) ? tier.signupUrl : null
  };
}

function buildMemberProgram(program, orgUrl) {
  if (!program || !program.name || !program.description) return null; // required
  if (!/^[a-z0-9-]+$/.test(String(program.key || ""))) return null;
  const tierKeys = (program.tiers || []).map((t) => t.key);
  if (new Set(tierKeys).size !== tierKeys.length) return null; // duplicate tier @id
  const hasTiers = (program.tiers || []).map((t) => buildTier(t, orgUrl));
  if (!hasTiers.length || hasTiers.includes(null)) return null; // publish every visible tier or none
  return {
    "@type": "MemberProgram",
    "@id": `${orgUrl}#program-${program.key}`,
    name: program.name,
    description: program.description,
    url: isAbsoluteUrl(program.signupUrl) ? program.signupUrl : null, // a single URL
    hasTiers
  };
}

function buildLoyaltyProgramSchema(source) {
  // (a) Page gates, and only on the page that carries the Organization details and policies.
  if (!passesPageGates(source) || source.pageRole !== "organization_details") return null;

  const org = source.organization || {};
  if (!org.name || !isAbsoluteUrl(org.url)) return null;

  // (b) Required: name, description, at least one valid tier with name and hasTierBenefit.
  const memberProgram = (source.memberPrograms || []).map((p) => buildMemberProgram(p, org.url));
  if (!memberProgram.length || memberProgram.includes(null)) return null;

  // (c) and (d) applied in buildMemberProgram and buildTier; (e) strip empty values.
  return compact({
    "@context": "https://schema.org",
    "@type": chooseOrganizationType(org),
    "@id": `${org.url}#organization`,
    name: org.name,
    url: org.url,
    hasMemberProgram: memberProgram.length === 1 ? memberProgram[0] : memberProgram
  });
}

// Node: const { buildLoyaltyProgramSchema } = require('./loyalty-program-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildLoyaltyProgramSchema };
