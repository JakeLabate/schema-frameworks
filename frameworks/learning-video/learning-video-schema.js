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

// Seconds to ISO 8601 duration, for example 754 -> "PT12M34S".
function toIsoDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return "PT" + (h ? h + "H" : "") + (m ? m + "M" : "") + (s ? s + "S" : "");
}

// Key moments: unique integer startOffset, endOffset after start, url = page URL + ?t=.
function buildClips(chapters, pageUrl, durationSeconds) {
  const seen = new Set();
  return (chapters || [])
    .filter((c) => c.name && Number.isInteger(c.start) && c.start >= 0 && !seen.has(c.start) && seen.add(c.start))
    .filter((c) => !Number.isInteger(durationSeconds) || c.start < durationSeconds)
    .map((c) => ({
      "@type": "Clip",
      name: c.name,
      startOffset: c.start,
      endOffset: Number.isInteger(c.end) && c.end > c.start ? c.end : null,
      url: pageUrl + "?t=" + c.start
    }));
}

// LearningResource is added only when the page states learning metadata.
// It earns no Google rich result (retired Sep 9, 2025); VideoObject still does.
function chooseVideoType(source) {
  const learning = source.learning || {};
  return learning.educationalLevel || learning.teaches ? ["VideoObject", "LearningResource"] : "VideoObject";
}

function buildLearningVideoSchema(source) {
  if (!passesPageGates(source.page)) return null;

  // Google Video required: name, thumbnailUrl, uploadDate (DateTime with offset).
  const thumbnails = (source.thumbnailUrls || []).filter(isAbsoluteUrl);
  const uploadDate = toIsoDateTime(source.uploadDate);
  if (!source.name || thumbnails.length === 0 || !uploadDate) return null;

  // contentUrl and embedUrl must be absolute and must not be the watch page itself.
  const mediaUrl = (url) => (isAbsoluteUrl(url) && url !== source.page.url ? url : null);
  const expires = toIsoDateTime(source.expires);
  const views = Number.isInteger(source.viewCount) && source.viewCount >= 0 ? source.viewCount : null;
  const learning = source.learning || {};
  const type = chooseVideoType(source);

  const schema = {
    "@context": "https://schema.org",
    "@type": type,
    name: source.name,
    description: source.description,
    thumbnailUrl: thumbnails,
    uploadDate,
    duration: toIsoDuration(source.durationSeconds),
    contentUrl: mediaUrl(source.contentUrl),
    embedUrl: mediaUrl(source.embedUrl),
    expires: expires && Date.parse(expires) > Date.parse(uploadDate) ? expires : null,
    creator: source.creator && source.creator.name ? {
      "@type": source.creator.type === "Organization" ? "Organization" : "Person",
      name: source.creator.name,
      url: isAbsoluteUrl(source.creator.url) ? source.creator.url : null
    } : null,
    hasPart: buildClips(source.chapters, source.page.url, source.durationSeconds),
    interactionStatistic: views === null ? null : {
      "@type": "InteractionCounter",
      interactionType: { "@type": "WatchAction" },
      userInteractionCount: views
    }
  };

  if (Array.isArray(type)) {
    Object.assign(schema, {
      educationalLevel: learning.educationalLevel,
      learningResourceType: learning.learningResourceType,
      teaches: learning.teaches,
      inLanguage: learning.inLanguage
    });
  }

  return compact(schema);
}

// Node: const { buildLearningVideoSchema } = require('./learning-video-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildLearningVideoSchema };
