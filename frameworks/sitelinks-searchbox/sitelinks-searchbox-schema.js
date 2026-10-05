function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isRootUrl(value) {
  // site name markup works at domain or subdomain level only, never a subdirectory
  if (!isAbsoluteUrl(value)) return false;
  const url = new URL(value);
  return url.pathname === "/" && !url.search && !url.hash;
}

function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = compact(item);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

const LEGAL_SUFFIX = /,?\s+(inc|llc|ltd|gmbh|corp)\.?$/i;

function buildSearchAction(template) {
  // optional and earns no Google feature since Nov 2024; keep only if real site search exists
  if (!isAbsoluteUrl(template) || !template.includes("{search_term_string}")) return null;
  return {
    "@type": "SearchAction",
    "target": { "@type": "EntryPoint", "urlTemplate": template },
    "query-input": "required name=search_term_string"
  };
}

function buildWebSiteSchema(source) {
  // home page gates: indexable, self-canonical, root of the domain or subdomain
  if (source.indexable === false) return null;
  if (!isRootUrl(source.url)) return null;
  if (source.canonicalUrl && source.canonicalUrl !== source.url) return null;

  // site name: required, concise, no legal suffix, same as og:site_name and the title
  const name = (source.siteName || "").trim();
  if (!name || LEGAL_SUFFIX.test(name)) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": name,
    "alternateName": (source.alternateNames || []).filter((n) => n && n !== name), // order of preference
    "url": source.url,
    "potentialAction": source.hasSiteSearch ? buildSearchAction(source.searchUrlTemplate) : null
  };

  return compact(schema);
}

// Node: const { buildWebSiteSchema } = require('./sitelinks-searchbox-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildWebSiteSchema };
