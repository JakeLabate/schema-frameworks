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

const INTERACTION_TYPES = {
  likes: "https://schema.org/LikeAction",
  dislikes: "https://schema.org/DislikeAction",
  views: "https://schema.org/ViewAction",
  comments: "https://schema.org/CommentAction",
  replies: "https://schema.org/ReplyAction",
  shares: "https://schema.org/ShareAction"
};
const DIGITAL_SOURCE_TYPES = {
  llm: "https://schema.org/TrainedAlgorithmicMediaDigitalSource",
  bot: "https://schema.org/AlgorithmicMediaDigitalSource"
};

// Q&A threads belong in QAPage markup; social platforms use SocialMediaPosting.
function chooseForumPostingType(source) {
  if (source.isQuestionAnswerThread) return null;
  return source.platform === "social" ? "SocialMediaPosting" : "DiscussionForumPosting";
}

function buildAuthor(author) {
  if (!author || !author.name) return null;
  return {
    "@type": author.isOrganization ? "Organization" : "Person",
    "name": author.name,
    "url": isAbsoluteUrl(author.url) ? author.url : null
  };
}

function buildStats(stats) {
  return Object.entries(stats || {})
    .filter(([key, count]) => INTERACTION_TYPES[key] && Number.isInteger(count) && count >= 0)
    .map(([key, count]) => ({ "@type": "InteractionCounter", "interactionType": INTERACTION_TYPES[key], "userInteractionCount": count }));
}

// Shared fields for posts and comments. Returns null when a required field is missing.
function buildEntry(entry, { allowNoContent = false } = {}) {
  const author = buildAuthor(entry.author);
  const datePublished = toIsoDateTime(entry.datePublished);
  if (!author || !datePublished) return null;

  // Inline media only: never avatars, icons or placeholders.
  const image = (entry.images || []).filter(isAbsoluteUrl);
  const text = (entry.text || "").trim();
  if (!text && !image.length && !entry.video && !allowNoContent) return null;

  let dateModified = toIsoDateTime(entry.dateModified);
  if (dateModified && Date.parse(dateModified) < Date.parse(datePublished)) dateModified = null;

  const comment = (entry.comments || []).map((c) => buildEntry(c)).filter(Boolean)
    .map((c) => ({ "@type": "Comment", ...c })); // replies stay nested, in page order
  return {
    "author": author,
    "datePublished": datePublished,
    "dateModified": dateModified,
    "text": text,
    "image": image,
    "video": entry.video || null,
    "url": isAbsoluteUrl(entry.url) ? entry.url : null,
    "creativeWorkStatus": entry.isDeleted ? "Deleted" : null,
    "digitalSourceType": DIGITAL_SOURCE_TYPES[entry.generatedBy] || null,
    "interactionStatistic": buildStats(entry.stats),
    "comment": comment,
    "commentCount": Number.isInteger(entry.commentCount) && entry.commentCount >= comment.length ? entry.commentCount : null
  };
}

function countComments(comments) {
  return (comments || []).reduce((n, c) => n + 1 + countComments(c.comment), 0);
}

function buildDiscussionForumSchema(source) {
  if (!passesPageGates(source)) return null;
  const type = chooseForumPostingType(source);
  if (!type) return null;

  // Text, image or video is required unless the posting represents a post on another page.
  const postUrl = isAbsoluteUrl(source.postUrl) ? source.postUrl : source.url;
  const entry = buildEntry(source.post || {}, { allowNoContent: postUrl !== source.url });
  if (!entry) return null;

  const post = source.post;
  const headline = (post.headline || "").trim();
  // A headline that repeats or truncates the text adds nothing: drop it.
  const keepHeadline = headline && !entry.text.startsWith(headline.replace(/(\.\.\.|…)$/, ""));
  const marked = countComments(entry.comment);

  return compact({
    "@context": "https://schema.org",
    "@type": type,
    "headline": keepHeadline ? headline : null,
    ...entry,
    "commentCount": Math.max(entry.commentCount || 0, marked) || null,
    "url": postUrl, // first page URL for multi-page threads
    "mainEntityOfPage": source.isSinglePostPage ? source.url : null,
    "isPartOf": isAbsoluteUrl(source.subforumUrl) ? source.subforumUrl : null
  }) || null;
}

// Node: const { buildDiscussionForumSchema } = require('./discussion-forum-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildDiscussionForumSchema };
