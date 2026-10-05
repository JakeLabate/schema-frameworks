// Recipe page schema: one recipe from the store's journal.
// Recipe with ingredients, timed steps, nutrition and a video whose key
// moments line up with the steps, the author as the same Person @id used on
// articles, the page's WebPage and BreadcrumbList, and the Organization from
// the homepage as publisher.

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

// Minutes to an ISO 8601 duration: 75 becomes PT1H15M.
const duration = (min) => {
  if (!Number.isInteger(min) || min <= 0) return undefined;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`;
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

// Steps become HowToStep entries with their own anchor on the page. A step
// with a video timestamp also becomes a Clip, so the video's key moments
// match the written steps.
function steps(list, pageUrl) {
  return (list || [])
    .filter((s) => s.text && s.text.trim().length > 10)
    .map((s, i) => ({
      '@type': 'HowToStep',
      name: clean(s.name) || `Step ${i + 1}`,
      text: clean(s.text),
      url: `${pageUrl}#step-${i + 1}`,
      image: isUrl(s.image) ? s.image : undefined,
      clip: Number.isInteger(s.videoStart) ? { start: s.videoStart, name: clean(s.name) || `Step ${i + 1}`, url: `${pageUrl}#step-${i + 1}` } : undefined,
    }));
}

function video(v, howToSteps, pageUrl) {
  if (!v || !v.name || !isUrl(v.thumbnailUrl) || !ISO_DATE_TIME.test(v.uploadDate || '')) return undefined;
  if (!isUrl(v.contentUrl) && !isUrl(v.embedUrl)) return undefined;
  const marks = howToSteps.filter((s) => s.clip).sort((a, b) => a.clip.start - b.clip.start);
  const clips = marks.map((s, i) => ({
    '@type': 'Clip',
    name: s.clip.name,
    startOffset: s.clip.start,
    endOffset: i + 1 < marks.length ? marks[i + 1].clip.start : v.durationSeconds,
    // Key moment URLs point at this page, where the video plays, with the
    // start time as a query parameter.
    url: `${pageUrl}?t=${s.clip.start}`,
  })).filter((c) => Number.isInteger(c.endOffset) && c.endOffset > c.startOffset);
  return compact({
    '@type': 'VideoObject',
    name: clean(v.name),
    description: clean(v.description),
    thumbnailUrl: [v.thumbnailUrl],
    uploadDate: v.uploadDate,
    duration: Number.isInteger(v.durationSeconds) ? `PT${Math.floor(v.durationSeconds / 60)}M${v.durationSeconds % 60}S` : undefined,
    contentUrl: isUrl(v.contentUrl) ? v.contentUrl : undefined,
    embedUrl: isUrl(v.embedUrl) ? v.embedUrl : undefined,
    hasPart: clips.length >= 2 ? clips : undefined,
  });
}

function buildRecipePageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const r = source.recipe || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !r.name) return null;
  const images = (r.images || []).filter(isUrl);
  if (!images.length) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const recipeId = `${pageUrl}#recipe`;
  const howTo = steps(r.steps, pageUrl);

  // Total time is stated only when it adds up: prep plus cook, or a total
  // given on its own when there is no split.
  const prep = duration(r.prepMinutes);
  const cook = duration(r.cookMinutes);
  const total = prep && cook ? duration(r.prepMinutes + r.cookMinutes) : duration(r.totalMinutes);

  // Calories need a yield to mean anything: they are per serving.
  const nutrition = Number.isFinite(r.caloriesPerServing) && r.servings > 0
    ? { '@type': 'NutritionInformation', calories: `${Math.round(r.caloriesPerServing)} calories` }
    : undefined;

  const rating = r.rating && r.rating.count > 0 && r.rating.value >= 1 && r.rating.value <= 5
    ? { '@type': 'AggregateRating', ratingValue: r.rating.value, ratingCount: r.rating.count }
    : undefined;

  const recipe = compact({
    '@type': 'Recipe',
    '@id': recipeId,
    name: clean(r.name),
    description: clean(r.description),
    image: images,
    author: isUrl(r.authorProfileUrl) ? { '@id': `${r.authorProfileUrl}#person` } : undefined,
    publisher: { '@id': `${root}/#organization` },
    datePublished: /^\d{4}-\d{2}-\d{2}/.test(r.datePublished || '') ? r.datePublished.slice(0, 10) : undefined,
    prepTime: prep,
    cookTime: cook,
    totalTime: total,
    recipeYield: r.servings > 0 ? [String(r.servings), `${r.servings} servings`] : undefined,
    recipeCategory: clean(r.category),
    recipeCuisine: clean(r.cuisine),
    keywords: (r.keywords || []).filter((k) => k && k !== r.category && k !== r.cuisine).join(', ') || undefined,
    recipeIngredient: (r.ingredients || []).map(clean).filter(Boolean),
    recipeInstructions: howTo.map(({ clip, ...s }) => compact(s)),
    nutrition,
    aggregateRating: rating,
    video: video(r.video, howTo, pageUrl),
    mainEntityOfPage: { '@id': `${pageUrl}#webpage` },
  });

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(r.name),
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: { '@id': recipeId },
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, recipe].filter(Boolean) };
}

// Node: const { buildRecipePageSchema } = require('./recipe-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildRecipePageSchema };
