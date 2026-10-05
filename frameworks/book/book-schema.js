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

const BOOK_FORMATS = ["AudiobookFormat", "EBook", "Hardcover", "Paperback"];
const PLATFORMS = ["DesktopWebPlatform", "AndroidPlatform", "IOSPlatform"];
const OFFER_CATEGORIES = ["nologinrequired", "free", "subscription", "purchase", "rental"];

// Google Search accepts ISBN-13 only: ISBN-10 is converted, checksums are verified.
function toIsbn13(value) {
  const raw = String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
  let digits = raw;
  if (/^\d{9}[\dX]$/.test(raw)) {
    const sum10 = [...raw].reduce((s, c, i) => s + (c === "X" ? 10 : Number(c)) * (10 - i), 0);
    if (sum10 % 11 !== 0) return null;
    digits = `978${raw.slice(0, 9)}`;
  } else if (/^97[89]\d{10}$/.test(raw)) {
    digits = raw.slice(0, 12);
  } else {
    return null;
  }
  const sum = [...digits].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  const isbn = `${digits}${(10 - (sum % 10)) % 10}`;
  return raw.length === 13 && isbn !== raw ? null : isbn;
}

// ReadAction needs an Offer (category + eligibleRegion); purchase and rental need a price.
function buildOffer(offer, now) {
  const ends = toIsoDateTime(offer.availabilityEnds);
  if (ends && new Date(ends) < now) return null;                 // stale: drop it from the feed
  const price = toNumber(offer.price);
  const needsPrice = offer.category === "purchase" || offer.category === "rental";
  const regions = (offer.regions ?? []).filter((r) => /^[A-Z]{2}$/.test(r));
  if (!OFFER_CATEGORIES.includes(offer.category) || regions.length === 0) return null;
  if (needsPrice && (price === null || price < 0 || !isCurrencyCode(offer.currency))) return null;
  return {
    "@type": "Offer",
    category: offer.category,
    price: needsPrice ? price : null,
    priceCurrency: needsPrice ? offer.currency : null,
    availabilityStarts: toIsoDateTime(offer.availabilityStarts),
    availabilityEnds: ends,
    eligibleRegion: regions.map((name) => ({ "@type": "Country", name }))
  };
}

function buildAction(action, now) {
  const platforms = (action.platforms ?? []).filter((p) => PLATFORMS.includes(p));
  if (!isAbsoluteUrl(action.url) || platforms.length === 0) return null;
  const target = {
    "@type": "EntryPoint",
    urlTemplate: action.url,
    actionPlatform: platforms.map((p) => `https://schema.org/${p}`)
  };
  if (action.type === "BorrowAction") {
    if (!isAbsoluteUrl(action.libraryId)) return null;            // lender @id, described in the library feed
    return { "@type": "BorrowAction", target, lender: { "@type": "LibrarySystem", "@id": action.libraryId } };
  }
  const offers = (action.offers ?? []).map((o) => buildOffer(o, now)).filter(Boolean);
  return offers.length ? { "@type": "ReadAction", target, expectsAcceptanceOf: offers } : null;
}

function buildEdition(edition, now) {
  const isbn = toIsbn13(edition.isbn);
  const actions = (edition.actions ?? []).map((a) => buildAction(a, now)).filter(Boolean);
  if (!isAbsoluteUrl(edition.id) || !BOOK_FORMATS.includes(edition.format) || !/^[a-z]{2}$/.test(edition.language ?? "") || !isbn || actions.length === 0) return null;
  const published = String(edition.datePublished ?? "");
  return {
    "@type": "Book",
    "@id": edition.id,
    url: isAbsoluteUrl(edition.url) ? edition.url : null,
    bookFormat: `https://schema.org/${edition.format}`,
    inLanguage: edition.language,
    isbn,
    bookEdition: edition.bookEdition,
    datePublished: /^\d{4}(-\d{2}-\d{2})?$/.test(published) && (published.length === 4 || toIsoDate(published)) ? published : null,
    identifier: (edition.identifiers ?? [])
      .filter((i) => ["OCLC_NUMBER", "LCCN", "JP_E-CODE"].includes(i.type) && i.value)
      .map((i) => ({ "@type": "PropertyValue", propertyID: i.type, value: String(i.value).replace(/^\D+/, "") })),
    sameAs: isAbsoluteUrl(edition.sameAs) ? edition.sameAs : null,
    potentialAction: actions
  };
}

// Builds one Book (work) entity for the dataFeedElement array of a Book actions feed.
function buildBookFeedEntity(source, now = new Date()) {
  if (!passesPageGates(source)) return null;

  // Required: work @id, name, author, canonical url and at least one valid edition.
  const authors = (source.authors ?? []).filter((a) => a.name);
  const seen = new Set([source.id, source.url]);
  const editions = (source.editions ?? []).map((e) => buildEdition(e, now)).filter((e) => {
    if (!e) return false;
    const keys = [e["@id"], e.url, ...e.potentialAction.map((a) => a.target.urlTemplate)].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;                 // @id, url and urlTemplate must be unique
    keys.forEach((k) => seen.add(k));
    return true;
  });
  if (!isAbsoluteUrl(source.id) || !source.name || authors.length === 0 || !isAbsoluteUrl(source.url) || editions.length === 0) return null;

  return compact({
    "@context": "https://schema.org",
    "@type": "Book",
    "@id": source.id,
    name: source.name,
    url: source.url,
    author: authors.map((a) => ({ "@type": a.type === "Organization" ? "Organization" : "Person", name: a.name, sameAs: isAbsoluteUrl(a.sameAs) ? a.sameAs : null })),
    sameAs: isAbsoluteUrl(source.sameAs) ? source.sameAs : null,
    workExample: editions
  });
}

// Node: const { buildBookFeedEntity } = require('./book-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildBookFeedEntity };
