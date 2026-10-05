function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
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

function chooseQuestionType(problem) {
  // open problems with one answer map to Flashcard, the only Quiz question type Google still documents
  const options = problem.options || [];
  if (!options.length) return "Flashcard";
  const correct = options.filter((o) => o.correct).length;
  if (correct === 0) return null;
  return correct === 1 ? "Multiple choice" : "Checkbox";
}

function buildQuestion(problem, type) {
  const text = (problem.question || "").trim();
  if (!text) return null;
  if (type === "Flashcard") {
    const answer = (problem.answer || "").trim();
    if (!answer) return null;
    return {
      "@type": "Question",
      "eduQuestionType": "Flashcard",
      "text": text,
      "acceptedAnswer": { "@type": "Answer", "text": answer } // exactly one
    };
  }
  // choice questions: schema.org semantics only, no Google feature reads them
  const answers = problem.options.map((o, i) => ({ "@type": "Answer", "position": i + 1, "text": o.text }));
  return {
    "@type": "Question",
    "eduQuestionType": type,
    "text": text,
    "suggestedAnswer": answers.filter((a, i) => !problem.options[i].correct),
    "acceptedAnswer": answers.filter((a, i) => problem.options[i].correct)
  };
}

function buildPracticeQuizSchema(source) {
  // Practice problems rich results were retired in Jan 2026; Google now reads Quiz only as
  // Education Q&A flashcards. Emit only for visible, indexable problem sets.
  if (source.indexable === false) return null;
  if (!isAbsoluteUrl(source.url)) return null;
  if (source.canonicalUrl && source.canonicalUrl !== source.url) return null;
  if (source.problemsVisible !== true) return null;

  // choice questions make the Quiz ineligible for Education Q&A; include them only on request
  const hasPart = (source.problems || [])
    .map((p) => ({ problem: p, type: chooseQuestionType(p) }))
    .filter(({ type }) => type === "Flashcard" || (type && source.includeChoiceQuestions === true))
    .map(({ problem, type }) => buildQuestion(problem, type));
  if (!hasPart.length || hasPart.includes(null)) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Quiz",
    "name": source.title,
    "about": source.concept ? { "@type": "Thing", "name": source.concept } : null,
    "educationalAlignment": (source.alignments || [])
      .filter((a) => ["educationalSubject", "educationalLevel"].includes(a.type) && a.targetName)
      .map((a) => ({ "@type": "AlignmentObject", "alignmentType": a.type, "targetName": a.targetName })),
    "hasPart": hasPart
  };

  return compact(schema);
}

// Node: const { buildPracticeQuizSchema } = require('./practice-problems-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildPracticeQuizSchema };
