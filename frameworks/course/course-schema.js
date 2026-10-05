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

const PROMO = /[$€£]\s?\d|\d+\s?%\s?off|\b(sale|discount|deal|cheap|free|best|top|only|make money)\b/i;
const DESCRIPTION_DISPLAY_LIMIT = 60;

// A real course title: no prices, discounts, superlatives or non-course phrases.
function isCourseName(name) {
  return typeof name === "string" && name.trim() !== "" && !PROMO.test(name);
}

// Google shows about 60 characters; prefer a short summary when the full text is longer.
function pickDescription(course) {
  const full = (course.description || "").trim();
  const short = (course.shortDescription || "").trim();
  if (full.length > DESCRIPTION_DISPLAY_LIMIT && short && short.length <= DESCRIPTION_DISPLAY_LIMIT) return short;
  return full || short || null;
}

// Course detail page (summary pattern): one Course node per detail page.
function buildCourseSchema(source) {
  if (!passesPageGates(source)) return null;
  // Course markup only earns a course list when a summary page lists the course.
  if (!isAbsoluteUrl(source.listedOnUrl)) return null;
  if (!isCourseName(source.name)) return null;
  const description = pickDescription(source);
  if (!description) return null;

  const provider = source.provider || {};
  return compact({
    "@context": "https://schema.org",
    "@type": "Course",
    "name": source.name.trim(),
    "description": description,
    "provider": provider.name ? {
      "@type": "Organization",
      "name": provider.name,
      "sameAs": isAbsoluteUrl(provider.url) ? provider.url : null
    } : null
  }) || null;
}

// Summary page: an ItemList of at least three course detail URLs.
// Usage: buildCourseListSchema({ ...pageGates, url, courseUrls: [url1, url2, url3] })
function buildCourseListSchema(source) {
  if (!passesPageGates(source)) return null;
  const urls = (source.courseUrls || []).filter(isAbsoluteUrl);
  if (urls.length < 3 || urls.length !== (source.courseUrls || []).length) return null;
  if (new Set(urls).size !== urls.length) return null; // unique detail URLs
  if (new Set(urls.map((u) => new URL(u).hostname)).size !== 1) return null; // one domain

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "itemListElement": urls.map((url, index) => ({ "@type": "ListItem", "position": index + 1, "url": url }))
  };
}

// Node: const { buildCourseSchema } = require('./course-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildCourseSchema };
