import re
from datetime import datetime
from urllib.parse import urlparse


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


ISO_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$")


def to_iso_datetime(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if not isinstance(value, str) or not ISO_DATETIME.match(value.strip()):
        return None
    # keep the original string so the timezone offset survives
    try:
        datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return value.strip()


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


AI_SOURCE_TYPES = {
    "trained": "https://schema.org/TrainedAlgorithmicMediaDigitalSource",
    "algorithmic": "https://schema.org/AlgorithmicMediaDigitalSource",
}


def full_text(value):
    # Google wants the entire text, never a truncated excerpt
    text = value.strip() if isinstance(value, str) else ""
    return text if text and not re.search(r"(\.\.\.|…)$", text) else None


def to_count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def build_author(author):
    if not author or not author.get("name"):
        return None
    return {
        "@type": "Organization" if author.get("type") == "Organization" else "Person",
        "name": author["name"],
        "url": author.get("url") if is_absolute_url(author.get("url")) else None,
    }


def build_video(video):
    # inline video: only emit when Google&#x27;s Video basics are present
    upload_date = to_iso_datetime(video.get("uploadDate"))
    if not video.get("name") or not is_absolute_url(video.get("thumbnailUrl")) or not upload_date:
        return None
    return {
        "@type": "VideoObject",
        "name": video["name"],
        "description": video.get("description"),
        "thumbnailUrl": video["thumbnailUrl"],
        "uploadDate": upload_date,
        "contentUrl": video.get("contentUrl") if is_absolute_url(video.get("contentUrl")) else None,
    }


def build_post_fields(post):
    # fields shared by Question, Answer and Comment
    comments = [c for c in (build_comment(c) for c in post.get("comments") or []) if c]
    count = to_count(post.get("commentCount"))
    return {
        "author": build_author(post.get("author")),
        "datePublished": to_iso_datetime(post.get("datePublished")),
        "dateModified": to_iso_datetime(post.get("dateModified")),
        "image": [u for u in post.get("images") or [] if is_absolute_url(u)],
        "video": [v for v in (build_video(v) for v in post.get("videos") or []) if v],
        "digitalSourceType": AI_SOURCE_TYPES.get(post.get("aiGenerated")),
        "comment": comments,
        "commentCount": max(count or 0, len(comments)) if comments else count,
    }


def build_comment(comment):
    text = full_text(comment.get("text"))
    if not text:
        return None  # Comment requires text
    return {"@type": "Comment", "text": text, **build_post_fields(comment)}


def build_answer(answer):
    text = full_text(answer.get("text"))
    if not text:
        return None  # Answer requires the full text
    return {
        "@type": "Answer",
        "text": text,
        **build_post_fields(answer),
        "upvoteCount": answer.get("votes") if is_int(answer.get("votes")) else None,  # upvotes minus downvotes
        "url": answer.get("url") if is_absolute_url(answer.get("url")) else None,
    }


def build_qa_page_schema(source):
    # page gates: indexable, self-canonical, visible, one question that users can answer
    if source.get("indexable") is False:
        return None
    if not is_absolute_url(source.get("url")):
        return None
    if source.get("canonicalUrl") and source["canonicalUrl"] != source["url"]:
        return None
    if source.get("usersCanSubmitAnswers") is not True:
        return None  # site-written FAQ content is not QAPage
    q = source.get("question")
    if not q or isinstance(q, list):
        return None  # exactly one Question per page

    name = full_text(q.get("title"))
    if not name:
        return None

    answers = q.get("answers") or []
    accepted = [a for a in (build_answer(a) for a in answers if a.get("accepted")) if a]
    suggested = [a for a in (build_answer(a) for a in answers if not a.get("accepted")) if a]
    marked = len(accepted) + len(suggested)
    if marked == 0:
        return None  # acceptedAnswer or suggestedAnswer is required

    # each answer url must be unique, for example a #fragment per answer
    answer_urls = [a["url"] for a in accepted + suggested if a.get("url")]
    if len(set(answer_urls)) != len(answer_urls):
        return None

    # answerCount is required and can never be lower than the answers marked up
    answer_count = max(to_count(q.get("answerCount")) or 0, marked)

    schema = {
        "@context": "https://schema.org",
        "@type": "QAPage",
        "mainEntity": {
            "@type": "Question",
            "name": name,
            "text": full_text(q.get("body")),
            "answerCount": answer_count,
            "upvoteCount": q.get("votes") if is_int(q.get("votes")) else None,
            **build_post_fields(q),
            "acceptedAnswer": accepted,
            "suggestedAnswer": suggested,
        },
    }

    return compact(schema)


# Usage:
# build_qa_page_schema({
#     "url": "https://www.example.com/forum/q/1042",
#     "canonicalUrl": "https://www.example.com/forum/q/1042",
#     "indexable": True,
#     "usersCanSubmitAnswers": True,
#     "question": {
#         "title": "How many teaspoons are in a cup?",
#         "body": "I am converting a recipe from metric. How many teaspoons are in one US cup?",
#         "answerCount": 2,
#         "votes": 26,
#         "author": {"name": "Riya Shah", "url": "https://www.example.com/users/riya-shah"},
#         "datePublished": "2026-03-02T09:14:00-05:00",
#         "dateModified": "2026-03-02T09:20:00-05:00",
#         "images": ["https://www.example.com/forum/q/1042/measuring-cups.jpg"],
#         "commentCount": 1,
#         "comments": [{"text": "Do you mean a US cup or a metric cup?", "author": {"name": "Tom Ellis", "url": "https://www.example.com/users/tom-ellis"}, "datePublished": "2026-03-02T09:31:00-05:00", "dateModified": "2026-03-02T09:31:00-05:00"}],
#         "answers": [
#             {"accepted": True, "text": "There are 48 teaspoons in one US cup: 16 tablespoons times 3 teaspoons each.", "votes": 41, "url": "https://www.example.com/forum/q/1042#answer-1", "author": {"name": "Dana Kim", "url": "https://www.example.com/users/dana-kim"}, "datePublished": "2026-03-02T10:05:00-05:00", "dateModified": "2026-03-02T10:05:00-05:00", "images": ["https://www.example.com/forum/q/1042/teaspoon-chart.png"], "commentCount": 1, "comments": [{"text": "Confirmed with my kitchen scale, thanks.", "author": {"name": "Riya Shah", "url": "https://www.example.com/users/riya-shah"}, "datePublished": "2026-03-02T12:02:00-05:00", "dateModified": "2026-03-02T12:02:00-05:00"}]},
#             {"accepted": False, "text": "A metric cup is 250 ml, which is about 50 metric teaspoons of 5 ml.", "votes": 7, "url": "https://www.example.com/forum/q/1042#answer-2", "author": {"name": "Luis Ortega", "url": "https://www.example.com/users/luis-ortega"}, "datePublished": "2026-03-02T11:40:00-05:00", "dateModified": "2026-03-03T08:12:00-05:00", "commentCount": 1, "comments": [{"text": "Useful if the recipe is Australian.", "author": {"name": "Tom Ellis", "url": "https://www.example.com/users/tom-ellis"}, "datePublished": "2026-03-03T09:00:00-05:00", "dateModified": "2026-03-03T09:00:00-05:00"}]},
#         ],
#     },
# })
