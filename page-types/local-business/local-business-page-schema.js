// Local business location page schema: one physical location of a brand.
// The most specific LocalBusiness subtype with address, geo and hours,
// linked to the parent Organization from the homepage with
// parentOrganization, plus the page's WebPage and BreadcrumbList.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COUNTRY = /^[A-Z]{2}$/;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const clean = (v) => (typeof v === 'string' ? v.trim() : v);
const isUrl = (v) => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);
const compact = (obj) => {
  if (Array.isArray(obj)) {
    const out = obj.map(compact).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = compact(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return obj === null || obj === '' ? undefined : obj;
};

function breadcrumb(trail, id) {
  const items = (trail || []).filter((c) => c.name && isUrl(c.url));
  if (items.length < 2) return undefined;
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: clean(c.name), item: c.url })),
  };
}

// Opening hours: days with the same open and close times are grouped into
// one specification and closed days are left out. A night open past midnight
// is split into an evening span and an early-hours span on the next day,
// rather than a close time that comes before the open time.
function openingHours(hours) {
  const spans = DAYS.map(() => []);
  DAYS.forEach((day, i) => {
    const h = (hours || {})[day];
    if (!h || !TIME.test(h.opens || '') || !TIME.test(h.closes || '') || h.opens === h.closes) return;
    if (h.closes > h.opens) spans[i].push([h.opens, h.closes]);
    else {
      spans[i].push([h.opens, '23:59']);
      spans[(i + 1) % 7].push(['00:00', h.closes]);
    }
  });
  const groups = new Map();
  DAYS.forEach((day, i) => {
    for (const [opens, closes] of spans[i]) {
      const key = `${opens}-${closes}`;
      if (!groups.has(key)) groups.set(key, { opens, closes, days: [] });
      groups.get(key).days.push(day);
    }
  });
  return [...groups.values()].map((g) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: g.days, opens: g.opens, closes: g.closes }));
}

function buildLocalBusinessPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const loc = source.location || {};
  const addr = loc.address || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !loc.name) return null;
  // Google requires a full street address for a local business.
  if (!addr.street || !addr.city || !COUNTRY.test(addr.country || '')) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const businessId = `${pageUrl}#location`;

  const geo = Number.isFinite(loc.lat) && Number.isFinite(loc.lng) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180
    ? { '@type': 'GeoCoordinates', latitude: Number(loc.lat.toFixed(5)), longitude: Number(loc.lng.toFixed(5)) }
    : undefined;

  // No aggregateRating: Google treats ratings a business shows about itself
  // on its own site as self-serving and never gives them review stars.

  const business = compact({
    '@type': loc.type || 'LocalBusiness',
    '@id': businessId,
    name: clean(loc.name),
    url: pageUrl,
    image: (loc.images || []).filter(isUrl),
    telephone: clean(loc.telephone),
    priceRange: clean(loc.priceRange),
    address: {
      '@type': 'PostalAddress',
      streetAddress: clean(addr.street),
      addressLocality: clean(addr.city),
      addressRegion: clean(addr.region),
      postalCode: clean(addr.postalCode),
      addressCountry: addr.country,
    },
    geo,
    openingHoursSpecification: openingHours(loc.hours),
    servesCuisine: clean(loc.servesCuisine),
    menu: isUrl(loc.menu) ? loc.menu : undefined,
    acceptsReservations: typeof loc.acceptsReservations === 'boolean' ? loc.acceptsReservations : undefined,
    parentOrganization: { '@id': `${root}/#organization` },
  });

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(loc.name),
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    about: { '@id': businessId },
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, business].filter(Boolean) };
}

// Node: const { buildLocalBusinessPageSchema } = require('./local-business-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildLocalBusinessPageSchema };
