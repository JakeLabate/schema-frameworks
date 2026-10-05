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

const APP_CATEGORIES = new Set([
  "GameApplication", "SocialNetworkingApplication", "TravelApplication", "ShoppingApplication",
  "SportsApplication", "LifestyleApplication", "BusinessApplication", "DesignApplication",
  "DeveloperApplication", "DriverApplication", "EducationalApplication", "HealthApplication",
  "FinanceApplication", "SecurityApplication", "BrowserApplication", "CommunicationApplication",
  "DesktopEnhancementApplication", "EntertainmentApplication", "MultimediaApplication",
  "HomeApplication", "UtilitiesApplication", "ReferenceApplication"
]);

// VideoGame alone is not eligible, so games are always co-typed with an app type.
function chooseAppType(source) {
  const base = { mobile: "MobileApplication", web: "WebApplication" }[source.platform] ?? "SoftwareApplication";
  return source.isGame ? ["VideoGame", base] : base;
}

function buildSoftwareAppSchema(source) {
  if (!passesPageGates(source)) return null;

  // Required: name, offers.price (0 for free apps), and a rating or review.
  const name = String(source.name ?? "").trim();
  const price = toNumber(source.price);
  if (!name || price === null || price < 0) return null;
  const currency = isCurrencyCode(source.currency) ? source.currency : null;
  if (price > 0 && !currency) return null;

  const aggregateRating = buildRating(source.rating, "AggregateRating");
  const reviews = (source.reviews ?? []).map(buildReview).filter(Boolean);
  if (!aggregateRating && reviews.length === 0) return null;

  const category = String(source.applicationCategory ?? "").replace("https://schema.org/", "");

  return compact({
    "@context": "https://schema.org",
    "@type": chooseAppType(source),
    name,
    url: isAbsoluteUrl(source.url) ? source.url : null,
    operatingSystem: source.operatingSystem,
    applicationCategory: APP_CATEGORIES.has(category) ? category : null,
    offers: { "@type": "Offer", price, priceCurrency: currency },
    aggregateRating,
    review: reviews
  });
}

// Node: const { buildSoftwareAppSchema } = require('./software-app-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildSoftwareAppSchema };
