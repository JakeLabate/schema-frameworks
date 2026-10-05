const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isRealDate(y, m, d) {
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
}

// Calendar date (YYYY-MM-DD); a full date-time is cut to its date part.
function toIsoDate(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const m = v.match(ISO_DATE) || v.match(ISO_DATE_TIME);
  return m && isRealDate(m[1], m[2], m[3]) ? v.slice(0, 10) : null;
}

// Date-time with Z or an offset (kept as written), or a plain date.
// A date-time without a timezone is rejected instead of guessed.
function toIsoDateTime(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const m = v.match(ISO_DATE) || v.match(ISO_DATE_TIME);
  return m && isRealDate(m[1], m[2], m[3]) ? v : null;
}

// Drop null, undefined, "", [] and {} recursively.
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
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

// Page gates: indexable, self-canonical, and the marked-up content is visible.
function passesPageGates(source) {
  if (!source.isIndexable || !source.isContentVisible) return false;
  if (!isAbsoluteUrl(source.url)) return false;
  return !source.canonicalUrl || source.canonicalUrl === source.url;
}

// Stats about the profile entity itself, counted on this platform only.
const PROFILE_STATS = {
  followers: "https://schema.org/FollowAction",
  likes: "https://schema.org/LikeAction",
  friends: "https://schema.org/BefriendAction"
};
// Stats about what the entity does: following, liking, posting, resharing.
const AGENT_STATS = {
  following: "https://schema.org/FollowAction",
  likesGiven: "https://schema.org/LikeAction",
  posts: "https://schema.org/WriteAction",
  reshares: "https://schema.org/ShareAction"
};
const PLACEHOLDER_IMAGE = /default|placeholder|avatar-blank|blank-avatar|gravatar\.com\/avatar\/[^?]*\?.*d=/i;

function chooseProfileEntityType(source) {
  return source.isOrganization ? "Organization" : "Person";
}

function buildCounters(stats, allowed) {
  return Object.entries(stats || {})
    .filter(([key, count]) => allowed[key] && Number.isInteger(count) && count >= 0)
    .map(([key, count]) => ({ "@type": "InteractionCounter", "interactionType": allowed[key], "userInteractionCount": count }));
}

function buildProfilePageSchema(source) {
  if (!passesPageGates(source)) return null;
  // The page must be about one person or organization affiliated with the site.
  if (!source.isAffiliatedWithSite) return null;

  // Prefer the real name; a handle in name is fine when it is the only identifier.
  const name = (source.realName || source.handle || "").trim();
  if (!name) return null;
  const alternateName = source.realName && source.handle ? source.handle : null;

  const image = isAbsoluteUrl(source.imageUrl) && !PLACEHOLDER_IMAGE.test(source.imageUrl) ? source.imageUrl : null;

  const dateCreated = toIsoDateTime(source.dateCreated);
  let dateModified = toIsoDateTime(source.dateModified);
  if (dateCreated && dateModified && Date.parse(dateModified) < Date.parse(dateCreated)) dateModified = null;

  return compact({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "dateCreated": dateCreated,
    "dateModified": dateModified,
    "mainEntity": {
      "@type": chooseProfileEntityType(source),
      "name": name,
      "alternateName": alternateName,
      "identifier": source.internalId != null ? String(source.internalId) : null,
      "description": source.byline,
      "image": image,
      "sameAs": (source.externalProfiles || []).filter(isAbsoluteUrl),
      "interactionStatistic": buildCounters(source.profileStats, PROFILE_STATS),
      "agentInteractionStatistic": buildCounters(source.activityStats, AGENT_STATS)
    }
  }) || null;
}

// Node: const { buildProfilePageSchema } = require('./profile-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildProfilePageSchema };
