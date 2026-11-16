// App page schema: the page for one app. A MobileApplication, WebApplication
// or SoftwareApplication with its price, rating and reviews, published by
// the Organization from the homepage, plus the page's WebPage and
// BreadcrumbList.
//
// Google needs a name, a price (0 for a free app) and a rating or a review.
// Without all three there is no rich result, so the builder outputs nothing.

const CURRENCY = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// A rating only counts with a score inside its scale and a count above zero.
function aggregateRating(r) {
  if (!r) return undefined;
  const best = num(r.best) ?? 5;
  const worst = num(r.worst) ?? 1;
  const value = num(r.value);
  if (value === null || worst >= best || value < worst || value > best) return undefined;
  if (!(num(r.count) > 0)) return undefined;
  return { '@type': 'AggregateRating', ratingValue: value, bestRating: best, worstRating: worst, ratingCount: r.count };
}

// A review needs a named author and a score inside its scale.
function review(r) {
  const author = clean(r.author);
  const best = num(r.best) ?? 5;
  const worst = num(r.worst) ?? 1;
  const value = num(r.rating);
  if (!author || author.length >= 100) return undefined;
  if (value === null || worst >= best || value < worst || value > best) return undefined;
  return compact({
    '@type': 'Review',
    author: { '@type': 'Person', name: author },
    reviewRating: { '@type': 'Rating', ratingValue: value, bestRating: best, worstRating: worst },
    datePublished: ISO_DATE.test(r.date || '') ? r.date : undefined,
    reviewBody: clean(r.text),
  });
}

const APP_TYPES = { mobile: 'MobileApplication', web: 'WebApplication' };
const APP_CATEGORIES = [
  'GameApplication', 'SocialNetworkingApplication', 'TravelApplication', 'ShoppingApplication',
  'SportsApplication', 'LifestyleApplication', 'BusinessApplication', 'DesignApplication',
  'DeveloperApplication', 'DriverApplication', 'EducationalApplication', 'HealthApplication',
  'FinanceApplication', 'SecurityApplication', 'BrowserApplication', 'CommunicationApplication',
  'DesktopEnhancementApplication', 'EntertainmentApplication', 'MultimediaApplication',
  'HomeApplication', 'UtilitiesApplication', 'ReferenceApplication',
];

function buildAppPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const app = source.app || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !app.name) return null;

  // A free app states a price of 0. A paid one needs its currency.
  const price = num(app.price);
  if (price === null || price < 0) return null;
  const currency = CURRENCY.test(app.currency || '') ? app.currency : undefined;
  if (price > 0 && !currency) return null;

  const rating = aggregateRating(app.rating);
  const reviews = (app.reviews || []).map(review).filter(Boolean);
  if (!rating && !reviews.length) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const appId = `${pageUrl}#app`;

  // A game is typed as a VideoGame and an app: VideoGame alone is not eligible.
  const base = APP_TYPES[app.platform] || 'SoftwareApplication';

  const software = compact({
    '@type': app.isGame ? ['VideoGame', base] : base,
    '@id': appId,
    name: clean(app.name),
    description: clean(app.description),
    url: pageUrl,
    image: (app.images || []).filter(isUrl),
    operatingSystem: clean(app.operatingSystem),
    applicationCategory: APP_CATEGORIES.includes(app.category) ? app.category : undefined,
    softwareVersion: clean(app.version),
    downloadUrl: (app.storeLinks || []).filter(isUrl),
    offers: { '@type': 'Offer', price, priceCurrency: currency },
    aggregateRating: rating,
    review: reviews,
    publisher: { '@id': `${root}/#organization` },
  });

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(app.name),
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: { '@id': appId },
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, software].filter(Boolean) };
}

// Node: const { buildAppPageSchema } = require('./app-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildAppPageSchema };
