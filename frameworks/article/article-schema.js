const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isRealDate(y, m, d) {
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

// Calendar date (YYYY-MM-DD); a full date-time is cut to its date part.
function toIsoDate(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const m = v.match(ISO_DATE) || v.match(ISO_DATE_TIME);
  return m && isRealDate(m[1], m[2], m[3]) ? v.slice(0, 10) : null;
}

// Date-time with Z or an offset (kept as written), or a plain date.
// A date-time without a timezone is rejected instead of guessed.
function toIsoDateTime(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const m = v.match(ISO_DATE) || v.match(ISO_DATE_TIME);
  return m && isRealDate(m[1], m[2], m[3]) ? v : null;
}

// Drop null, undefined, "", [] and {} recursively.
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
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

// Page gates: indexable, self-canonical, and the marked-up content is visible.
function passesPageGates(source) {
  if (!source.isIndexable || !source.isContentVisible) return false;
  if (!isAbsoluteUrl(source.url)) return false;
  return !source.canonicalUrl || source.canonicalUrl === source.url;
}

const HONORIFIC = /^(dr|mr|mrs|ms|prof)\.?\s+/i;
const BYLINE_PREFIX = /^(posted by|written by|by)\s+/i;
const MIN_IMAGE_PIXELS = 50000;

function chooseArticleType(source) {
  if (source.template === "news") return "NewsArticle";
  if (source.template === "blog") return "BlogPosting";
  return "Article";
}

// author.name holds only the name: strip byline prefixes and honorifics,
// and reject strings that join several people or carry a job title.
function cleanAuthorName(name, publisherName) {
  if (typeof name !== "string") return null;
  const clean = name.trim().replace(BYLINE_PREFIX, "").replace(HONORIFIC, "").trim();
  if (!clean || /,|\||\s(and|&)\s/i.test(clean)) return null;
  if (publisherName && clean.toLowerCase().includes(publisherName.toLowerCase())) return null;
  return clean;
}

function buildAuthor(author, publisherName) {
  const name = cleanAuthorName(author.name, publisherName);
  if (!name) return null;
  return {
    "@type": author.isOrganization ? "Organization" : "Person",
    "name": name,
    "url": isAbsoluteUrl(author.url) ? author.url : null
  };
}

// Keep crawlable absolute images; drop any image known to be under 50K pixels.
function buildImages(images) {
  return (images || [])
    .filter((img) => isAbsoluteUrl(img.url))
    .filter((img) => !(img.width && img.height) || img.width * img.height >= MIN_IMAGE_PIXELS)
    .map((img) => ({ "@type": "ImageObject", "url": img.url, "width": img.width, "height": img.height }));
}

function buildArticleSchema(source) {
  if (!passesPageGates(source)) return null;
  // Google lists no required Article properties. This framework still
  // refuses to emit a node without the visible headline.
  if (!source.headline) return null;

  const datePublished = toIsoDateTime(source.datePublished);
  let dateModified = toIsoDateTime(source.dateModified);
  if (datePublished && dateModified && Date.parse(dateModified) < Date.parse(datePublished)) {
    dateModified = null; // never emit a modified date earlier than the publish date
  }

  const schema = {
    "@context": "https://schema.org",
    "@type": chooseArticleType(source),
    "headline": source.headline.trim(),
    "image": buildImages(source.images),
    "datePublished": datePublished,
    "dateModified": dateModified,
    // Each author in its own entry, never one joined string.
    "author": (source.authors || []).map((a) => buildAuthor(a, source.publisherName)).filter(Boolean)
  };

  return compact(schema) || null;
}

// Node: const { buildArticleSchema } = require('./article-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildArticleSchema };
