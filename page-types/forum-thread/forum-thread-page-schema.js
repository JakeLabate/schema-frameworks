// Forum thread page schema: one thread from the store's community forum.
// A question that collects answers becomes a QAPage; any other thread (a
// trip report, a discussion) becomes a DiscussionForumPosting. Posters are
// the same Person @id as their forum profile page, and a thread about a
// product points at that product's @id.

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;

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

function person(u) {
  if (!u || !u.name) return undefined;
  return compact({
    '@type': 'Person',
    '@id': isUrl(u.profileUrl) ? `${u.profileUrl}#person` : undefined,
    name: clean(u.name),
    url: isUrl(u.profileUrl) ? u.profileUrl : undefined,
  });
}

// A post is only kept when it has visible text, an author and a timestamp
// with a timezone; deleted and moderated posts are skipped.
const usable = (p) => p && !p.removed && p.text && p.text.trim() && p.author && ISO_DATE_TIME.test(p.date || '');

function buildForumThreadPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const t = source.thread || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !t.title || !usable(t.opening)) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const replies = (t.replies || []).filter(usable);
  const about = isUrl(t.aboutUrl) ? { '@id': t.aboutUrl } : undefined;

  // Q&A only fits a thread that asks one question and collects answers. A
  // site-written FAQ or a thread with no replies is not a QAPage.
  const isQuestion = t.kind === 'question' && replies.length > 0;

  let main;
  if (isQuestion) {
    const answer = (r) => compact({
      '@type': 'Answer',
      text: clean(r.text),
      author: person(r.author),
      datePublished: r.date,
      upvoteCount: Number.isInteger(r.upvotes) ? r.upvotes : undefined,
      url: `${pageUrl}#post-${r.id}`,
    });
    const accepted = replies.find((r) => r.accepted);
    main = compact({
      '@type': 'QAPage',
      '@id': `${pageUrl}#webpage`,
      url: pageUrl,
      name: clean(page.title) || clean(t.title),
      isPartOf: { '@id': `${root}/#website` },
      mainEntity: {
        '@type': 'Question',
        name: clean(t.title),
        text: clean(t.opening.text),
        author: person(t.opening.author),
        datePublished: t.opening.date,
        answerCount: replies.length,
        upvoteCount: Number.isInteger(t.opening.upvotes) ? t.opening.upvotes : undefined,
        about,
        acceptedAnswer: accepted ? answer(accepted) : undefined,
        suggestedAnswer: replies.filter((r) => r !== accepted).map(answer),
      },
    });
  } else {
    main = compact({
      '@type': 'DiscussionForumPosting',
      '@id': `${pageUrl}#post-${t.opening.id}`,
      headline: clean(t.title),
      text: clean(t.opening.text),
      author: person(t.opening.author),
      datePublished: t.opening.date,
      url: pageUrl,
      about,
      mainEntityOfPage: { '@id': `${pageUrl}#webpage` },
      commentCount: replies.length,
      comment: replies.map((r) => compact({
        '@type': 'Comment',
        text: clean(r.text),
        author: person(r.author),
        datePublished: r.date,
        url: `${pageUrl}#post-${r.id}`,
      })),
    });
  }

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  if (isQuestion) {
    if (crumbs) main.breadcrumb = { '@id': crumbs['@id'] };
    return { '@context': 'https://schema.org', '@graph': [main, crumbs].filter(Boolean) };
  }
  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(t.title),
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: { '@id': main['@id'] },
  });
  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, main].filter(Boolean) };
}

// Node: const { buildForumThreadPageSchema } = require('./forum-thread-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildForumThreadPageSchema };
