import re
from datetime import date
from urllib.parse import urlparse
from datetime import datetime, timezone

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
ISO_DATE_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.hostname)


def is_real_date(y, m, d):
    try:
        date(int(y), int(m), int(d))
        return True
    except ValueError:
        return False


# Calendar date (YYYY-MM-DD); a full date-time is cut to its date part.
def to_iso_date(value):
    if not isinstance(value, str):
        return None
    v = value.strip()
    m = ISO_DATE.match(v) or ISO_DATE_TIME.match(v)
    return v[:10] if m and is_real_date(m[1], m[2], m[3]) else None


# Date-time with Z or an offset (kept as written), or a plain date.
# A date-time without a timezone is rejected instead of guessed.
def to_iso_date_time(value):
    if not isinstance(value, str):
        return None
    v = value.strip()
    m = ISO_DATE.match(v) or ISO_DATE_TIME.match(v)
    return v if m and is_real_date(m[1], m[2], m[3]) else None


# Drop None, "", [] and {} recursively.
def compact(value):
    if isinstance(value, list):
        items = [c for c in (compact(v) for v in value) if c is not None]
        return items or None
    if isinstance(value, dict):
        out = {}
        for key, v in value.items():
            c = compact(v)
            if c is not None:
                out[key] = c
        return out or None
    if value is None or value == "":
        return None
    return value


# Page gates: indexable, self-canonical, and the marked-up content is visible.
def passes_page_gates(source):
    if not source.get("isIndexable") or not source.get("isContentVisible"):
        return False
    if not is_absolute_url(source.get("url")):
        return False
    return not source.get("canonicalUrl") or source.get("canonicalUrl") == source.get("url")


INTERACTION_TYPES = {
    "likes": "https://schema.org/LikeAction",
    "dislikes": "https://schema.org/DislikeAction",
    "views": "https://schema.org/ViewAction",
    "comments": "https://schema.org/CommentAction",
    "replies": "https://schema.org/ReplyAction",
    "shares": "https://schema.org/ShareAction",
}
DIGITAL_SOURCE_TYPES = {
    "llm": "https://schema.org/TrainedAlgorithmicMediaDigitalSource",
    "bot": "https://schema.org/AlgorithmicMediaDigitalSource",
}


def to_timestamp(value):
    if ISO_DATE.match(value):
        return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


# Q&A threads belong in QAPage markup; social platforms use SocialMediaPosting.
def choose_forum_posting_type(source):
    if source.get("isQuestionAnswerThread"):
        return None
    return "SocialMediaPosting" if source.get("platform") == "social" else "DiscussionForumPosting"


def build_author(author):
    if not author or not author.get("name"):
        return None
    return {
        "@type": "Organization" if author.get("isOrganization") else "Person",
        "name": author["name"],
        "url": author.get("url") if is_absolute_url(author.get("url")) else None,
    }


def build_stats(stats):
    return [
        {"@type": "InteractionCounter", "interactionType": INTERACTION_TYPES[key], "userInteractionCount": count}
        for key, count in (stats or {}).items()
        if key in INTERACTION_TYPES and isinstance(count, int) and not isinstance(count, bool) and count >= 0
    ]


# Shared fields for posts and comments. Returns None when a required field is missing.
def build_entry(entry, allow_no_content=False):
    author = build_author(entry.get("author"))
    date_published = to_iso_date_time(entry.get("datePublished"))
    if not author or not date_published:
        return None

    # Inline media only: never avatars, icons or placeholders.
    image = [u for u in entry.get("images") or [] if is_absolute_url(u)]
    text = (entry.get("text") or "").strip()
    if not text and not image and not entry.get("video") and not allow_no_content:
        return None

    date_modified = to_iso_date_time(entry.get("dateModified"))
    if date_modified and to_timestamp(date_modified) < to_timestamp(date_published):
        date_modified = None

    built = [build_entry(c) for c in entry.get("comments") or []]
    comment = [{"@type": "Comment", **c} for c in built if c]  # replies stay nested, in page order
    count = entry.get("commentCount")
    return {
        "author": author,
        "datePublished": date_published,
        "dateModified": date_modified,
        "text": text,
        "image": image,
        "video": entry.get("video"),
        "url": entry.get("url") if is_absolute_url(entry.get("url")) else None,
        "creativeWorkStatus": "Deleted" if entry.get("isDeleted") else None,
        "digitalSourceType": DIGITAL_SOURCE_TYPES.get(entry.get("generatedBy")),
        "interactionStatistic": build_stats(entry.get("stats")),
        "comment": comment,
        "commentCount": count if isinstance(count, int) and count >= len(comment) else None,
    }


def count_comments(comments):
    return sum(1 + count_comments(c.get("comment")) for c in comments or [])


def build_discussion_forum_schema(source):
    if not passes_page_gates(source):
        return None
    posting_type = choose_forum_posting_type(source)
    if not posting_type:
        return None

    # Text, image or video is required unless the posting represents a post on another page.
    post_url = source["postUrl"] if is_absolute_url(source.get("postUrl")) else source["url"]
    entry = build_entry(source.get("post") or {}, allow_no_content=post_url != source["url"])
    if not entry:
        return None

    headline = (source["post"].get("headline") or "").strip()
    # A headline that repeats or truncates the text adds nothing: drop it.
    keep_headline = headline and not entry["text"].startswith(re.sub(r"(\.\.\.|…)$", "", headline))
    marked = count_comments(entry["comment"])

    return compact({
        "@context": "https://schema.org",
        "@type": posting_type,
        "headline": headline if keep_headline else None,
        **entry,
        "commentCount": max(entry["commentCount"] or 0, marked) or None,
        "url": post_url,  # first page URL for multi-page threads
        "mainEntityOfPage": source["url"] if source.get("isSinglePostPage") else None,
        "isPartOf": source["subforumUrl"] if is_absolute_url(source.get("subforumUrl")) else None,
    })


# Usage: json_ld = build_discussion_forum_schema(source)  # same source dict as the JS example; None means emit nothing
