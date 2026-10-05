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

function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const isCurrencyCode = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);

// Pay period to ISO 8601 duration (schema.org QuantitativeValueDistribution.duration).
const PAY_PERIODS = { hour: "PT1H", day: "P1D", week: "P1W", month: "P1M", year: "P1Y" };
const PERCENTILES = [
  ["p10", "percentile10"],
  ["p25", "percentile25"],
  ["median", "median"],
  ["p75", "percentile75"],
  ["p90", "percentile90"]
];
const PLACE_TYPES = { city: "City", state: "State", country: "Country" };

// One MonetaryAmountDistribution per pay period; null when the figures are unusable.
function buildDistribution(range, currency) {
  const duration = PAY_PERIODS[range.period];
  if (!duration || !isCurrencyCode(currency)) return null;
  const dist = { "@type": "MonetaryAmountDistribution", name: range.label, currency, duration };
  let previous = 0;
  for (const [key, prop] of PERCENTILES) {
    const value = toNumber(range[key]);
    if (value === null) continue;
    if (value <= 0 || value < previous) return null; // positive and non-decreasing
    dist[prop] = value;
    previous = value;
  }
  return PERCENTILES.some(([, prop]) => prop in dist) ? dist : null;
}

// Retired rich result: Google lists no required properties. This is schema.org
// Occupation markup for other consumers, gated on a minimum useful core.
function buildOccupationSchema(source) {
  if (!passesPageGates(source.page)) return null;
  if (!source.name) return null;

  const estimatedSalary = (source.salaryRanges || [])
    .map((range) => buildDistribution(range, source.currency))
    .filter(Boolean);
  if (estimatedSalary.length === 0) return null;

  const locations = (source.locations || [])
    .filter((loc) => PLACE_TYPES[loc.kind] && loc.name)
    .map((loc) => ({ "@type": PLACE_TYPES[loc.kind], name: loc.name }));

  const schema = {
    "@context": "https://schema.org",
    "@type": "Occupation",
    name: source.name,
    description: source.description,
    url: source.page.url,
    occupationalCategory: source.occupationalCategory,
    occupationLocation: locations,
    estimatedSalary,
    skills: source.skills
  };

  return compact(schema);
}

// Node: const { buildOccupationSchema } = require('./estimated-salary-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildOccupationSchema };
