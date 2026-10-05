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

// Video helpers
const REGION_CODE = /^[A-Z]{2,3}$/;
const VIDEO_FILE = /\.(3gp|3g2|asf|avi|divx|m2v|m3u|m3u8|m4v|mkv|mov|mp4|mpeg|ogv|qvt|ram|rm|vob|webm|wmv|xap)$/i;

// Seconds to ISO 8601 duration, e.g. 754 -> "PT12M34S".
function toIsoDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return "PT" + (h ? h + "H" : "") + (m ? m + "M" : "") + (s ? s + "S" : "");
}

function withTimeParam(pageUrl, value) {
  return pageUrl + (pageUrl.includes("?") ? "&" : "?") + "t=" + value;
}

function buildParty(party) {
  if (!party || !party.name) return null; // creator/author needs name
  return {
    "@type": party.type === "Person" ? "Person" : "Organization",
    name: party.name,
    url: isAbsoluteUrl(party.url) ? party.url : null
  };
}

// Key moments, option 1: Clip per chapter (video must be 30s or longer).
function buildClips(chapters, durationSeconds, pageUrl) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 30) return [];
  const valid = (chapters || [])
    .filter((c) => c && c.name && Number.isInteger(c.startSeconds) && c.startSeconds >= 0 && c.startSeconds < durationSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const clips = [];
  const seenStarts = new Set();
  for (const c of valid) {
    if (seenStarts.has(c.startSeconds)) continue; // no two clips may share a start time
    seenStarts.add(c.startSeconds);
    const end = Number.isInteger(c.endSeconds) && c.endSeconds > c.startSeconds && c.endSeconds <= durationSeconds ? c.endSeconds : null;
    clips.push({
      "@type": "Clip",
      name: c.name,
      startOffset: c.startSeconds,
      endOffset: end,
      url: withTimeParam(pageUrl, c.startSeconds) // same URL path as the video
    });
  }
  return clips;
}

// Key moments, option 2: SeekToAction when the player deep links via ?t=.
function buildSeekToAction(source, pageUrl) {
  if (!source.supportsTimeParam || !Number.isInteger(source.durationSeconds) || source.durationSeconds < 30) return null;
  return {
    "@type": "SeekToAction",
    target: withTimeParam(pageUrl, "{seek_to_second_number}"),
    "startOffset-input": "required name=seek_to_second_number"
  };
}

// LIVE badge: BroadcastEvent with startDate and a (possibly approximate) endDate.
function buildBroadcastEvent(live) {
  if (!live) return null;
  const start = toIsoDateTime(live.startDate);
  const end = toIsoDateTime(live.endDate);
  if (!start || !end || Date.parse(end) <= Date.parse(start)) return null;
  return { "@type": "BroadcastEvent", isLiveBroadcast: true, startDate: start, endDate: end };
}

function buildVideoObjectSchema(source) {
  const page = source.page;
  if (!passesPageGates(page)) return null;

  // Required: name, thumbnailUrl, uploadDate (with timezone).
  const thumbnails = (source.thumbnailUrls || []).filter(isAbsoluteUrl);
  const uploadDate = toIsoDateTime(source.uploadDate);
  if (!source.title || !thumbnails.length || !uploadDate) return null;

  // contentUrl must be a supported video file; neither URL may be the watch page.
  const contentUrl = isAbsoluteUrl(source.contentUrl) && source.contentUrl !== page.url
    && VIDEO_FILE.test(new URL(source.contentUrl).pathname) ? source.contentUrl : null;
  const embedUrl = isAbsoluteUrl(source.embedUrl) && source.embedUrl !== page.url ? source.embedUrl : null;

  const expires = toIsoDateTime(source.expires);
  const regionsAllowed = (source.regionsAllowed || []).filter((c) => REGION_CODE.test(c));
  // Use regionsAllowed or ineligibleRegion, never both.
  const ineligibleRegion = regionsAllowed.length ? [] : (source.ineligibleRegion || []).filter((c) => REGION_CODE.test(c));
  const views = Number.isInteger(source.viewCount) && source.viewCount >= 0 ? source.viewCount : null;
  const clips = buildClips(source.chapters, source.durationSeconds, page.url);

  const schema = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: source.title,
    description: source.description,
    thumbnailUrl: thumbnails,
    uploadDate,
    duration: toIsoDuration(source.durationSeconds),
    contentUrl,
    embedUrl,
    expires: expires && Date.parse(expires) > Date.parse(uploadDate) ? expires : null,
    creator: buildParty(source.creator),
    regionsAllowed,
    ineligibleRegion,
    interactionStatistic: views === null ? null : {
      "@type": "InteractionCounter",
      interactionType: { "@type": "WatchAction" },
      userInteractionCount: views
    },
    hasPart: clips,
    potentialAction: clips.length ? null : buildSeekToAction(source, page.url),
    publication: buildBroadcastEvent(source.live)
  };

  return compact(schema) ?? null;
}

// Node: const { buildVideoObjectSchema } = require('./video-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildVideoObjectSchema };
