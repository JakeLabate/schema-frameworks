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

// Speakable helpers
// Google: about 20 to 30 seconds per section, roughly two to three sentences.
// 75 words is our ceiling (about 30 seconds at a typical speaking pace).
const MAX_SPEAKABLE_WORDS = 75;

function chooseSpeakableType(source) {
  return source.isNewsArticle ? "NewsArticle" : "WebPage";
}

// Keep sections that matched in the rendered page and fit the length guideline.
// Skip datelines, photo captions and source attributions.
function selectSpeakableSections(sections) {
  return (sections || []).filter((s) =>
    s && s.selector && s.matchCount > 0 && s.wordCount > 0 && s.wordCount <= MAX_SPEAKABLE_WORDS &&
    !["dateline", "caption", "attribution"].includes(s.role)
  );
}

function buildSpeakableSchema(source) {
  const page = source.page;
  if (!passesPageGates(page)) return null;
  // Feature only serves English-language content (U.S. Google Home users).
  if (!/^en(-|$)/i.test(page.lang || "")) return null;

  const sections = selectSpeakableSections(source.speakableSections);
  // Use cssSelector or xpath, never both: pick one addressing mode per page.
  const mode = sections.some((s) => s.kind === "css") ? "css" : "xpath";
  const selectors = sections.filter((s) => s.kind === mode).map((s) => s.selector);
  // Required: speakable with at least one cssSelector or xpath.
  if (!selectors.length) return null;

  const type = chooseSpeakableType(source);
  return compact({
    "@context": "https://schema.org",
    "@type": type,
    [type === "WebPage" ? "name" : "headline"]: source.title,
    url: page.url,
    speakable: {
      "@type": "SpeakableSpecification",
      [mode === "css" ? "cssSelector" : "xpath"]: selectors
    }
  }) ?? null;
}

// Node: const { buildSpeakableSchema } = require('./speakable-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildSpeakableSchema };
