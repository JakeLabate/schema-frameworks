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


const REVIEWABLE_TYPES = [
  "Book", "Course", "CreativeWorkSeason", "CreativeWorkSeries", "Episode", "Event", "Game", "HowTo",
  "LocalBusiness", "MediaObject", "Movie", "MusicPlaylist", "MusicRecording", "Organization", "Product",
  "Recipe", "SoftwareApplication"
]; // add the subtypes you use (for example Restaurant, MobileApplication)
const SELF_SERVING_TYPES = ["LocalBusiness", "Organization"];

function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value); // "4,4" fails here: Google needs a dot decimal separator
  return Number.isFinite(number) ? number : null;
}

function buildRating(type, raw) {
  const ratingValue = toNumber(raw.value);
  const bestRating = toNumber(raw.best) ?? 5;
  const worstRating = toNumber(raw.worst) ?? 1;
  if (ratingValue === null || worstRating >= bestRating) return null;
  if (ratingValue < worstRating || ratingValue > bestRating) return null;
  return { "@type": type, ratingValue, bestRating, worstRating };
}

// One visible review: Review. A visible average across many reviewers: AggregateRating.
function chooseReviewType(source) {
  if (source.aggregate) return "AggregateRating";
  return source.review ? "Review" : null;
}

function buildReviewSnippetSchema(source) {
  // (a) Page gates: indexable, self-canonical, review content immediately visible on the page.
  if (!passesPageGates(source)) return null;

  // (b) Required: itemReviewed with a supported @type and a name.
  const item = source.item || {};
  if (!item.name || !REVIEWABLE_TYPES.includes(item.type)) return null;
  // Self-serving: an organization or local business reviewed on a site it controls is ineligible.
  if (SELF_SERVING_TYPES.includes(item.type) && source.siteControlledByReviewedEntity) return null;

  const itemReviewed = {
    "@type": item.type,
    name: item.name,
    url: isAbsoluteUrl(item.url) ? item.url : null
  };
  const type = chooseReviewType(source);

  if (type === "Review") {
    // Review: author (name under 100 characters) and reviewRating.ratingValue are required.
    const review = source.review;
    const authorName = (review.authorName || "").trim();
    const reviewRating = buildRating("Rating", review.rating || {});
    if (!authorName || authorName.length >= 100 || !reviewRating) return null;
    return compact({
      "@context": "https://schema.org",
      "@type": "Review",
      itemReviewed,
      author: { "@type": review.authorIsOrganization ? "Organization" : "Person", name: authorName },
      reviewRating,
      datePublished: toIsoDate(review.datePublished)
    });
  }

  if (type === "AggregateRating") {
    // AggregateRating: ratingValue plus ratingCount or reviewCount are required.
    const agg = source.aggregate;
    const rating = buildRating("AggregateRating", agg);
    const ratingCount = Number.isInteger(agg.ratingCount) && agg.ratingCount > 0 ? agg.ratingCount : null;
    const reviewCount = Number.isInteger(agg.reviewCount) && agg.reviewCount > 0 ? agg.reviewCount : null;
    if (!rating || (ratingCount === null && reviewCount === null)) return null;
    return compact({
      "@context": "https://schema.org",
      ...rating,
      itemReviewed,
      ratingCount,
      reviewCount
    });
  }

  return null;
}

// Node: const { buildReviewSnippetSchema } = require('./review-snippet-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildReviewSnippetSchema };
