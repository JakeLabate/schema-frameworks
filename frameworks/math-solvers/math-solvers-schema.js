// Shared helpers
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$/;

function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

function toIsoDate(value) {
  const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null;
}

// Keeps the original timezone offset; rejects naive or unparseable values.
function toIsoDateTime(value) {
  const match = typeof value === "string" ? ISO_DATETIME.exec(value) : null;
  return match && toIsoDate(match[1]) ? value : null;
}

// Drops null, undefined, "", [] and {} recursively.
function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = compact(item);
      if (kept !== undefined) out[key] = kept;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null || value === undefined || value === "" ? undefined : value;
}

// Page gates: indexable, self-canonical, marked-up content visible.
function passesPageGates(page) {
  if (!page || page.noindex || page.robotsBlocked) return false;
  if (!isAbsoluteUrl(page.url)) return false;
  if (page.canonicalUrl && page.canonicalUrl !== page.url) return false;
  return page.contentVisible === true;
}

// Math solver helpers
// Google's problem type list (eduQuestionType and assesses), compared case-insensitively.
const PROBLEM_TYPES = [
  "Absolute Value Equation", "Algebra", "Arc Length", "Arithmetic", "Biquadratic Equation", "Calculus",
  "Characteristic Polynomial", "Circle", "Derivative", "Differential Equation", "Distance", "Eigenvalue",
  "Eigenvector", "Ellipse", "Exponential Equation", "Function", "Function Composition", "Geometry",
  "Hyperbola", "Inflection Point", "Integral", "Intercept", "Limit", "Line Equation", "Linear Algebra",
  "Linear Equation", "Linear Inequality", "Logarithmic Equation", "Logarithmic Inequality", "Matrix",
  "Midpoint", "Parabola", "Parallel", "Perpendicular", "Polynomial Equation", "Polynomial Expression",
  "Polynomial Inequality", "Quadratic Equation", "Quadratic Expression", "Quadratic Inequality",
  "Radical Equation", "Radical Inequality", "Rational Equation", "Rational Expression", "Rational Inequality",
  "Slope", "Statistics", "System of Equations", "Trigonometry"
];
const PLACEHOLDER = "{math_expression_string}";

// Map to Google's canonical spelling; drop unknown problem types.
function toProblemTypes(values) {
  const out = [];
  for (const v of values || []) {
    const match = PROBLEM_TYPES.find((t) => t.toLowerCase() === String(v).trim().toLowerCase());
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}

function isHomepage(url) {
  return new URL(url).pathname === "/";
}

function buildSolveMathAction(action) {
  if (!action || typeof action.target !== "string" || !action.target.includes(PLACEHOLDER)) return null;
  if (!isAbsoluteUrl(action.target.replace(PLACEHOLDER, "x"))) return null;
  return {
    "@type": "SolveMathAction",
    target: action.target,
    "mathExpression-input": "required name=math_expression_string",
    eduQuestionType: toProblemTypes(action.problemTypes)
  };
}

function buildMathSolverSchema(source) {
  const page = source.page;
  // Markup belongs on the solver site's homepage.
  if (!passesPageGates(page) || !isHomepage(page.url)) return null;

  // Required: url, usageInfo (privacy policy), potentialAction SolveMathAction.
  const actions = (source.actions || []).map(buildSolveMathAction).filter(Boolean);
  if (!isAbsoluteUrl(source.privacyPolicyUrl) || !actions.length) return null;

  return compact({
    "@context": "https://schema.org",
    "@type": ["MathSolver", "LearningResource"], // both types, always
    name: source.name,
    url: page.url,
    usageInfo: source.privacyPolicyUrl,
    inLanguage: (source.languages || []).filter((l) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)),
    potentialAction: actions,
    learningResourceType: "Math Solver",
    assesses: toProblemTypes(source.assesses)
  }) ?? null;
}

// Node: const { buildMathSolverSchema } = require('./math-solvers-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildMathSolverSchema };
