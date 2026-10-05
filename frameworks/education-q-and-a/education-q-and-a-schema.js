function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
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

const ALIGNMENT_TYPES = ["educationalSubject", "educationalLevel"];

function buildFlashcard(card) {
  const question = cleanText(card.question);
  // exactly one accepted answer per Question: arrays of several are not eligible
  const answer = Array.isArray(card.answer) ? null : cleanText(card.answer);
  if (!question || !answer) return null;
  return {
    "@type": "Question",
    "eduQuestionType": "Flashcard",
    "text": question,
    "acceptedAnswer": { "@type": "Answer", "text": answer }
  };
}

function buildQuizSchema(source) {
  // page gates: indexable, self-canonical, questions visible on the page (not only in a PDF)
  if (source.indexable === false) return null;
  if (!isAbsoluteUrl(source.url)) return null;
  if (source.canonicalUrl && source.canonicalUrl !== source.url) return null;
  if (source.questionsVisible !== true) return null;

  const cards = source.flashcards || [];
  if (!cards.length) return null;
  // every question must be a Flashcard; multiple choice or checkbox questions make the Quiz ineligible
  if (cards.some((card) => card.format && card.format !== "flashcard")) return null;

  const hasPart = cards.map(buildFlashcard);
  if (hasPart.some((question) => question === null)) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Quiz",
    "about": (source.concepts || []).length
      ? { "@type": "Thing", "name": source.concepts.length === 1 ? source.concepts[0] : source.concepts }
      : null,
    "educationalAlignment": (source.alignments || [])
      .filter((a) => ALIGNMENT_TYPES.includes(a.type) && cleanText(a.targetName))
      .map((a) => ({
        "@type": "AlignmentObject",
        "alignmentType": a.type,
        "targetName": cleanText(a.targetName)
      })),
    "hasPart": hasPart
  };

  return compact(schema);
}

// Node: const { buildQuizSchema } = require('./education-q-and-a-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildQuizSchema };
