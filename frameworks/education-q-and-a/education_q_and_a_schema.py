import re
from urllib.parse import urlparse


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def clean_text(value):
    return re.sub(r"\s+", " ", value).strip() if isinstance(value, str) else ""


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


ALIGNMENT_TYPES = ("educationalSubject", "educationalLevel")


def build_flashcard(card):
    question = clean_text(card.get("question"))
    # exactly one accepted answer per Question: lists of several are not eligible
    answer = None if isinstance(card.get("answer"), list) else clean_text(card.get("answer"))
    if not question or not answer:
        return None
    return {
        "@type": "Question",
        "eduQuestionType": "Flashcard",
        "text": question,
        "acceptedAnswer": {"@type": "Answer", "text": answer},
    }


def build_quiz_schema(source):
    # page gates: indexable, self-canonical, questions visible on the page (not only in a PDF)
    if source.get("indexable") is False:
        return None
    if not is_absolute_url(source.get("url")):
        return None
    if source.get("canonicalUrl") and source["canonicalUrl"] != source["url"]:
        return None
    if source.get("questionsVisible") is not True:
        return None

    cards = source.get("flashcards") or []
    if not cards:
        return None
    # every question must be a Flashcard; multiple choice or checkbox questions make the Quiz ineligible
    if any(card.get("format") and card["format"] != "flashcard" for card in cards):
        return None

    has_part = [build_flashcard(card) for card in cards]
    if any(question is None for question in has_part):
        return None

    concepts = source.get("concepts") or []
    schema = {
        "@context": "https://schema.org",
        "@type": "Quiz",
        "about": {"@type": "Thing", "name": concepts[0] if len(concepts) == 1 else concepts} if concepts else None,
        "educationalAlignment": [
            {
                "@type": "AlignmentObject",
                "alignmentType": a.get("type"),
                "targetName": clean_text(a.get("targetName")),
            }
            for a in source.get("alignments") or []
            if a.get("type") in ALIGNMENT_TYPES and clean_text(a.get("targetName"))
        ],
        "hasPart": has_part,
    }

    return compact(schema)


# Usage:
# build_quiz_schema({
#     "url": "https://www.example.com/biology/cell-transport-flashcards",
#     "canonicalUrl": "https://www.example.com/biology/cell-transport-flashcards",
#     "indexable": True,
#     "questionsVisible": True,
#     "concepts": ["Cell transport"],
#     "alignments": [
#         {"type": "educationalSubject", "targetName": "Biology"},
#         {"type": "educationalLevel", "targetName": "Grade 7: Cell Structure"},
#     ],
#     "flashcards": [
#         {"format": "flashcard", "question": "What is the process by which molecules move from high to low concentration?", "answer": "Diffusion"},
#         {"format": "flashcard", "question": "Which organelle controls what enters and leaves the cell?", "answer": "The cell membrane"},
#     ],
# })
