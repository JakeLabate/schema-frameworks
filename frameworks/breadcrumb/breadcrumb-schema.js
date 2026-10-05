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

// trail: ordered crumbs as shown on the page, [{ name, url }].
// The last crumb (usually the current page) may omit url.
function buildBreadcrumbSchema(source) {
  if (!passesPageGates(source)) return null;

  const trail = (source.trail || []).filter((crumb) => crumb && crumb.name);
  if (trail.length < 2) return null; // Google needs at least two ListItems

  const lastIndex = trail.length - 1;
  const itemListElement = [];
  for (const [index, crumb] of trail.entries()) {
    const hasUrl = isAbsoluteUrl(crumb.url);
    // Every crumb except the last must carry an absolute item URL.
    if (!hasUrl && index !== lastIndex) return null;
    itemListElement.push({
      "@type": "ListItem",
      "position": index + 1, // 1..n, no gaps or duplicates
      "name": String(crumb.name).trim(),
      "item": hasUrl ? crumb.url : null
    });
  }

  return compact({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": itemListElement
  }) || null;
}

// Node: const { buildBreadcrumbSchema } = require('./breadcrumb-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildBreadcrumbSchema };
