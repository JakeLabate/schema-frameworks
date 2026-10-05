// Shared helpers
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$/;

function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

function toIsoDate(value) {
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null;
}

// Keeps the original timezone offset; rejects naive or unparseable values.
function toIsoDateTime(value) {
  const match = typeof value === "string" ? ISO_DATETIME.exec(value) : null;
  return match && toIsoDate(match[1]) ? value : null;
}

// Drops null, undefined, "", [] and {} recursively.
function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = compact(item);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null || value === undefined || value === "" ? undefined : value;
}

// Page gates: indexable, self-canonical, marked-up content visible.
function passesPageGates(page) {
  if (!page || page.noindex || page.robotsBlocked) return false;
  if (!isAbsoluteUrl(page.url)) return false;
  if (page.canonicalUrl && page.canonicalUrl !== page.url) return false;
  return page.contentVisible === true;
}

// Paywall helpers
const CLASS_SELECTOR = /^\.[A-Za-z_-][A-Za-z0-9_-]*$/; // only .class selectors are supported

function chooseCreativeWorkType(source) {
  if (source.contentType === "news") return "NewsArticle";
  if (source.contentType === "article") return "Article";
  return "WebPage";
}

function buildAuthor(author) {
  if (!author || !author.name) return null;
  return {
    "@type": author.type === "Organization" ? "Organization" : "Person",
    name: author.name,
    url: isAbsoluteUrl(author.url) ? author.url : null
  };
}

// One WebPageElement per paywalled section; sections must not be nested.
function buildPaywalledParts(sections) {
  const valid = (sections || []).filter((s) => s && CLASS_SELECTOR.test(s.selector) && s.matchCount > 0);
  if (valid.some((s) => s.containsOtherSection || s.insideOtherSection)) return null;
  return valid.map((s) => ({
    "@type": "WebPageElement",
    isAccessibleForFree: false,
    cssSelector: s.selector
  }));
}

function buildPaywalledContentSchema(source) {
  const page = source.page;
  if (!passesPageGates(page)) return null;

  // Required: isAccessibleForFree as a real boolean.
  if (typeof source.isAccessibleForFree !== "boolean") return null;

  let hasPart = [];
  if (source.isAccessibleForFree === false) {
    hasPart = buildPaywalledParts(source.paywalledSections);
    // Nested sections cannot be described correctly: emit nothing.
    if (hasPart === null) return null;
  }

  const type = chooseCreativeWorkType(source);
  const isArticle = type !== "WebPage";
  const published = toIsoDateTime(source.datePublished);
  const modified = toIsoDateTime(source.dateModified);

  return compact({
    "@context": "https://schema.org",
    "@type": type,
    [isArticle ? "headline" : "name"]: source.title,
    url: page.url,
    image: isArticle ? (source.images || []).filter(isAbsoluteUrl) : null,
    datePublished: published,
    dateModified: modified && published && Date.parse(modified) >= Date.parse(published) ? modified : null,
    author: isArticle ? (source.authors || []).map(buildAuthor) : null,
    isAccessibleForFree: source.isAccessibleForFree,
    hasPart
  }) ?? null;
}

// Node: const { buildPaywalledContentSchema } = require('./subscription-paywalled-content-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildPaywalledContentSchema };
