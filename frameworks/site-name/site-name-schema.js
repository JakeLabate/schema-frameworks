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


// Legal suffixes belong in Organization legalName, not in the site name ("Google", not "Google, Inc").
const LEGAL_SUFFIX = /(?:,\s*|\s+)(?:inc|llc|ltd|limited|corp|corporation|gmbh|plc)\.?$/i;

function cleanName(value) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text && !LEGAL_SUFFIX.test(text) ? text : null;
}

// The canonical home page of a domain or subdomain: root path, no query or fragment.
function toHomeUrl(value) {
  if (!isAbsoluteUrl(value)) return null;
  const url = new URL(value);
  return url.pathname === "/" && !url.search && !url.hash ? `${url.origin}/` : null;
}

function buildWebSiteSchema(source) {
  // (a) Page gates: indexable, self-canonical, and the home page at the domain or subdomain root.
  //     Subdirectory home pages such as https://example.com/news are not supported.
  if (!passesPageGates(source)) return null;
  const homeUrl = toHomeUrl(source.url);
  if (!homeUrl) return null;

  // (b) Required: name and url. The name must be concise and match og:site_name,
  //     the title and the Organization name; a mismatch is fixed in the source, not shipped.
  const name = cleanName(source.siteName);
  if (!name) return null;
  const otherNames = [source.ogSiteName, source.organizationName].filter(Boolean);
  if (otherNames.some((other) => other.trim() !== name)) return null;
  if (source.title && !source.title.includes(name)) return null;

  // alternateName: in order of preference, deduplicated, never the name itself.
  const alternateName = [...new Set((source.alternateNames || []).map(cleanName))]
    .filter((alt) => alt && alt.toLowerCase() !== name.toLowerCase());

  // (c) Required plus recommended properties; (d) one WebSite node per site: if the page already
  //     has WebSite markup, merge into it. No SearchAction: the sitelinks search box was retired in Nov 2024.
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${homeUrl}#website`,
    name,
    alternateName,
    url: homeUrl,
    publisher: isAbsoluteUrl(source.organizationId) ? { "@id": source.organizationId } : null
  };

  // (e) Strip empty values.
  return compact(schema);
}

// Node: const { buildWebSiteSchema } = require('./site-name-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildWebSiteSchema };
