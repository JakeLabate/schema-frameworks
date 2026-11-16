// Course catalog page schema: one page that describes several courses, each
// under its own heading. A CollectionPage with its BreadcrumbList and an
// ItemList that holds a Course per course on the page, taught by the
// Organization from the homepage.
//
// Google shows a course list for three or more courses. Each needs a real
// title and a description, and its url is this page plus the anchor of the
// course's heading. A catalog that falls short has no list at all: the list
// must hold every course the page shows.

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

// A real course title: no prices, discounts or sales phrases.
const PROMO = /[$€£]\s?\d|\d+\s?%\s?off|\b(sale|discount|deal|cheap|free|best|top|only|make money)\b/i;
const ANCHOR = /^[A-Za-z][\w-]*$/;

// Google shows about 60 characters of a description, so a short summary is
// used when the full text is longer and a summary exists.
function describe(course) {
  const full = clean(course.description) || '';
  const short = clean(course.summary) || '';
  if (full.length > 60 && short && short.length <= 60) return short;
  return full || short || undefined;
}

// Every course on the page, in page order, or nothing.
function courseItems(courses, pageUrl, providerId) {
  if (courses.length < 3) return undefined;
  const anchors = courses.map((c) => c.anchor);
  if (!anchors.every((a) => ANCHOR.test(a || ''))) return undefined;
  if (new Set(anchors).size !== anchors.length) return undefined;
  const items = [];
  for (const [i, c] of courses.entries()) {
    const name = clean(c.name);
    const description = describe(c);
    if (!name || PROMO.test(name) || !description) return undefined;
    const url = `${pageUrl}#${c.anchor}`;
    items.push({
      '@type': 'ListItem',
      position: i + 1,
      item: { '@type': 'Course', '@id': url, name, description, url, provider: { '@id': providerId } },
    });
  }
  return items;
}

function buildCourseCatalogPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const catalog = source.catalog || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !catalog.name) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const listId = `${pageUrl}#courses`;

  const elements = courseItems(catalog.courses || [], pageUrl, `${root}/#organization`);
  const itemList = elements
    ? { '@type': 'ItemList', '@id': listId, name: clean(catalog.name), itemListElement: elements }
    : undefined;

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'CollectionPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(catalog.name),
    description: clean(catalog.description),
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: itemList ? { '@id': listId } : undefined,
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, itemList].filter(Boolean) };
}

// Node: const { buildCourseCatalogPageSchema } = require('./course-catalog-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildCourseCatalogPageSchema };
