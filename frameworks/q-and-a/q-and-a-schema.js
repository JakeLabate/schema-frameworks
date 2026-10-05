function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

function toIsoDateTime(value) {
  if (value instanceof Date) return isNaN(value) ? null : value.toISOString();
  if (typeof value !== "string" || !ISO_DATETIME.test(value.trim())) return null;
  // keep the original string so the timezone offset survives
  return isNaN(Date.parse(value.trim())) ? null : value.trim();
}

function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = compact(item);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

const AI_SOURCE_TYPES = {
  trained: "https://schema.org/TrainedAlgorithmicMediaDigitalSource",
  algorithmic: "https://schema.org/AlgorithmicMediaDigitalSource"
};

function fullText(value) {
  // Google wants the entire text, never a truncated excerpt
  const text = typeof value === "string" ? value.trim() : "";
  return text && !/(\.\.\.|…)$/.test(text) ? text : null;
}

function toCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function buildAuthor(author) {
  if (!author || !author.name) return null;
  return {
    "@type": author.type === "Organization" ? "Organization" : "Person",
    "name": author.name,
    "url": isAbsoluteUrl(author.url) ? author.url : null
  };
}

function buildVideo(video) {
  // inline video: only emit when Google&#x27;s Video basics are present
  const uploadDate = toIsoDateTime(video.uploadDate);
  if (!video.name || !isAbsoluteUrl(video.thumbnailUrl) || !uploadDate) return null;
  return {
    "@type": "VideoObject",
    "name": video.name,
    "description": video.description,
    "thumbnailUrl": video.thumbnailUrl,
    "uploadDate": uploadDate,
    "contentUrl": isAbsoluteUrl(video.contentUrl) ? video.contentUrl : null
  };
}

function buildPostFields(post) {
  // fields shared by Question, Answer and Comment
  const comments = (post.comments || []).map(buildComment).filter(Boolean);
  return {
    "author": buildAuthor(post.author),
    "datePublished": toIsoDateTime(post.datePublished),
    "dateModified": toIsoDateTime(post.dateModified),
    "image": (post.images || []).filter(isAbsoluteUrl),
    "video": (post.videos || []).map(buildVideo).filter(Boolean),
    "digitalSourceType": AI_SOURCE_TYPES[post.aiGenerated] || null,
    "comment": comments,
    "commentCount": comments.length ? Math.max(toCount(post.commentCount) ?? 0, comments.length) : toCount(post.commentCount)
  };
}

function buildComment(comment) {
  const text = fullText(comment.text);
  if (!text) return null; // Comment requires text
  return { "@type": "Comment", "text": text, ...buildPostFields(comment) };
}

function buildAnswer(answer) {
  const text = fullText(answer.text);
  if (!text) return null; // Answer requires the full text
  return {
    "@type": "Answer",
    "text": text,
    ...buildPostFields(answer),
    "upvoteCount": Number.isInteger(answer.votes) ? answer.votes : null, // upvotes minus downvotes
    "url": isAbsoluteUrl(answer.url) ? answer.url : null
  };
}

function buildQAPageSchema(source) {
  // page gates: indexable, self-canonical, visible, one question that users can answer
  if (source.indexable === false) return null;
  if (!isAbsoluteUrl(source.url)) return null;
  if (source.canonicalUrl && source.canonicalUrl !== source.url) return null;
  if (source.usersCanSubmitAnswers !== true) return null; // site-written FAQ content is not QAPage
  const q = source.question;
  if (!q || Array.isArray(q)) return null; // exactly one Question per page

  const name = fullText(q.title);
  if (!name) return null;

  const accepted = (q.answers || []).filter((a) => a.accepted).map(buildAnswer).filter(Boolean);
  const suggested = (q.answers || []).filter((a) => !a.accepted).map(buildAnswer).filter(Boolean);
  const marked = accepted.length + suggested.length;
  if (marked === 0) return null; // acceptedAnswer or suggestedAnswer is required

  // each answer url must be unique, for example a #fragment per answer
  const answerUrls = [...accepted, ...suggested].map((a) => a.url).filter(Boolean);
  if (new Set(answerUrls).size !== answerUrls.length) return null;

  // answerCount is required and can never be lower than the answers marked up
  const answerCount = Math.max(toCount(q.answerCount) ?? 0, marked);

  const schema = {
    "@context": "https://schema.org",
    "@type": "QAPage",
    "mainEntity": {
      "@type": "Question",
      "name": name,
      "text": fullText(q.body),
      "answerCount": answerCount,
      "upvoteCount": Number.isInteger(q.votes) ? q.votes : null,
      ...buildPostFields(q),
      "acceptedAnswer": accepted,
      "suggestedAnswer": suggested
    }
  };

  return compact(schema);
}

// Node: const { buildQAPageSchema } = require('./q-and-a-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildQAPageSchema };
