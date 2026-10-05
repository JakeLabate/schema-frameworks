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

function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const isCurrencyCode = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);

// Rating or AggregateRating; null when ratingValue falls outside worstRating..bestRating.
function buildRating(input, type) {
  if (!input) return null;
  const best = toNumber(input.bestRating) ?? 5;
  const worst = toNumber(input.worstRating) ?? 1;
  const value = toNumber(input.ratingValue);
  if (value === null || worst >= best || value < worst || value > best) return null;
  const rating = { "@type": type, ratingValue: value, bestRating: best, worstRating: worst };
  if (type === "AggregateRating") {
    const ratingCount = toNumber(input.ratingCount);
    const reviewCount = toNumber(input.reviewCount);
    if (!(ratingCount > 0) && !(reviewCount > 0)) return null;
    rating.ratingCount = ratingCount > 0 ? ratingCount : null;
    rating.reviewCount = reviewCount > 0 ? reviewCount : null;
  }
  return rating;
}

// Review with a valid author name (under 100 characters) and an in-range rating.
function buildReview(input) {
  const authorName = String(input?.authorName ?? "").trim();
  const reviewRating = buildRating(input?.rating, "Rating");
  if (!authorName || authorName.length >= 100 || !reviewRating) return null;
  return {
    "@type": "Review",
    author: { "@type": input.authorType === "Organization" ? "Organization" : "Person", name: authorName },
    reviewRating,
    datePublished: toIsoDate(input.datePublished)
  };
}

const ISO_DURATION = /^P(?=\d|T\d)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/;

// Minutes (number) become PT#H#M; strings must already be ISO 8601 durations.
function toIsoDuration(value) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `PT${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}`;
  }
  return typeof value === "string" && ISO_DURATION.test(value.trim()) ? value.trim() : null;
}

const STEP_LABEL = /^(directions|instructions|watch the video|step\s*\d+)\s*[:.\-]?\s*/i;
const absoluteUrls = (list) => (list ?? []).filter(isAbsoluteUrl);

// A step video is a Clip of the recipe video: name, startOffset (seconds) and a url that jumps to it.
function buildClip(clip, name) {
  const start = toNumber(clip?.startOffset);
  const end = toNumber(clip?.endOffset);
  if (!name || !Number.isInteger(start) || start < 0 || !isAbsoluteUrl(clip.url)) return null;
  return { "@type": "Clip", name, startOffset: start, endOffset: end > start ? end : null, url: clip.url };
}

function buildStep(step) {
  const text = String(step?.text ?? "").replace(STEP_LABEL, "").trim();
  if (!text) return null;
  const rawName = String(step.name ?? "").trim();
  const name = rawName && !/^step\s*\d+$/i.test(rawName) ? rawName : null;
  return {
    "@type": "HowToStep",
    name,
    text,
    url: isAbsoluteUrl(step.url) ? step.url : null,
    image: isAbsoluteUrl(step.image) && /\.(jpe?g|png|gif)(\?.*)?$/i.test(step.image) ? step.image : null,
    video: buildClip(step.clip, name)
  };
}

// HowToSection needs a name and at least one valid HowToStep.
function buildInstruction(item) {
  if (!Array.isArray(item?.steps)) return buildStep(item);
  const steps = item.steps.map(buildStep).filter(Boolean);
  const name = String(item.sectionName ?? "").trim();
  return name && steps.length ? { "@type": "HowToSection", name, itemListElement: steps } : null;
}

function buildVideo(video) {
  const uploadDate = toIsoDateTime(video?.uploadDate);
  if (!video?.name || !isAbsoluteUrl(video.thumbnailUrl) || !uploadDate || !uploadDate.includes("T")) return null;
  return {
    "@type": "VideoObject",
    name: video.name,
    description: video.description,
    thumbnailUrl: video.thumbnailUrl,
    uploadDate,
    duration: toIsoDuration(video.duration),
    contentUrl: isAbsoluteUrl(video.contentUrl) ? video.contentUrl : null,
    embedUrl: isAbsoluteUrl(video.embedUrl) ? video.embedUrl : null
  };
}

function buildRecipeSchema(source) {
  if (!passesPageGates(source)) return null;

  // Required: name of the dish and at least one crawlable image of it.
  const name = String(source.name ?? "").trim();
  const images = absoluteUrls(source.images);
  if (!name || images.length === 0) return null;

  // prepTime and cookTime only as a pair; totalTime stands alone.
  const prepTime = toIsoDuration(source.prepTime);
  const cookTime = toIsoDuration(source.cookTime);
  const pairOk = Boolean(prepTime && cookTime);

  // Per-serving calories require recipeYield with the number of servings.
  const servings = toNumber(source.servings);
  const recipeYield = Number.isInteger(servings) && servings > 0
    ? [String(servings), ...(source.extraYields ?? [])]
    : null;

  const taxonomy = [source.category, source.cuisine].filter(Boolean).map((v) => v.toLowerCase());
  const keywords = (source.keywords ?? []).filter((k) => !taxonomy.includes(k.toLowerCase()));

  return compact({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name,
    image: images,
    description: source.description,
    author: (source.authors ?? []).map((a) => ({ "@type": a.type === "Organization" ? "Organization" : "Person", name: a.name, url: isAbsoluteUrl(a.url) ? a.url : null })),
    datePublished: toIsoDate(source.datePublished),
    prepTime: pairOk ? prepTime : null,
    cookTime: pairOk ? cookTime : null,
    totalTime: toIsoDuration(source.totalTime),
    recipeYield,
    recipeCategory: source.category,
    recipeCuisine: source.cuisine,
    keywords: keywords.join(", "),
    nutrition: recipeYield && source.caloriesPerServing
      ? { "@type": "NutritionInformation", calories: `${source.caloriesPerServing} calories` }
      : null,
    recipeIngredient: (source.ingredients ?? []).map((i) => String(i).trim()),
    recipeInstructions: (source.instructions ?? []).map(buildInstruction).filter(Boolean),
    aggregateRating: buildRating(source.rating, "AggregateRating"),
    video: buildVideo(source.video)
  });
}

// Node: const { buildRecipeSchema } = require('./recipe-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildRecipeSchema };
