# Shared helpers
import re
from datetime import date
from urllib.parse import urlparse

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
ISO_DATETIME = re.compile(r"^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$")


def is_absolute_url(value):
    if not isinstance(value, str):
        return False
    try:
        parts = urlparse(value)
    except ValueError:
        return False
    return parts.scheme in ("http", "https") and bool(parts.hostname)


def to_iso_date(value):
    if not isinstance(value, str) or not ISO_DATE.match(value):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


# Keeps the original timezone offset; rejects naive or unparseable values.
def to_iso_datetime(value):
    match = ISO_DATETIME.match(value) if isinstance(value, str) else None
    return value if match and to_iso_date(match.group(1)) else None


# Drops None, "", [] and {} recursively.
def compact(value):
    if isinstance(value, list):
        items = [kept for kept in (compact(item) for item in value) if kept is not None]
        return items or None
    if isinstance(value, dict):
        out = {key: kept for key, kept in ((k, compact(v)) for k, v in value.items()) if kept is not None}
        return out or None
    return None if value is None or value == "" else value


# Page gates: indexable, self-canonical, marked-up content visible.
def passes_page_gates(page):
    if not page or page.get("noindex") or page.get("robotsBlocked"):
        return False
    if not is_absolute_url(page.get("url")):
        return False
    if page.get("canonicalUrl") and page["canonicalUrl"] != page["url"]:
        return False
    return page.get("contentVisible") is True


# Math solver helpers
# Google's problem type list (eduQuestionType and assesses), compared case-insensitively.
PROBLEM_TYPES = [
    "Absolute Value Equation", "Algebra", "Arc Length", "Arithmetic", "Biquadratic Equation", "Calculus",
    "Characteristic Polynomial", "Circle", "Derivative", "Differential Equation", "Distance", "Eigenvalue",
    "Eigenvector", "Ellipse", "Exponential Equation", "Function", "Function Composition", "Geometry",
    "Hyperbola", "Inflection Point", "Integral", "Intercept", "Limit", "Line Equation", "Linear Algebra",
    "Linear Equation", "Linear Inequality", "Logarithmic Equation", "Logarithmic Inequality", "Matrix",
    "Midpoint", "Parabola", "Parallel", "Perpendicular", "Polynomial Equation", "Polynomial Expression",
    "Polynomial Inequality", "Quadratic Equation", "Quadratic Expression", "Quadratic Inequality",
    "Radical Equation", "Radical Inequality", "Rational Equation", "Rational Expression", "Rational Inequality",
    "Slope", "Statistics", "System of Equations", "Trigonometry",
]
PLACEHOLDER = "{math_expression_string}"
LANG_CODE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")


# Map to Google's canonical spelling; drop unknown problem types.
def to_problem_types(values):
    out = []
    for v in values or []:
        match = next((t for t in PROBLEM_TYPES if t.lower() == str(v).strip().lower()), None)
        if match and match not in out:
            out.append(match)
    return out


def is_homepage(url):
    return urlparse(url).path in ("", "/")


def build_solve_math_action(action):
    target = (action or {}).get("target")
    if not isinstance(target, str) or PLACEHOLDER not in target:
        return None
    if not is_absolute_url(target.replace(PLACEHOLDER, "x", 1)):
        return None
    return {
        "@type": "SolveMathAction",
        "target": target,
        "mathExpression-input": "required name=math_expression_string",
        "eduQuestionType": to_problem_types(action.get("problemTypes")),
    }


def build_math_solver_schema(source):
    page = source.get("page")
    # Markup belongs on the solver site's homepage.
    if not passes_page_gates(page) or not is_homepage(page["url"]):
        return None

    # Required: url, usageInfo (privacy policy), potentialAction SolveMathAction.
    actions = [a for a in (build_solve_math_action(a) for a in (source.get("actions") or [])) if a]
    if not is_absolute_url(source.get("privacyPolicyUrl")) or not actions:
        return None

    return compact({
        "@context": "https://schema.org",
        "@type": ["MathSolver", "LearningResource"],  # both types, always
        "name": source.get("name"),
        "url": page["url"],
        "usageInfo": source["privacyPolicyUrl"],
        "inLanguage": [l for l in (source.get("languages") or []) if LANG_CODE.match(l)],
        "potentialAction": actions,
        "learningResourceType": "Math Solver",
        "assesses": to_problem_types(source.get("assesses")),
    })
