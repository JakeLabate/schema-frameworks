function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

function toIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value.trim())) return null;
  return isNaN(Date.parse(value.trim())) ? null : value.trim();
}

function toIsoDateTime(value) {
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

function buildRating(verdict) {
  // the textual verdict is required: alternateName, or name when alternateName is absent
  const label = (verdict.label || "").trim();
  if (!label) return null;
  const rating = { "@type": "Rating", "alternateName": label, "name": label };

  const { value, worst, best } = verdict;
  const numeric = [value, worst, best].every((n) => typeof n === "number" && isFinite(n));
  if (numeric) {
    // worstRating at least 1 and below bestRating; ratingValue inside the scale
    if (worst < 1 || worst >= best || value < worst || value > best) return null;
    Object.assign(rating, { "ratingValue": value, "worstRating": worst, "bestRating": best });
  }
  return rating;
}

function buildClaim(claim) {
  if (!claim) return null;
  return {
    "@type": "Claim",
    "author": claim.authorName
      ? {
          "@type": claim.authorType === "Person" ? "Person" : "Organization",
          "name": claim.authorName,
          "sameAs": isAbsoluteUrl(claim.authorSameAs) ? claim.authorSameAs : null
        }
      : null,
    "datePublished": toIsoDateTime(claim.datePublished) || toIsoDate(claim.datePublished),
    "appearance": (claim.appearances || []).filter(isAbsoluteUrl),
    "firstAppearance": isAbsoluteUrl(claim.firstAppearance) ? claim.firstAppearance : null
  };
}

function buildClaimReviewSchema(source) {
  // Google is phasing out ClaimReview rich results; emit only for a visible fact check
  // (schema.org semantics, Fact Check Explorer and other consumers)
  if (source.indexable === false) return null;
  if (!isAbsoluteUrl(source.url)) return null;
  if (source.canonicalUrl && source.canonicalUrl !== source.url) return null;
  if (source.verdictVisible !== true) return null; // claim and conclusion must be readable on the page
  if ((source.claimReviewsOnPage ?? 1) !== 1) return null; // one ClaimReview per page

  const claimReviewed = (source.claimSummary || "").trim();
  if (!claimReviewed) return null;
  const reviewRating = buildRating(source.verdict || {});
  if (!reviewRating) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "ClaimReview",
    "url": source.url, // the page hosting the full fact check article
    "claimReviewed": claimReviewed, // keep under 75 characters to limit wrapping on mobile
    "reviewRating": reviewRating,
    "author": source.publisher
      ? {
          "@type": "Organization",
          "name": source.publisher.name,
          "url": isAbsoluteUrl(source.publisher.url) ? source.publisher.url : null
        }
      : null,
    "itemReviewed": buildClaim(source.claim)
  };

  return compact(schema);
}

// Node: const { buildClaimReviewSchema } = require('./fact-check-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildClaimReviewSchema };
