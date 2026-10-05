// Article page schema: one article with its author, publisher and page.
// Article (or NewsArticle / BlogPosting), a Person for the author with an
// @id that the author's ProfilePage also uses, the page's WebPage and
// BreadcrumbList, optional VideoObject and paywall markup, and an @id link
// to the Organization defined on the homepage as publisher.

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DURATION = /^PT(\d+H)?(\d+M)?(\d+S)?$/;

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

const TYPES = { news: 'NewsArticle', blog: 'BlogPosting', article: 'Article' };

function breadcrumb(trail, id) {
  const items = (trail || []).filter((c) => c.name && isUrl(c.url));
  if (items.length < 2) return undefined;
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: clean(c.name), item: c.url })),
  };
}

// The author is a Person with a stable @id on their profile page, so every
// article and the ProfilePage itself describe the same entity. A byline that
// is really a brand or a desk ("Staff") is not passed off as a person.
function author(a, root) {
  if (!a || !a.name || /^(staff|admin|editor|team)$/i.test(a.name.trim())) return undefined;
  if (!isUrl(a.profileUrl)) return { '@type': 'Person', name: clean(a.name) };
  return compact({
    '@type': 'Person',
    '@id': `${a.profileUrl}#person`,
    name: clean(a.name),
    url: a.profileUrl,
    jobTitle: clean(a.jobTitle),
    sameAs: (a.sameAs || []).filter(isUrl),
    worksFor: { '@id': `${root}/#organization` },
  });
}

function video(v) {
  if (!v || !v.name || !isUrl(v.thumbnailUrl) || !ISO_DATE_TIME.test(v.uploadDate || '')) return undefined;
  if (!isUrl(v.contentUrl) && !isUrl(v.embedUrl)) return undefined;
  return compact({
    '@type': 'VideoObject',
    name: clean(v.name),
    description: clean(v.description),
    thumbnailUrl: [v.thumbnailUrl],
    uploadDate: v.uploadDate,
    duration: ISO_DURATION.test(v.duration || '') ? v.duration : undefined,
    contentUrl: isUrl(v.contentUrl) ? v.contentUrl : undefined,
    embedUrl: isUrl(v.embedUrl) ? v.embedUrl : undefined,
  });
}

function buildArticlePageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const a = source.article || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !a.headline) return null;
  if (!ISO_DATE_TIME.test(a.datePublished || '')) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const articleId = `${pageUrl}#article`;

  // dateModified is only stated when it is a real, later edit.
  const modified = ISO_DATE_TIME.test(a.dateModified || '') && Date.parse(a.dateModified) > Date.parse(a.datePublished)
    ? a.dateModified
    : undefined;

  // Paywalled content: mark the gated section so Google does not read the
  // gap between what crawlers and visitors see as cloaking.
  const paywall = a.paywalledSelector
    ? { isAccessibleForFree: false, hasPart: { '@type': 'WebPageElement', isAccessibleForFree: false, cssSelector: a.paywalledSelector } }
    : {};

  const authors = (a.authors || []).map((x) => author(x, root)).filter(Boolean);
  const article = compact({
    '@type': TYPES[a.kind] || 'Article',
    '@id': articleId,
    headline: clean(a.headline).slice(0, 110),
    description: clean(a.description),
    image: (a.images || []).filter(isUrl),
    datePublished: a.datePublished,
    dateModified: modified,
    author: authors.length ? authors : undefined,
    publisher: { '@id': `${root}/#organization` },
    mainEntityOfPage: { '@id': `${pageUrl}#webpage` },
    video: video(a.video),
    ...paywall,
  });

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(a.headline),
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: { '@id': articleId },
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, article].filter(Boolean) };
}

// Node: const { buildArticlePageSchema } = require('./article-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildArticlePageSchema };
