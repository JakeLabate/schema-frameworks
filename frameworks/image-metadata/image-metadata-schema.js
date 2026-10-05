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

// Image metadata helpers
function buildCreator(creator) {
  if (!creator || !creator.name) return null; // creator object needs name
  return {
    "@type": creator.type === "Organization" ? "Organization" : "Person",
    name: creator.name,
    url: isAbsoluteUrl(creator.url) ? creator.url : null
  };
}

// One ImageObject per image; contentUrl tells Google which image the metadata applies to.
function buildImageObjectSchema(source) {
  const page = source.page;
  const image = source.image || {};
  if (!passesPageGates(page) || !image.visibleOnPage) return null;

  // Required: contentUrl (absolute).
  if (!isAbsoluteUrl(image.contentUrl)) return null;

  const license = isAbsoluteUrl(image.licenseUrl) ? image.licenseUrl : null;
  const creators = (image.creators || []).map(buildCreator).filter(Boolean);
  const schema = {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    contentUrl: image.contentUrl,
    license, // needed for the Licensable badge
    acquireLicensePage: isAbsoluteUrl(image.acquireLicenseUrl) ? image.acquireLicenseUrl : null,
    creditText: image.creditText,
    copyrightNotice: image.copyrightNotice,
    creator: creators.length > 1 ? creators : creators[0] ?? null
  };

  // Required either-or: at least one of creator, creditText, copyrightNotice, license.
  if (!schema.creator && !schema.creditText && !schema.copyrightNotice && !schema.license) return null;

  return compact(schema) ?? null;
}

// Node: const { buildImageObjectSchema } = require('./image-metadata-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildImageObjectSchema };
