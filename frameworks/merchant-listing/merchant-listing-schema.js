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
const AVAILABILITY = ["BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "SoldOut"];
const CONDITIONS = ["NewCondition", "RefurbishedCondition", "UsedCondition"];
const RETURN_CATEGORY = { finite: "MerchantReturnFiniteReturnWindow", not_permitted: "MerchantReturnNotPermitted", unlimited: "MerchantReturnUnlimitedWindow" };
const RETURN_FEES = { free: "FreeReturn", customer_pays: "ReturnFeesCustomerResponsibility", shipping_fee: "ReturnShippingFees" };
const RETURN_METHOD = { kiosk: "ReturnAtKiosk", mail: "ReturnByMail", in_store: "ReturnInStore" };
const GENDERS = ["male", "female", "unisex"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const isCurrencyCode = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const isCountryCode = (value) => typeof value === "string" && /^[A-Z]{2}$/.test(value);
const isRegionCode = (value) => typeof value === "string" && /^[A-Z0-9]{1,3}$/.test(value);
const isGtin = (value) => /^(\d{8}|\d{12,14})$/.test(String(value ?? "")); // numeric only, never a URL
const isSku = (value) => typeof value === "string" && /^\S+$/.test(value);   // no whitespace
const isIsoTime = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?(Z|[+-]\d{2}:\d{2})$/.test(value);
const schemaEnum = (value, allowed) => (allowed.includes(value) ? S + value : null);
// Comparable instant in ms; date-only and offset-less values are read as UTC.
const toInstant = (iso) =>
  Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : iso.length === 10 ? `${iso}T00:00:00Z` : `${iso}Z`);
const wholeNumber = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

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

function buildRegion(country, regions = [], postalCodes = []) {
  if (!isCountryCode(country)) return null;
  return {
    "@type": "DefinedRegion",
    addressCountry: country,
    addressRegion: regions.filter(isRegionCode),       // ISO 3166-2 subdivision without the country prefix
    postalCode: postalCodes.filter((p) => typeof p === "string" && p.trim())
  };
}

const daysRange = ([min, max] = []) =>
  wholeNumber(min) !== null && wholeNumber(max) !== null && min <= max
    ? { "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" }
    : null;

// One OfferShippingDetails per destination: shippingRate, shippingDestination and deliveryTime are required in it.
function buildShipping(s, origin) {
  const destination = buildRegion(s?.country, s?.regions, s?.postalCodes);
  const rate = toNumber(s?.rate);
  const handlingTime = daysRange(s?.handlingDays);
  const transitTime = daysRange(s?.transitDays);
  if (!destination || rate === null || rate < 0 || !isCurrencyCode(s.currency)) return null; // value 0 means free shipping
  if (!handlingTime && !transitTime) return null;
  const days = (s.businessDays ?? []).filter((d) => WEEKDAYS.includes(d));
  return {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: rate, currency: s.currency },
    shippingDestination: destination,
    shippingOrigin: buildRegion(origin?.country, origin?.regions),
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime,
      transitTime,
      cutoffTime: isIsoTime(s.cutoffTime) ? s.cutoffTime : null,
      businessDays: days.length ? { "@type": "OpeningHoursSpecification", dayOfWeek: days.map((d) => S + d) } : null
    }
  };
}

// Finite windows need merchantReturnDays; ReturnShippingFees needs returnShippingFeesAmount.
function buildReturnPolicy(r) {
  const countries = (r?.countries ?? []).filter(isCountryCode).slice(0, 50);
  const category = RETURN_CATEGORY[r?.category];
  if (!category || countries.length === 0) return null;
  const finite = category === "MerchantReturnFiniteReturnWindow";
  const days = wholeNumber(r.days);
  if (finite && !(days > 0)) return null;
  const fee = toNumber(r.feeAmount);
  const chargesShipping = r.fees === "shipping_fee";
  if (chargesShipping && !(fee !== null && fee >= 0 && isCurrencyCode(r.feeCurrency))) return null;
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: countries,
    returnPolicyCountry: (r.returnToCountries ?? []).filter(isCountryCode),
    returnPolicyCategory: S + category,
    merchantReturnDays: finite ? days : null,
    returnMethod: (r.methods ?? []).map((m) => RETURN_METHOD[m]).filter(Boolean).map((m) => S + m),
    returnFees: RETURN_FEES[r.fees] ? S + RETURN_FEES[r.fees] : null,
    returnShippingFeesAmount: chargesShipping ? { "@type": "MonetaryAmount", value: fee, currency: r.feeCurrency } : null,
    merchantReturnLink: isAbsoluteUrl(r.link) ? r.link : null
  };
}

// Extra UnitPriceSpecification entries: strikethrough, member tier and unit pricing.
// An active price has neither priceType nor validForMemberTier; never combine the two.
function buildPriceSpecifications(offer, price, currency) {
  const specs = [];
  const was = toNumber(offer.strikethroughPrice);
  if (was !== null && was > price) {
    specs.push({ "@type": "UnitPriceSpecification", priceType: S + "StrikethroughPrice", price: was, priceCurrency: currency });
  }
  const member = offer.memberPrice;
  const memberPrice = toNumber(member?.price);
  if (memberPrice > 0 && isAbsoluteUrl(member.tierId)) {
    specs.push({
      "@type": "UnitPriceSpecification",
      price: memberPrice,
      priceCurrency: currency,
      validForMemberTier: { "@id": member.tierId },             // tier defined under Organization.hasMemberProgram
      membershipPointsEarned: wholeNumber(member.pointsEarned)
    });
  }
  const unit = offer.unitPricing;
  const quantity = toNumber(unit?.value);
  const base = toNumber(unit?.baseValue);
  if (quantity > 0 && /^[A-Z0-9]{2,3}$/.test(unit.unitCode ?? "")) {
    specs.push({
      "@type": "UnitPriceSpecification",
      price,
      priceCurrency: currency,
      referenceQuantity: {
        "@type": "QuantitativeValue",
        value: quantity,
        unitCode: unit.unitCode,                                 // for example ML
        valueReference: base > 0 ? { "@type": "QuantitativeValue", value: base, unitCode: unit.baseUnitCode ?? unit.unitCode } : null
      }
    });
  }
  return specs;
}

// A single Offer (AggregateOffer is not supported) with price > 0 and an ISO 4217 currency.
function buildOffer(offer, source, now) {
  if (!offer || offer.lowPrice !== undefined) return null;
  const price = toNumber(offer.price);
  const currency = offer.currency;
  if (!(price > 0) || !isCurrencyCode(currency)) return null;

  // Sale window: validFrom must not be later than validThrough or priceValidUntil.
  const validUntil = toIsoDate(offer.priceValidUntil);
  const priceValidUntil = validUntil && toInstant(`${validUntil}T23:59:59`) >= now.getTime() ? validUntil : null; // a past date can hide the listing
  let validFrom = toIsoDateTime(offer.validFrom);
  let validThrough = toIsoDateTime(offer.validThrough);
  const end = validThrough ? toInstant(validThrough) : priceValidUntil ? toInstant(`${priceValidUntil}T23:59:59`) : null;
  if (validFrom && end !== null && toInstant(validFrom) > end) validFrom = validThrough = null;

  return {
    "@type": "Offer",
    url: isAbsoluteUrl(offer.url) ? offer.url : null,
    price,
    priceCurrency: currency,
    priceSpecification: buildPriceSpecifications(offer, price, currency),
    priceValidUntil,
    validFrom,
    validThrough,
    availability: schemaEnum(offer.availability, AVAILABILITY),
    itemCondition: schemaEnum(offer.condition, CONDITIONS),
    shippingDetails: (source.shipping ?? []).map((s) => buildShipping(s, source.shipsFrom)),
    hasMerchantReturnPolicy: buildReturnPolicy(source.returns)
  };
}

function buildAudience(a) {
  if (!a) return null;
  const min = toNumber(a.minAge);
  const max = toNumber(a.maxAge);
  return {
    "@type": "PeopleAudience",
    suggestedGender: GENDERS.includes(a.gender) ? a.gender : null,
    suggestedMinAge: min !== null && min >= 0 ? min : null,
    suggestedMaxAge: max !== null && max >= 0 && (min === null || max >= min) ? max : null
  };
}

function buildMerchantListingSchema(source, now = new Date()) {
  if (!passesPageGates(source)) return null;
  if (source.purchasable !== true) return null;             // no checkout on this page: use the Product snippet framework

  const name = String(source.name ?? "").trim();
  const images = (source.images ?? []).filter(isAbsoluteUrl);
  const offers = buildOffer(source.offer, source, now);
  if (!name || images.length === 0 || !offers) return null; // name, image and offers are required

  return compact({
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    image: images,
    description: source.description,
    sku: isSku(source.sku) ? source.sku : null,
    mpn: source.mpn,
    gtin: isGtin(source.gtin) ? String(source.gtin) : null,
    brand: source.brand ? { "@type": "Brand", name: source.brand } : null,
    category: source.category,
    color: source.color,
    material: source.material,
    pattern: source.pattern,
    size: source.size,
    audience: buildAudience(source.audience),
    aggregateRating: buildRating(source.rating, "AggregateRating"),
    review: (source.reviews ?? []).map(buildReview).filter(Boolean),
    offers
  });
}

// Node: const { buildMerchantListingSchema } = require('./merchant-listing-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildMerchantListingSchema };
