// Collection page schema: a page that lists several items, each with its own
// page. A CollectionPage with its BreadcrumbList and, when the list is one
// Google shows as a carousel, an ItemList of the item pages in page order.
//
// Google only shows a carousel for recipes, courses, movies and restaurants,
// and only when the list holds every item on the page, each with its own
// address on this site. A list that falls short is left out whole: half a
// list is worse than none, because it no longer matches the page.

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

// The item types Google shows as a carousel.
const CAROUSEL_TYPES = ['recipe', 'course', 'movie', 'restaurant'];

// Every listed item, in page order, or nothing.
function carouselItems(list, pageUrl) {
  const items = list.items || [];
  if (!CAROUSEL_TYPES.includes(list.itemType)) return undefined;
  // A course list needs three courses. Any other list needs two.
  if (items.length < (list.itemType === 'course' ? 3 : 2)) return undefined;
  const host = new URL(pageUrl).hostname;
  const urls = items.map((i) => i.url);
  if (!urls.every((u) => isUrl(u) && new URL(u).hostname === host)) return undefined;
  if (new Set(urls).size !== urls.length) return undefined;
  return urls.map((url, i) => ({ '@type': 'ListItem', position: i + 1, url }));
}

function buildCollectionPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const list = source.collection || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !list.name) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const listId = `${pageUrl}#list`;

  const elements = carouselItems(list, pageUrl);
  const itemList = elements
    ? { '@type': 'ItemList', '@id': listId, name: clean(list.name), itemListElement: elements }
    : undefined;

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'CollectionPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(list.name),
    description: clean(list.description),
    isPartOf: { '@id': `${root}/#website` },
    publisher: { '@id': `${root}/#organization` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: itemList ? { '@id': listId } : undefined,
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, itemList].filter(Boolean) };
}

// Node: const { buildCollectionPageSchema } = require('./collection-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildCollectionPageSchema };
