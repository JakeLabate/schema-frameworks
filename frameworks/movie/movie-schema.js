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

// Movie helpers
const IMAGE_FILE = /\.(jpe?g|png|gif)$/i;

// 6:9 (2:3) poster ratio; Google can crop images that are close to it.
function isPosterRatio(img) {
  if (!img || !img.width || !img.height) return false;
  return Math.abs(img.width / img.height - 6 / 9) <= 0.05;
}

function buildPerson(name) {
  return name ? { "@type": "Person", name } : null;
}

function buildRating(r, isAggregate) {
  if (!r) return null;
  const best = r.bestRating ?? 5;
  const worst = r.worstRating ?? 1;
  if (typeof r.ratingValue !== "number" || r.ratingValue < worst || r.ratingValue > best) return null;
  if (isAggregate && !(Number.isInteger(r.ratingCount) && r.ratingCount > 0)) return null;
  return {
    "@type": isAggregate ? "AggregateRating" : "Rating",
    ratingValue: r.ratingValue,
    bestRating: best,
    worstRating: worst,
    ratingCount: isAggregate ? r.ratingCount : null
  };
}

function buildReview(review) {
  const rating = buildRating(review && review.rating, false);
  if (!rating || !review.authorName) return null; // review needs author and rating
  return {
    "@type": "Review",
    reviewRating: rating,
    author: buildPerson(review.authorName),
    datePublished: toIsoDate(review.datePublished)
  };
}

// One Movie node. Required: name, image (crawlable .jpg/.png/.gif, about 6:9).
// Summary approach detail page: compact({ "@context": "https://schema.org", ...buildMovieSchema(movie) })
function buildMovieSchema(movie) {
  const images = (movie.images || []).filter(
    (img) => isAbsoluteUrl(img.url) && IMAGE_FILE.test(new URL(img.url).pathname) && isPosterRatio(img)
  );
  if (!movie.name || !images.length) return null;
  return {
    "@type": "Movie",
    url: isAbsoluteUrl(movie.url) ? movie.url : null,
    name: movie.name,
    image: images.map((img) => img.url),
    dateCreated: toIsoDate(movie.releaseDate),
    director: (movie.directors || []).map(buildPerson),
    aggregateRating: buildRating(movie.aggregateRating, true),
    review: (movie.reviews || []).map(buildReview)
  };
}

// Summary page (ListItem.url to detail pages) or all-in-one page (full Movie in each ListItem).
function chooseCarouselApproach(source) {
  return source.movies.every((m) => m.renderedOnThisPage) ? "all-in-one" : "summary";
}

function buildMovieCarouselSchema(source) {
  const page = source.page;
  if (!passesPageGates(page) || !Array.isArray(source.movies) || !source.movies.length) return null;

  const approach = chooseCarouselApproach(source);
  const host = new URL(page.url).hostname;
  const entries = [];
  for (const movie of source.movies) {
    // Every item must be a Movie on the same domain as the list page.
    if (!isAbsoluteUrl(movie.url) || new URL(movie.url).hostname !== host) continue;
    if (approach === "summary") {
      entries.push({ url: movie.url });
      continue;
    }
    // All-in-one: each item needs its own URL fragment on this page.
    if (!movie.url.startsWith(page.url + "#")) continue;
    const node = buildMovieSchema(movie);
    if (node) entries.push({ item: node });
  }
  if (!entries.length) return null;

  return compact({
    "@context": "https://schema.org",
    "@type": "ItemList",
    // Positions start at 1 and increase by 1 after filtering.
    itemListElement: entries.map((entry, i) => ({ "@type": "ListItem", position: i + 1, ...entry }))
  }) ?? null;
}

// Node: const { buildMovieCarouselSchema } = require('./movie-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildMovieCarouselSchema };
