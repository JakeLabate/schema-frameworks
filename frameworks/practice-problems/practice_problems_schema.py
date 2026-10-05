from urllib.parse import urlparse


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def compact(value):
    if isinstance(value, list):
        items = [kept for kept in (compact(item) for item in value) if kept is not None]
        return items or None
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            kept = compact(item)
            if kept is not None:
                out[key] = kept
        return out or None
    if value is None or value == "":
        return None
    return value


def choose_question_type(problem):
    # open problems with one answer map to Flashcard, the only Quiz question type Google still documents
    options = problem.get("options") or []
    if not options:
        return "Flashcard"
    correct = sum(1 for o in options if o.get("correct"))
    if correct == 0:
        return None
    return "Multiple choice" if correct == 1 else "Checkbox"


def build_question(problem, question_type):
    text = (problem.get("question") or "").strip()
    if not text:
        return None
    if question_type == "Flashcard":
        answer = (problem.get("answer") or "").strip()
        if not answer:
            return None
        return {
            "@type": "Question",
            "eduQuestionType": "Flashcard",
            "text": text,
            "acceptedAnswer": {"@type": "Answer", "text": answer},  # exactly one
        }
    # choice questions: schema.org semantics only, no Google feature reads them
    options = problem["options"]
    answers = [{"@type": "Answer", "position": i + 1, "text": o.get("text")} for i, o in enumerate(options)]
    return {
        "@type": "Question",
        "eduQuestionType": question_type,
        "text": text,
        "suggestedAnswer": [a for a, o in zip(answers, options) if not o.get("correct")],
        "acceptedAnswer": [a for a, o in zip(answers, options) if o.get("correct")],
    }


def build_practice_quiz_schema(source):
    # Practice problems rich results were retired in Jan 2026; Google now reads Quiz only as
    # Education Q&A flashcards. Emit only for visible, indexable problem sets.
    if source.get("indexable") is False:
        return None
    if not is_absolute_url(source.get("url")):
        return None
    if source.get("canonicalUrl") and source["canonicalUrl"] != source["url"]:
        return None
    if source.get("problemsVisible") is not True:
        return None

    # choice questions make the Quiz ineligible for Education Q&A; include them only on request
    typed = [(p, choose_question_type(p)) for p in source.get("problems") or []]
    has_part = [
        build_question(p, t)
        for p, t in typed
        if t == "Flashcard" or (t and source.get("includeChoiceQuestions") is True)
    ]
    if not has_part or None in has_part:
        return None

    schema = {
        "@context": "https://schema.org",
        "@type": "Quiz",
        "name": source.get("title"),
        "about": {"@type": "Thing", "name": source["concept"]} if source.get("concept") else None,
        "educationalAlignment": [
            {"@type": "AlignmentObject", "alignmentType": a["type"], "targetName": a["targetName"]}
            for a in source.get("alignments") or []
            if a.get("type") in ("educationalSubject", "educationalLevel") and a.get("targetName")
        ],
        "hasPart": has_part,
    }

    return compact(schema)


# Usage:
# build_practice_quiz_schema({
#     "url": "https://www.example.com/algebra/linear-equations/practice",
#     "canonicalUrl": "https://www.example.com/algebra/linear-equations/practice",
#     "indexable": True,
#     "problemsVisible": True,
#     "title": "Linear equations practice set",
#     "concept": "Solving linear equations",
#     "alignments": [
#         {"type": "educationalSubject", "targetName": "Algebra"},
#         {"type": "educationalLevel", "targetName": "Grade 8"},
#     ],
#     "problems": [
#         {"question": "Solve for x: 3x + 5 = 20", "answer": "x = 5"},
#         {"question": "Solve for y: 2y - 7 = 9", "answer": "y = 8"},
#         {"question": "Which value of x satisfies 4x = 28?", "options": [{"text": "6"}, {"text": "7", "correct": True}, {"text": "8"}]},
#     ],
# })
