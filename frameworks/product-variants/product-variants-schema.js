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
const VARIES_BY = ["color", "size", "suggestedAge", "suggestedGender", "material", "pattern"];
const AVAILABILITY = ["BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "SoldOut"];
const CONDITIONS = ["NewCondition", "RefurbishedCondition", "UsedCondition"];
const RETURN_CATEGORY = { finite: "MerchantReturnFiniteReturnWindow", not_permitted: "MerchantReturnNotPermitted", unlimited: "MerchantReturnUnlimitedWindow" };
const RETURN_FEES = { free: "FreeReturn", customer_pays: "ReturnFeesCustomerResponsibility" };
const GENDERS = ["male", "female", "unisex"];

function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const isCurrencyCode = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const isCountryCode = (value) => typeof value === "string" && /^[A-Z]{2}$/.test(value);
const isGtin = (value) => /^(\d{8}|\d{12,14})$/.test(String(value ?? ""));
const isSku = (value) => typeof value === "string" && /^\S+$/.test(value);
const schemaEnum = (value, allowed) => (allowed.includes(value) ? S + value : null);
const wholeNumber = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const baseUrl = (url) => url.split(/[?#]/)[0];

// Rating or AggregateRating; null when ratingValue falls outside worstRating..bestRating.
function buildRating(input, type) {
  if (!input) return null;
  const best = toNumber(input.bestRating) ?? 5;
  const worst = toNumber(input.worstRating) ?? 1;
  const value = toNumber(input.ratingValue);
  if (value === null || worst >= best || value < worst || value > best) return null;
  const rating = { "@type": type, ratingValue: value, bestRating: best, worstRating: worst };
  if (type === "AggregateRating") {
    const ratingCount = toNumber(input.ratingCount);
    const reviewCount = toNumber(input.reviewCount);
    if (!(ratingCount > 0) && !(reviewCount > 0)) return null;
    rating.ratingCount = ratingCount > 0 ? ratingCount : null;
    rating.reviewCount = reviewCount > 0 ? reviewCount : null;
  }
  return rating;
}

// Review with a valid author name (under 100 characters) and an in-range rating.
function buildReview(input) {
  const authorName = String(input?.authorName ?? "").trim();
  const reviewRating = buildRating(input?.rating, "Rating");
  if (!authorName || authorName.length >= 100 || !reviewRating) return null;
  return {
    "@type": "Review",
    author: { "@type": input.authorType === "Organization" ? "Organization" : "Person", name: authorName },
    reviewRating,
    datePublished: toIsoDate(input.datePublished)
  };
}

const daysRange = ([min, max] = []) =>
  wholeNumber(min) !== null && wholeNumber(max) !== null && min <= max
    ? { "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" }
    : null;

// Shared by every variant. Full shipping and return options: see the Merchant Listing framework.
function buildShipping(s) {
  const rate = toNumber(s?.rate);
  const handlingTime = daysRange(s?.handlingDays);
  const transitTime = daysRange(s?.transitDays);
  if (rate === null || rate < 0 || !isCurrencyCode(s.currency) || !isCountryCode(s.country)) return null;
  if (!handlingTime && !transitTime) return null;
  return {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: rate, currency: s.currency },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: s.country },
    deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime, transitTime }
  };
}

function buildReturnPolicy(r) {
  const category = RETURN_CATEGORY[r?.category];
  const days = wholeNumber(r?.days);
  if (!category || !isCountryCode(r.country)) return null;
  if (category === "MerchantReturnFiniteReturnWindow" && !(days > 0)) return null;
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: r.country,
    returnPolicyCategory: S + category,
    merchantReturnDays: category === "MerchantReturnFiniteReturnWindow" ? days : null,
    returnFees: RETURN_FEES[r.fees] ? S + RETURN_FEES[r.fees] : null
  };
}

// Each variant meets merchant listing rules: one Offer, price > 0, ISO 4217 currency.
function buildVariantOffer(offer, url, shared) {
  const price = toNumber(offer?.price);
  if (!(price > 0) || !isCurrencyCode(offer.currency)) return null;
  return {
    "@type": "Offer",
    url,
    price,
    priceCurrency: offer.currency,
    availability: schemaEnum(offer.availability, AVAILABILITY),
    itemCondition: schemaEnum(offer.condition ?? "NewCondition", CONDITIONS),
    shippingDetails: buildShipping(shared.shipping),
    hasMerchantReturnPolicy: buildReturnPolicy(shared.returns)
  };
}

// Single-page: every variant is preselected on the group URL with query parameters (?color=green&size=m).
// Multi-page: each variant has its own page, and each page repeats the full group markup.
function chooseVariantApproach(source) {
  const groupUrl = isAbsoluteUrl(source.url) ? baseUrl(source.url) : null;
  const variants = source.variants ?? [];
  const onGroupUrl = (v) => typeof v.url === "string" && v.url.startsWith(`${groupUrl}?`);
  return groupUrl && variants.length > 0 && variants.every(onGroupUrl) ? "single-page" : "multi-page";
}

// Values for each variesBy property; null when a variant does not state one.
function variantAttributes(variant, variesBy) {
  const attributes = {};
  for (const key of variesBy) {
    const value = variant[key];
    if (value === null || value === undefined || value === "") return null;
    attributes[key] = value;
  }
  return attributes;
}

function buildVariant(variant, ctx) {
  const name = String(variant.name ?? "").trim();
  const sku = isSku(variant.sku) ? variant.sku : null;
  const gtin = isGtin(variant.gtin) ? String(variant.gtin) : null;
  const images = (variant.images ?? []).filter(isAbsoluteUrl);
  const attributes = variantAttributes(variant, ctx.variesBy);
  const url = isAbsoluteUrl(variant.url) ? variant.url : null;      // a distinct URL that preselects this variant
  const offers = buildVariantOffer(variant.offer, url, ctx.shared);
  if (!name || (!sku && !gtin) || !attributes || !url || images.length === 0 || !offers) return null;

  const { suggestedGender, suggestedAge, ...direct } = attributes;  // audience attributes go on PeopleAudience
  const [minAge, maxAge] = suggestedAge ?? [];
  return {
    "@type": "Product",
    name,
    sku,
    gtin,
    image: images,
    description: variant.description,
    inProductGroupWithID: ctx.groupId,
    isVariantOf: { "@id": ctx.groupRef },
    ...direct,
    audience: suggestedGender || suggestedAge ? {
      "@type": "PeopleAudience",
      suggestedGender: GENDERS.includes(suggestedGender) ? suggestedGender : null,
      suggestedMinAge: toNumber(minAge),
      suggestedMaxAge: toNumber(maxAge)
    } : null,
    url,
    offers
  };
}

function buildProductGroupSchema(source) {
  if (!passesPageGates(source)) return null;
  const name = String(source.name ?? "").trim();
  const groupId = isSku(source.groupId) ? source.groupId : null;     // productGroupID, usually the parent sku
  const variesBy = (source.variesBy ?? []).filter((v) => VARIES_BY.includes(v));
  if (!name || !groupId || variesBy.length === 0 || !isAbsoluteUrl(source.url)) return null;

  const approach = chooseVariantApproach(source);
  const groupUrl = baseUrl(source.url);
  const ctx = {
    approach,
    groupUrl,
    groupId,
    groupRef: `${new URL(groupUrl).origin}/#product-group-${encodeURIComponent(groupId)}`, // same @id on every page
    variesBy,
    shared: source
  };

  // Unique variant IDs (sku or gtin) and a distinct combination of variesBy values per variant.
  const ids = new Set();
  const combos = new Set();
  const variants = [];
  for (const input of source.variants ?? []) {
    const variant = buildVariant(input, ctx);
    if (!variant) continue;
    const id = variant.sku ?? variant.gtin;
    const combo = JSON.stringify(variesBy.map((key) => input[key]));
    if (ids.has(id) || combos.has(combo)) continue;
    ids.add(id);
    combos.add(combo);
    variants.push(variant);
  }
  if (variants.length < 2) return null;                              // one variant: use the Merchant Listing framework

  return compact({
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    "@id": ctx.groupRef,
    name,
    description: source.description,
    url: approach === "single-page" ? groupUrl : null,               // single-page sites only, without variant selectors
    brand: source.brand ? { "@type": "Brand", name: source.brand } : null,
    aggregateRating: buildRating(source.rating, "AggregateRating"),  // representative of all variants
    review: (source.reviews ?? []).map(buildReview).filter(Boolean),
    productGroupID: groupId,
    variesBy: variesBy.map((key) => S + key),
    hasVariant: variants
  });
}

// Node: const { buildProductGroupSchema } = require('./product-variants-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildProductGroupSchema };
