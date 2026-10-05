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
const DAYS = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const REGION_COUNTRIES = ["US", "AU", "JP"]; // addressRegion support
const POSTAL_COUNTRIES = ["AU", "CA", "US"]; // postalCode support
const WEIGHT_UNITS = { lb: "LBR", kg: "KGM" };
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(Z|[+-]\d{2}:\d{2})$/;

function chooseOrganizationType(org) {
  return ORGANIZATION_TYPES[org.kind] || "Organization";
}

function toCountryCode(value) {
  const code = String(value || "").toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function toCurrencyCode(value) {
  const code = String(value || "").toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toWholeNumber(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

// A min/max range; either end may be open, but min must not exceed max.
function toRange(range = {}) {
  const min = isNumber(range.min) && range.min >= 0 ? range.min : null;
  const max = isNumber(range.max) && range.max >= 0 ? range.max : null;
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) return null;
  return { minValue: min, maxValue: max };
}

function buildRegion(region) {
  const country = toCountryCode(region && region.country);
  if (!country) return null; // addressCountry is required in a DefinedRegion
  return {
    "@type": "DefinedRegion",
    addressCountry: country,
    // addressRegion: ISO 3166-2 code without the country prefix, US, AU and JP only.
    addressRegion: REGION_COUNTRIES.includes(country) ? (region.regions || []).filter((r) => /^[A-Z0-9]{2,3}$/.test(r)) : null,
    postalCode: POSTAL_COUNTRIES.includes(country) ? region.postalCodes : null // AU, CA and US only
  };
}

// handlingTime and transitTime: whole days, minValue <= maxValue, unitCode DAY.
function buildServicePeriod(period) {
  if (!period) return null;
  const [min, max] = period.days || [];
  if (toWholeNumber(min) === null || toWholeNumber(max) === null || min > max) return null;
  const cutoffTime = ISO_TIME.test(period.cutoffTime || "") ? period.cutoffTime : null;
  return {
    "@type": "ServicePeriod",
    duration: { "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" },
    businessDays: (period.businessDays || []).map((d) => DAYS[d] && S + DAYS[d]).filter(Boolean),
    cutoffTime
  };
}

// shippingRate: MonetaryAmount with currency and exactly one of value (0 = free) or maxValue,
// or ShippingRateSettings with orderPercentage or weightPercentage between 0 and 1.
function buildShippingRate(rate, currency) {
  if (!rate) return null;
  const hasValue = isNumber(rate.value);
  const hasMax = isNumber(rate.maxValue);
  if (hasValue || hasMax) {
    if (hasValue === hasMax || !currency) return null; // never both, currency required
    const amount = hasValue ? rate.value : rate.maxValue;
    if (amount < 0) return null;
    return { "@type": "MonetaryAmount", currency, [hasValue ? "value" : "maxValue"]: amount };
  }
  const pct = isNumber(rate.orderPercentage) ? ["orderPercentage", rate.orderPercentage]
    : isNumber(rate.weightPercentage) ? ["weightPercentage", rate.weightPercentage] : null;
  if (!pct || pct[1] < 0 || pct[1] > 1) return null;
  return { "@type": "ShippingRateSettings", [pct[0]]: pct[1] };
}

// seasonalOverride needs at least one of validFrom or validThrough.
function buildSeasonalOverride(season) {
  if (!season) return null;
  const validFrom = toIsoDate(season.from);
  const validThrough = toIsoDate(season.through);
  if (!validFrom && !validThrough) return null;
  if (validFrom && validThrough && validThrough < validFrom) return null;
  return { "@type": "OpeningHoursSpecification", validFrom, validThrough };
}

function buildShippingConditions(rule) {
  const shippingDestination = (rule.destinations || []).map(buildRegion).filter(Boolean);
  if (!shippingDestination.length) return null; // house rule: every condition names where it applies
  const currency = toCurrencyCode(rule.currency);
  const orderValue = toRange(rule.orderValue);
  const weight = toRange(rule.weight);
  const numItems = toRange(rule.numItems);
  const seasonal = rule.seasonal ? buildSeasonalOverride(rule.seasonal) : null;
  if (rule.seasonal && !seasonal) return null; // an invalid season must not widen the condition to all year

  const conditions = {
    "@type": "ShippingConditions",
    shippingDestination,
    shippingOrigin: rule.origin ? buildRegion(rule.origin) : null,
    seasonalOverride: seasonal,
    orderValue: orderValue && currency ? { "@type": "MonetaryAmount", currency, ...orderValue } : null,
    weight: weight && WEIGHT_UNITS[rule.weight.unit] ? { "@type": "QuantitativeValue", ...weight, unitCode: WEIGHT_UNITS[rule.weight.unit] } : null,
    numItems: numItems ? { "@type": "QuantitativeValue", ...numItems } : null
  };
  // No shipping to this destination: no rate and no transit time.
  if (rule.doesNotShip === true) return { ...conditions, doesNotShip: true };

  const shippingRate = buildShippingRate(rule.rate, currency);
  if (!shippingRate) return null; // house rule: a shippable condition must state its cost
  return { ...conditions, shippingRate, transitTime: buildServicePeriod(rule.transit) };
}

function buildShippingService(service) {
  // shippingConditions is required: keep the service only when at least one condition is valid.
  const shippingConditions = (service.conditions || []).map(buildShippingConditions).filter(Boolean);
  if (!shippingConditions.length) return null;
  return {
    "@type": "ShippingService",
    "@id": isAbsoluteUrl(service.id) ? service.id : null,
    name: service.name, // unique per service, for example "Standard shipping"
    description: service.description,
    fulfillmentType: S + (service.pickup ? "FulfillmentTypeCollectionPoint" : "FulfillmentTypeDelivery"),
    handlingTime: buildServicePeriod(service.handling),
    validForMemberTier: isAbsoluteUrl(service.memberTierId) ? { "@type": "MemberProgramTier", "@id": service.memberTierId } : null,
    shippingConditions
  };
}

function buildShippingPolicySchema(source) {
  // (a) Page gates: indexable, self-canonical, visible policy text, on the page that describes the shipping policy.
  if (!passesPageGates(source) || source.pageRole !== "shipping_policy") return null;

  // (b) Each ShippingService requires shippingConditions; emit nothing when no service survives.
  const hasShippingService = (source.services || []).map(buildShippingService).filter(Boolean);
  if (!hasShippingService.length) return null;

  // House rule: nest under the Organization, identified by name, home URL and the same @id as the home page markup.
  const org = source.organization || {};
  if (!org.name || !isAbsoluteUrl(org.url)) return null;

  // (c) and (d) applied in the builders above; (e) strip empty values.
  return compact({
    "@context": "https://schema.org",
    "@type": chooseOrganizationType(org),
    "@id": `${org.url}#organization`,
    name: org.name,
    url: org.url,
    hasShippingService
  });
}

// Node: const { buildShippingPolicySchema } = require('./shipping-policy-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildShippingPolicySchema };
