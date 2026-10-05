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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function buildEmployerRatingSchema(source) {
  // (a) Page gates: indexable, self-canonical, ratings visible on this page.
  if (!passesPageGates(source)) return null;
  // Users must be able to post ratings on this site, and the site must host them.
  if (!source.acceptsUserRatings || !source.ratingsHostedOnSite) return null;

  // (b) Required: itemReviewed (Organization with name), ratingValue, ratingCount or reviewCount.
  const employer = source.employer || {};
  const ratingCount = toCount(source.ratingCount);
  const reviewCount = toCount(source.reviewCount);
  if (!employer.name || (ratingCount === null && reviewCount === null)) return null;

  // (d) ratingValue must sit within worstRating..bestRating (defaults 1..5).
  const bestRating = toNumber(source.bestRating) ?? 5;
  const worstRating = toNumber(source.worstRating) ?? 1;
  const ratingValue = toNumber(source.ratingValue);
  if (ratingValue === null) return null;
  if (worstRating >= bestRating || ratingValue < worstRating || ratingValue > bestRating) return null;

  // (c) Required + recommended properties, only when the source has them.
  const schema = {
    "@context": "https://schema.org",
    "@type": "EmployerAggregateRating",
    itemReviewed: {
      "@type": "Organization",
      name: employer.name,
      sameAs: isAbsoluteUrl(employer.url) ? employer.url : null
    },
    ratingValue,
    ratingCount,
    reviewCount,
    bestRating,
    worstRating
  };

  // (e) Strip empty values.
  return compact(schema);
}

// Node: const { buildEmployerRatingSchema } = require('./employer-rating-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildEmployerRatingSchema };
