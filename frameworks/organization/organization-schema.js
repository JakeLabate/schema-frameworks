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
const ORGANIZATION_TYPES = {
  online_store: "OnlineStore",
  online_business: "OnlineBusiness",
  corporation: "Corporation",
  ngo: "NGO",
  school: "EducationalOrganization"
}; // physical local businesses: use the LocalBusiness framework instead
const RETURN_CATEGORY = {
  finite: S + "MerchantReturnFiniteReturnWindow",
  not_permitted: S + "MerchantReturnNotPermitted",
  unlimited: S + "MerchantReturnUnlimitedWindow"
};
const RETURN_FEES = { free: S + "FreeReturn", customer_pays: S + "ReturnFeesCustomerResponsibility", shipping_fee: S + "ReturnShippingFees" };
const RETURN_METHOD = { kiosk: S + "ReturnAtKiosk", mail: S + "ReturnByMail", in_store: S + "ReturnInStore" };
const RETURN_LABEL = { customer: S + "ReturnLabelCustomerResponsibility", download: S + "ReturnLabelDownloadAndPrint", in_box: S + "ReturnLabelInBox" };
const REFUND_TYPE = { exchange: S + "ExchangeRefund", full: S + "FullRefund", store_credit: S + "StoreCreditRefund" };
const ITEM_CONDITION = { new: S + "NewCondition", refurbished: S + "RefurbishedCondition", used: S + "UsedCondition", damaged: S + "DamagedCondition" };
const TIER_BENEFIT = { points: S + "TierBenefitLoyaltyPoints", member_price: S + "TierBenefitLoyaltyPrice" };
const ICD_PREFIX = { lei: "0199", duns: "0060", gln: "0088" }; // ISO 6523 International Code Designators
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => S + d);

function chooseOrganizationType(source) {
  return ORGANIZATION_TYPES[source.kind] || "Organization";
}

function toCountryCode(value) {
  const code = String(value || "").toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function toWholeNumber(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function mapEnum(keys, table) {
  return (keys || []).map((k) => table[k]).filter(Boolean);
}

function buildMoney(amount) {
  const currency = String((amount && amount.currency) || "").toUpperCase();
  if (!amount || typeof amount.value !== "number" || amount.value < 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  return { "@type": "MonetaryAmount", value: amount.value, currency };
}

function buildServicePeriod([min, max] = [], cutoffTime = null) {
  // Durations are non-negative whole days, minValue <= maxValue, unitCode DAY.
  if (toWholeNumber(min) === null || toWholeNumber(max) === null || min > max) return null;
  return {
    "@type": "ServicePeriod",
    duration: { "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" },
    businessDays: WEEKDAYS,
    cutoffTime
  };
}

function buildReturnPolicy(policy) {
  // Either applicableCountry + returnPolicyCategory, or merchantReturnLink alone.
  const countries = (policy.countries || []).map(toCountryCode).filter(Boolean);
  const category = RETURN_CATEGORY[policy.category];
  const link = isAbsoluteUrl(policy.link) ? policy.link : null;
  if (countries.length > 50) return null; // at most 50 countries
  if (!(countries.length && category) && !link) return null;
  const days = toWholeNumber(policy.days);
  if (category === RETURN_CATEGORY.finite && days === null) return null; // finite window needs days
  if (category === RETURN_CATEGORY.not_permitted) {
    return { "@type": "MerchantReturnPolicy", applicableCountry: countries, returnPolicyCategory: category, merchantReturnLink: link };
  }
  // returnShippingFeesAmount only (and always) together with ReturnShippingFees.
  const feeAmount = buildMoney(policy.shippingFee);
  let fees = RETURN_FEES[policy.fees] || null;
  if (fees === RETURN_FEES.shipping_fee && !feeAmount) fees = null;
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: countries,
    returnPolicyCountry: (policy.returnToCountries || []).map(toCountryCode).filter(Boolean),
    returnPolicyCategory: category,
    merchantReturnDays: category === RETURN_CATEGORY.finite ? days : null,
    merchantReturnLink: link,
    returnMethod: mapEnum(policy.methods, RETURN_METHOD),
    returnFees: fees,
    returnShippingFeesAmount: fees === RETURN_FEES.shipping_fee ? feeAmount : null,
    returnLabelSource: RETURN_LABEL[policy.label] || null,
    refundType: mapEnum(policy.refundTypes, REFUND_TYPE),
    itemCondition: mapEnum(policy.conditions, ITEM_CONDITION),
    restockingFee: typeof policy.restockingFeePercent === "number" ? policy.restockingFeePercent : null
  };
}

function buildShippingConditions(rule) {
  const destination = (rule.destinations || []).map((d) => toCountryCode(d.country) && {
    "@type": "DefinedRegion",
    addressCountry: toCountryCode(d.country),
    // addressRegion is supported for US, AU and JP only
    addressRegion: ["US", "AU", "JP"].includes(toCountryCode(d.country)) ? d.regions : null
  }).filter(Boolean);
  if (!destination.length) return null;
  const base = { "@type": "ShippingConditions", shippingDestination: destination };
  if (rule.doesNotShip) return { ...base, doesNotShip: true }; // no rate or transit time when not shipping
  const currency = String(rule.currency || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  // shippingRate: currency plus value (0 = free) or maxValue, never both.
  const rate = typeof rule.rate === "number" && rule.rate >= 0
    ? { "@type": "MonetaryAmount", value: rule.rate, currency }
    : typeof rule.maxRate === "number" && rule.maxRate >= 0
      ? { "@type": "MonetaryAmount", maxValue: rule.maxRate, currency }
      : null;
  return {
    ...base,
    shippingOrigin: toCountryCode(rule.originCountry) && { "@type": "DefinedRegion", addressCountry: toCountryCode(rule.originCountry) },
    orderValue: typeof rule.minOrderValue === "number" ? { "@type": "MonetaryAmount", minValue: rule.minOrderValue, currency } : null,
    shippingRate: rate,
    transitTime: buildServicePeriod(rule.transitDays)
  };
}

function buildShippingService(service) {
  const shippingConditions = (service.conditions || []).map(buildShippingConditions).filter(Boolean);
  if (!shippingConditions.length) return null; // shippingConditions is required
  return {
    "@type": "ShippingService",
    name: service.name,
    description: service.description,
    fulfillmentType: S + (service.pickup ? "FulfillmentTypeCollectionPoint" : "FulfillmentTypeDelivery"),
    handlingTime: buildServicePeriod(service.handlingDays, service.cutoffTime),
    shippingConditions
  };
}

function buildTierRequirement(req) {
  if (!req) return null; // no requirement: anyone can join for free
  if (req.type === "card") return req.name ? { "@type": "CreditCard", name: req.name } : null;
  if (req.type === "spend") return buildMoney(req);
  return typeof req.text === "string" ? req.text : null;
}

function buildMemberProgram(program) {
  if (!program || !program.name || !program.description) return null; // name, description, hasTiers required
  const hasTiers = (program.tiers || []).map((tier) => {
    const benefits = mapEnum(tier.benefits, TIER_BENEFIT);
    if (!tier.name || !benefits.length) return null;
    const points = toWholeNumber(tier.pointsPerUnit);
    // TierBenefitLoyaltyPoints requires membershipPointsEarned.
    if (benefits.includes(TIER_BENEFIT.points) && points === null) return null;
    return {
      "@type": "MemberProgramTier",
      "@id": isAbsoluteUrl(tier.id) ? tier.id : null, // referenced by Offer validForMemberTier
      name: tier.name,
      hasTierBenefit: benefits,
      hasTierRequirement: buildTierRequirement(tier.requirement),
      membershipPointsEarned: benefits.includes(TIER_BENEFIT.points) ? { "@type": "QuantitativeValue", value: points } : null,
      url: isAbsoluteUrl(tier.url) ? tier.url : null
    };
  }).filter(Boolean);
  if (!hasTiers.length) return null;
  return {
    "@type": "MemberProgram",
    name: program.name,
    description: program.description,
    url: isAbsoluteUrl(program.url) ? program.url : null, // a single URL only
    hasTiers
  };
}

function buildOrganizationSchema(source) {
  // (a) Page gates: indexable, self-canonical, and the home or about page that describes the organization.
  if (!passesPageGates(source)) return null;
  if (!["home", "about"].includes(source.pageRole)) return null;

  // (b) Google lists no required properties. House rule: a name and an absolute home page URL.
  const name = source.siteName || source.name; // same name as the WebSite site name markup
  if (!name || !isAbsoluteUrl(source.homeUrl)) return null;

  const address = source.address || {};
  const country = toCountryCode(address.country);
  const ids = source.identifiers || {};
  const icd = ["lei", "duns", "gln"].find((k) => ids[k]);
  const logo = source.logo || {};
  const employees = source.employees || {};

  // (c) Recommended properties, only when the source has them; (d) value rules inline.
  const schema = {
    "@context": "https://schema.org",
    "@type": chooseOrganizationType(source),
    "@id": `${source.homeUrl}#organization`,
    name,
    alternateName: source.alternateNames, // same order as the WebSite alternateName
    legalName: source.legalName,
    description: source.description,
    url: source.homeUrl,
    logo: isAbsoluteUrl(logo.url) && !(logo.width < 112 || logo.height < 112) // at least 112x112px
      ? { "@type": "ImageObject", url: logo.url, width: logo.width, height: logo.height }
      : null,
    sameAs: (source.profiles || []).filter(isAbsoluteUrl),
    telephone: /^\+\d/.test(source.telephone || "") ? source.telephone : null,
    email: source.email,
    address: address.street && {
      "@type": "PostalAddress",
      streetAddress: address.street,
      addressLocality: address.locality,
      addressRegion: address.region,
      postalCode: address.postalCode,
      addressCountry: country
    },
    contactPoint: (source.contactPoints || []).map((cp) => ({
      "@type": "ContactPoint",
      contactType: cp.type,
      telephone: /^\+\d/.test(cp.telephone || "") ? cp.telephone : null,
      email: cp.email
    })),
    foundingDate: toIsoDate(source.foundingDate),
    numberOfEmployees: toWholeNumber(employees.value) !== null
      ? { "@type": "QuantitativeValue", value: employees.value }
      : toWholeNumber(employees.min) !== null && toWholeNumber(employees.max) !== null && employees.min <= employees.max
        ? { "@type": "QuantitativeValue", minValue: employees.min, maxValue: employees.max }
        : null,
    iso6523Code: icd ? `${ICD_PREFIX[icd]}:${ids[icd]}` : null, // preferred over duns and leiCode
    globalLocationNumber: ids.gln,
    naics: ids.naics,
    vatID: ids.vatId,
    taxID: ids.taxId && ids.taxIdCountry === country ? ids.taxId : null, // must match the address country
    hasMerchantReturnPolicy: (source.returnPolicies || []).map(buildReturnPolicy),
    hasShippingService: (source.shippingServices || []).map(buildShippingService),
    hasMemberProgram: buildMemberProgram(source.loyaltyProgram)
  };

  // (e) Strip empty values.
  return compact(schema);
}

// Node: const { buildOrganizationSchema } = require('./organization-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildOrganizationSchema };
