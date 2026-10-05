const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$/;

function isAbsoluteUrl(value) {
  return typeof value === "string" && /^https?:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i.test(value);
}

// Returns the ISO 8601 string unchanged (timezone offset kept), or null if unparseable.
function toIsoDateTime(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const m = text.match(ISO_DATE_TIME);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d) return null;
  if (+h > 23 || +mi > 59 || +s > 59) return null;
  return text;
}

function toIsoDate(value) {
  const iso = toIsoDateTime(value);
  return iso ? iso.slice(0, 10) : null;
}

// Drops null, undefined, "", [] and {} recursively.
function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const c = compact(v);
      if (c !== undefined) out[key] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null || value === undefined || value === "" ? undefined : value;
}

function passesPageGates(source) {
  if (source.indexable === false) return false;
  if (source.canonicalUrl && source.url && source.canonicalUrl !== source.url) return false;
  return source.contentVisible !== false;
}


const ORCID = /^https:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const ROR = /^https:\/\/ror\.org\/0[a-hj-km-np-tv-z0-9]{6}\d{2}$/;
const DOI = /^10\.\d{4,9}\/\S+$/;
const PARTIAL_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function textLength(value) {
  return typeof value === "string" ? value.trim().length : 0;
}

// "2016", "2016-05", "2016-05-01" or a full ISO 8601 date time.
function toTemporalPoint(value) {
  const m = typeof value === "string" ? value.match(PARTIAL_DATE) : null;
  if (m && m[3]) return toIsoDate(value);
  if (m) return !m[2] || (+m[2] >= 1 && +m[2] <= 12) ? value : null;
  return value && value.includes("T") ? toIsoDateTime(value) : null;
}

// ISO 8601 date or interval: "2008", "1950-01-01/2013-12-18", or "2013-12-19/.." for an open end.
function toTemporalCoverage(value) {
  if (typeof value !== "string") return null;
  const [start, end, extra] = value.trim().split("/");
  if (extra !== undefined || !toTemporalPoint(start)) return null;
  if (end === undefined) return start;
  if (end === "..") return `${start}/..`;
  if (!toTemporalPoint(end)) return null;
  const first = start.length === 4 ? `${start}-01-01` : start.length === 7 ? `${start}-01` : start.slice(0, 10);
  const last = end.length === 4 ? `${end}-12-31` : end.length === 7 ? `${end}-31` : end.slice(0, 10);
  return first <= last ? `${start}/${end}` : null; // the interval must not run backwards
}

function isLatLong(lat, long) {
  return typeof lat === "number" && typeof long === "number" && Math.abs(lat) <= 90 && Math.abs(long) <= 180;
}

// A named place, a GeoCoordinates point, or a GeoShape box ("lat1 long1 lat2 long2", latitude first).
function buildSpatialCoverage(place) {
  if (typeof place === "string") return place;
  if (!place) return null;
  if (place.point) {
    const { lat, long } = place.point;
    if (!isLatLong(lat, long)) return null;
    return { "@type": "Place", name: place.name, geo: { "@type": "GeoCoordinates", latitude: lat, longitude: long } };
  }
  if (Array.isArray(place.box) && place.box.length === 4) {
    const [lat1, long1, lat2, long2] = place.box;
    if (!isLatLong(lat1, long1) || !isLatLong(lat2, long2)) return null;
    return { "@type": "Place", name: place.name, geo: { "@type": "GeoShape", box: place.box.join(" ") } };
  }
  return place.name || null;
}

// Person: name, givenName, familyName, url, ORCID sameAs. Organization: name, url, ROR sameAs.
function buildAgent(agent) {
  if (!agent || !agent.name) return null;
  if (agent.type === "person") {
    return {
      "@type": "Person",
      name: agent.name,
      givenName: agent.givenName,
      familyName: agent.familyName,
      url: isAbsoluteUrl(agent.url) ? agent.url : null,
      sameAs: ORCID.test(agent.orcid || "") ? agent.orcid : null
    };
  }
  return {
    "@type": "Organization",
    name: agent.name,
    url: isAbsoluteUrl(agent.url) ? agent.url : null,
    sameAs: ROR.test(agent.ror || "") ? agent.ror : null
  };
}

// Bare DOIs become resolvable https://doi.org/ URLs; other identifiers stay as given.
function toIdentifier(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  return DOI.test(text) ? `https://doi.org/${text}` : text;
}

function buildVariable(variable) {
  if (typeof variable === "string") return variable;
  if (!variable || !variable.name) return null;
  return { "@type": "PropertyValue", name: variable.name, unitText: variable.unit, description: variable.description };
}

function buildDistribution(file) {
  // contentUrl is required on every DataDownload.
  if (!file || !isAbsoluteUrl(file.contentUrl)) return null;
  return { "@type": "DataDownload", contentUrl: file.contentUrl, encodingFormat: file.encodingFormat };
}

// A related dataset as a URL, or as a Dataset with its own name and valid description.
function buildRelatedDataset(part) {
  if (isAbsoluteUrl(part)) return part;
  const length = textLength(part && part.description);
  if (!part || !part.name || length < 50 || length > 5000) return null;
  return { "@type": "Dataset", name: part.name, description: part.description.trim(), url: isAbsoluteUrl(part.url) ? part.url : null };
}

function buildDatasetSchema(source) {
  // (a) Page gates: the indexable, self-canonical landing page for this dataset, with the metadata visible.
  if (!passesPageGates(source) || !isAbsoluteUrl(source.url)) return null;

  // (b) Required: name, and a description between 50 and 5000 characters.
  const length = textLength(source.description);
  if (!source.name || length < 50 || length > 5000) return null;

  const identifier = (source.identifiers || []).map(toIdentifier).filter(Boolean);
  const isOwnCitation = (c) => identifier.includes(toIdentifier(c));

  // (c) Recommended properties, only when the source has them; (d) value rules inline.
  const schema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": `${source.url}#dataset`,
    name: source.name,
    description: source.description.trim(),
    alternateName: source.alternateNames,
    url: source.url,
    sameAs: (source.sameAs || []).filter(isAbsoluteUrl), // the canonical page when republished
    identifier, // repeat for multiple DOIs or Compact Identifiers
    version: source.version,
    keywords: source.keywords,
    license: isAbsoluteUrl(source.license) ? source.license : null, // a URL for one specific license version
    isAccessibleForFree: typeof source.free === "boolean" ? source.free : null,
    creator: (source.creators || []).map(buildAgent),
    funder: (source.funders || []).map(buildAgent),
    citation: (source.citations || []).filter((c) => !isOwnCitation(c)), // related articles, not the dataset itself
    temporalCoverage: toTemporalCoverage(source.temporalCoverage),
    spatialCoverage: buildSpatialCoverage(source.spatialCoverage),
    variableMeasured: (source.variables || []).map(buildVariable),
    measurementTechnique: source.measurementTechniques,
    isPartOf: (source.partOf || []).map(buildRelatedDataset),
    hasPart: (source.parts || []).map(buildRelatedDataset),
    includedInDataCatalog: source.catalog && source.catalog.name
      ? { "@type": "DataCatalog", name: source.catalog.name, url: isAbsoluteUrl(source.catalog.url) ? source.catalog.url : null }
      : null,
    distribution: (source.files || []).map(buildDistribution)
  };

  // (e) Strip empty values.
  return compact(schema);
}

// Node: const { buildDatasetSchema } = require('./dataset-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildDatasetSchema };
