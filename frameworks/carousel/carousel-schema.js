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

// Host carousels only support these item types, each with its own required fields.
const REQUIRED_BY_TYPE = {
  Course: ["name", "description"],
  Movie: ["name", "image"],
  Recipe: ["name", "image"],
  Restaurant: ["name", "image"]
};

function hostOf(url) {
  return isAbsoluteUrl(url) ? new URL(url).hostname : null;
}

// Summary page: every item links to its own detail page, all on one domain.
// All-in-one page: every item is described on this page under its own anchor.
function chooseCarouselPattern(source) {
  const items = source.items || [];
  const hosts = new Set(items.map((i) => hostOf(i.detailUrl)));
  if (items.length && hosts.size === 1 && !hosts.has(null)) return "summary";
  if (items.length && items.every((i) => i.anchor && i.properties)) return "allInOne";
  return null;
}

function buildSummaryElements(items) {
  const urls = items.map((i) => i.detailUrl);
  if (new Set(urls).size !== urls.length) return null; // every url must be unique
  return items.map((i, index) => ({ "@type": "ListItem", "position": index + 1, "url": i.detailUrl }));
}

function buildAllInOneElements(source) {
  const itemType = source.itemType;
  const required = REQUIRED_BY_TYPE[itemType];
  if (!required) return null; // Course, Movie, Recipe or Restaurant only
  const anchors = source.items.map((i) => i.anchor);
  if (new Set(anchors).size !== anchors.length) return null; // one unique anchor per item

  const elements = [];
  for (const [index, i] of source.items.entries()) {
    // item.url is this page plus the anchor of the visible item.
    const item = compact({ "@type": itemType, ...i.properties, "url": `${source.url}#${i.anchor}` });
    if (!item || required.some((key) => item[key] === undefined)) return null;
    if (item.image !== undefined && ![].concat(item.image).every((u) => isAbsoluteUrl(typeof u === "string" ? u : u.url))) return null;
    elements.push({ "@type": "ListItem", "position": index + 1, "item": item });
  }
  return elements;
}

function buildCarouselSchema(source) {
  if (!passesPageGates(source)) return null;
  const items = source.items || [];
  if (items.length < 2) return null; // an ItemList needs at least two ListItems

  const pattern = chooseCarouselPattern(source);
  const itemListElement =
    pattern === "summary" ? buildSummaryElements(items) :
    pattern === "allInOne" ? buildAllInOneElements(source) :
    null; // never mix patterns in one list
  if (!itemListElement) return null;

  return compact({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "itemListElement": itemListElement
  }) || null;
}

// Node: const { buildCarouselSchema } = require('./carousel-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildCarouselSchema };
