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

function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const isCurrencyCode = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);

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

const AVAILABILITY = ["BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "SoldOut"];
const CONDITIONS = ["NewCondition", "RefurbishedCondition", "UsedCondition"];
const VARIES_BY = ["color", "size", "suggestedAge", "suggestedGender", "material", "pattern"];
const RETURN_CATEGORY = { finite: "MerchantReturnFiniteReturnWindow", none: "MerchantReturnNotPermitted", unlimited: "MerchantReturnUnlimitedWindow" };
const RETURN_FEES = { free: "FreeReturn", customer: "ReturnFeesCustomerResponsibility", shipping: "ReturnShippingFees" };
const RETURN_METHOD = { kiosk: "ReturnAtKiosk", mail: "ReturnByMail", store: "ReturnInStore" };
const schemaEnum = (value, allowed) => (allowed.includes(value) ? `https://schema.org/${value}` : null);
const isGtin = (value) => /^(\d{8}|\d{12,14})$/.test(String(value ?? ""));
const isSku = (value) => typeof value === "string" && /^\S+$/.test(value);

// Merchant listing: the shopper can buy on this page. Product snippet: editorial or review page.
// More than one variant of the same product makes the top-level entity a ProductGroup.
function chooseProductType(source) {
  return {
    entity: (source.variants ?? []).length > 1 ? "ProductGroup" : "Product",
    listing: source.purchasable ? "merchant" : "snippet"
  };
}

const daysRange = ([min, max] = []) =>
  Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min
    ? { "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" }
    : null;

function buildShipping(s) {
  const rate = toNumber(s?.rate);
  if (rate === null || rate < 0 || !isCurrencyCode(s.currency) || !/^[A-Z]{2}$/.test(s.country ?? "")) return null;
  return {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: rate, currency: s.currency },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: s.country },
    deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: daysRange(s.handlingDays), transitTime: daysRange(s.transitDays) }
  };
}

// Finite windows need merchantReturnDays; ReturnShippingFees needs returnShippingFeesAmount.
function buildReturnPolicy(r) {
  const category = RETURN_CATEGORY[r?.category];
  const days = toNumber(r?.days);
  const fee = toNumber(r?.feeAmount);
  if (!category || !/^[A-Z]{2}$/.test(r.country ?? "")) return null;
  if (category === "MerchantReturnFiniteReturnWindow" && !(Number.isInteger(days) && days > 0)) return null;
  if (r.fees === "shipping" && !(fee !== null && fee >= 0 && isCurrencyCode(r.currency))) return null;
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: r.country,
    returnPolicyCategory: `https://schema.org/${category}`,
    merchantReturnDays: category === "MerchantReturnFiniteReturnWindow" ? days : null,
    returnMethod: RETURN_METHOD[r.method] ? `https://schema.org/${RETURN_METHOD[r.method]}` : null,
    returnFees: RETURN_FEES[r.fees] ? `https://schema.org/${RETURN_FEES[r.fees]}` : null,
    returnShippingFeesAmount: r.fees === "shipping" ? { "@type": "MonetaryAmount", value: fee, currency: r.currency } : null
  };
}

// Merchant listings need an Offer with price > 0 and priceCurrency; snippets accept price 0 or an AggregateOffer.
function buildOffer(offer, listing, shared, now) {
  if (!offer) return null;
  if (offer.lowPrice !== undefined) {
    const low = toNumber(offer.lowPrice);
    const high = toNumber(offer.highPrice);
    if (listing === "merchant" || low === null || low < 0 || !isCurrencyCode(offer.currency)) return null;
    return { "@type": "AggregateOffer", lowPrice: low, highPrice: high >= low ? high : null, offerCount: toNumber(offer.offerCount), priceCurrency: offer.currency };
  }
  const price = toNumber(offer.price);
  const currency = isCurrencyCode(offer.currency) ? offer.currency : null;
  if (price === null || price < 0) return null;
  if (listing === "merchant" && (price <= 0 || !currency)) return null;
  const validUntil = toIsoDate(offer.priceValidUntil);
  return {
    "@type": "Offer",
    url: isAbsoluteUrl(offer.url) ? offer.url : null,
    price,
    priceCurrency: currency,
    priceValidUntil: validUntil && new Date(`${validUntil}T23:59:59Z`) >= now ? validUntil : null,
    availability: schemaEnum(offer.availability, AVAILABILITY),
    itemCondition: schemaEnum(offer.condition, CONDITIONS),
    shippingDetails: listing === "merchant" ? buildShipping(shared.shipping) : null,
    hasMerchantReturnPolicy: listing === "merchant" ? buildReturnPolicy(shared.returns) : null
  };
}

// Pros and cons: editorial reviews only, and at least two statements across both lists.
function buildEditorialReview(input, listing) {
  const review = buildReview(input);
  if (!review) return null;
  const notes = (list) => (list ?? []).filter(Boolean).map((name, i) => ({ "@type": "ListItem", position: i + 1, name }));
  const pros = notes(input.pros);
  const cons = notes(input.cons);
  if (listing !== "snippet" || pros.length + cons.length < 2) return review;
  return {
    ...review,
    positiveNotes: pros.length ? { "@type": "ItemList", itemListElement: pros } : null,
    negativeNotes: cons.length ? { "@type": "ItemList", itemListElement: cons } : null
  };
}

function buildVariant(variant, listing, shared, groupId, variesBy, now) {
  const images = (variant.images ?? []).filter(isAbsoluteUrl);
  const offers = buildOffer(variant.offer, listing, shared, now);
  if (!variant.name || (!isSku(variant.sku) && !isGtin(variant.gtin))) return null;
  if (listing === "merchant" && (images.length === 0 || offers?.["@type"] !== "Offer")) return null;
  const attributes = Object.fromEntries(variesBy.map((key) => [key, variant[key]]));
  return {
    "@type": "Product",
    name: variant.name,
    sku: isSku(variant.sku) ? variant.sku : null,
    gtin: isGtin(variant.gtin) ? String(variant.gtin) : null,
    inProductGroupWithID: groupId,
    ...attributes,
    url: isAbsoluteUrl(variant.url) ? variant.url : null,
    image: images,
    offers
  };
}

function buildProductSchema(source, now = new Date()) {
  if (!passesPageGates(source)) return null;
  const { entity, listing } = chooseProductType(source);

  const name = String(source.name ?? "").trim();
  const images = (source.images ?? []).filter(isAbsoluteUrl);
  if (!name) return null;

  const aggregateRating = buildRating(source.rating, "AggregateRating");
  const reviews = (source.reviews ?? []).map((r) => buildEditorialReview(r, listing)).filter(Boolean);
  const shared = {
    "@context": "https://schema.org",
    "@type": entity,
    name,
    image: images,
    description: source.description,
    brand: source.brand ? { "@type": "Brand", name: source.brand } : null,
    aggregateRating,
    review: reviews
  };

  if (entity === "ProductGroup") {
    const groupId = isSku(source.groupId) ? source.groupId : null;
    const variesBy = (source.variesBy ?? []).filter((v) => VARIES_BY.includes(v));
    const ids = new Set();
    const variants = source.variants
      .map((v) => buildVariant(v, listing, source, groupId, variesBy, now))
      .filter((v) => {
        const id = v?.sku ?? v?.gtin;                        // each variant needs a unique ID
        if (!v || ids.has(id)) return false;
        ids.add(id);
        return true;
      });
    if (!groupId || variants.length === 0) return null;
    return compact({
      ...shared,
      productGroupID: groupId,
      url: source.variantPages ? null : source.url,          // single-page sites only
      variesBy: variesBy.map((v) => `https://schema.org/${v}`),
      hasVariant: variants
    });
  }

  // Merchant listing requires image and a valid Offer; product snippet requires review, rating or offers.
  const offers = buildOffer(source.offer, listing, source, now);
  if (listing === "merchant" && (images.length === 0 || offers?.["@type"] !== "Offer")) return null;
  if (listing === "snippet" && !offers && !aggregateRating && reviews.length === 0) return null;

  return compact({
    ...shared,
    sku: isSku(source.sku) ? source.sku : null,
    mpn: source.mpn,
    gtin: isGtin(source.gtin) ? String(source.gtin) : null,
    offers
  });
}

// Node: const { buildProductSchema } = require('./product-snippet-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildProductSchema };
