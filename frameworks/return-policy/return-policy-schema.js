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

function chooseOrganizationType(org) {
  return ORGANIZATION_TYPES[org.kind] || "Organization";
}

function toCountryCode(value) {
  const code = String(value || "").toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

// ISO 3166-1 alpha-2 codes, at most 50; null when any code is invalid or the list is too long.
function toCountryList(values) {
  const codes = (values || []).map(toCountryCode);
  if (codes.includes(null) || codes.length > 50) return null;
  return [...new Set(codes)];
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

// restockingFee: a Number is a percentage of the price paid, a MonetaryAmount is a fixed fee.
function buildRestockingFee(fee) {
  if (!fee) return null;
  if (typeof fee.percent === "number") return fee.percent >= 0 && fee.percent <= 100 ? fee.percent : null;
  return buildMoney(fee);
}

// Fee type and label source; the shipping fee amount only (and always) with ReturnShippingFees.
function buildFees(group) {
  if (!group) return {};
  const amount = buildMoney(group.shippingFee);
  let fees = RETURN_FEES[group.fees] || null;
  if (fees === RETURN_FEES.shipping_fee && !amount) fees = null;
  return { fees, label: RETURN_LABEL[group.label] || null, amount: fees === RETURN_FEES.shipping_fee ? amount : null };
}

function buildSeasonalOverride(season) {
  const category = RETURN_CATEGORY[season.category];
  if (!category) return null; // returnPolicyCategory is required in an override
  const days = toWholeNumber(season.days);
  if (category === RETURN_CATEGORY.finite && days === null) return null;
  const startDate = toIsoDate(season.start);
  const endDate = toIsoDate(season.end);
  if (!startDate || !endDate || endDate < startDate) return null; // a dated window, end on or after start
  return {
    "@type": "MerchantReturnPolicySeasonalOverride",
    startDate,
    endDate,
    returnPolicyCategory: category,
    merchantReturnDays: category === RETURN_CATEGORY.finite ? days : null
  };
}

function buildReturnPolicy(policy) {
  const link = isAbsoluteUrl(policy.link) ? policy.link : null;
  const countries = toCountryList(policy.countries);
  const category = RETURN_CATEGORY[policy.category] || null;
  if (countries === null) return null; // invalid code or more than 50 countries

  // Required option: applicableCountry + returnPolicyCategory, or merchantReturnLink alone.
  if (!(countries.length && category)) {
    return link ? { "@type": "MerchantReturnPolicy", merchantReturnLink: link } : null;
  }
  const days = toWholeNumber(policy.days);
  if (category === RETURN_CATEGORY.finite && days === null) return null; // finite window needs merchantReturnDays

  const base = { "@type": "MerchantReturnPolicy", applicableCountry: countries, returnPolicyCategory: category, merchantReturnLink: link };
  // No returns: fees, methods and days are not meaningful.
  if (category === RETURN_CATEGORY.not_permitted) return base;

  const main = buildFees(policy);
  const remorse = buildFees(policy.customerRemorse);
  const defect = buildFees(policy.itemDefect);
  return {
    ...base,
    merchantReturnDays: category === RETURN_CATEGORY.finite ? days : null,
    returnPolicyCountry: toCountryList(policy.returnToCountries),
    returnMethod: mapEnum(policy.methods, RETURN_METHOD),
    returnFees: main.fees,
    returnShippingFeesAmount: main.amount,
    returnLabelSource: main.label,
    refundType: mapEnum(policy.refundTypes, REFUND_TYPE),
    itemCondition: mapEnum(policy.conditions, ITEM_CONDITION),
    restockingFee: buildRestockingFee(policy.restockingFee),
    customerRemorseReturnFees: remorse.fees,
    customerRemorseReturnShippingFeesAmount: remorse.amount,
    customerRemorseReturnLabelSource: remorse.label,
    itemDefectReturnFees: defect.fees,
    itemDefectReturnShippingFeesAmount: defect.amount,
    itemDefectReturnLabelSource: defect.label,
    returnPolicySeasonalOverride: (policy.seasonalOverrides || []).map(buildSeasonalOverride)
  };
}

function buildReturnPolicySchema(source) {
  // (a) Page gates: indexable, self-canonical, visible policy text, on the page that describes the return policy.
  if (!passesPageGates(source) || source.pageRole !== "return_policy") return null;

  // (b) At least one policy must pass Google's required option (country + category, or merchantReturnLink).
  const hasMerchantReturnPolicy = (source.policies || []).map(buildReturnPolicy).filter(Boolean);
  if (!hasMerchantReturnPolicy.length) return null;

  // House rule: nest under the Organization, identified by name, home URL and the same @id as the home page markup.
  const org = source.organization || {};
  if (!org.name || !isAbsoluteUrl(org.url)) return null;

  // (c) and (d) applied inside buildReturnPolicy; (e) strip empty values.
  return compact({
    "@context": "https://schema.org",
    "@type": chooseOrganizationType(org),
    "@id": `${org.url}#organization`,
    name: org.name,
    url: org.url,
    hasMerchantReturnPolicy
  });
}

// Node: const { buildReturnPolicySchema } = require('./return-policy-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildReturnPolicySchema };
