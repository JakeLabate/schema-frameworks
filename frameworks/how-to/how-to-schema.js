function isAbsoluteUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/;

function toIsoDuration(value) {
  // accepts an ISO 8601 duration string or a whole number of minutes
  if (typeof value === "string") return ISO_DURATION.test(value.trim()) ? value.trim() : null;
  if (!Number.isInteger(value) || value <= 0) return null;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return "PT" + (hours ? hours + "H" : "") + (minutes ? minutes + "M" : "");
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

function buildStep(step, index, pageUrl) {
  const text = (step.text || "").trim();
  if (!text) return null;
  return {
    "@type": "HowToStep",
    "position": index + 1,
    "name": step.name,
    "text": text,
    "url": step.anchor ? pageUrl + "#" + step.anchor : null,
    "image": isAbsoluteUrl(step.image) ? step.image : null
  };
}

function buildHowToSchema(source) {
  // Google retired How-to rich results in Sep 2023: no rich result, no Google required properties.
  // Emit only when the steps are visible on the page, for schema.org semantics and other consumers.
  if (source.indexable === false) return null;
  if (!isAbsoluteUrl(source.url)) return null;
  if (source.canonicalUrl && source.canonicalUrl !== source.url) return null;
  if (source.stepsVisible !== true) return null;

  const name = (source.title || "").trim();
  const steps = (source.steps || []).map((s, i) => buildStep(s, i, source.url));
  if (!name || !steps.length || steps.includes(null)) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "name": name,
    "description": source.description,
    "image": isAbsoluteUrl(source.image) ? source.image : null,
    "totalTime": toIsoDuration(source.totalMinutes),
    "supply": (source.supplies || []).map((s) => ({ "@type": "HowToSupply", "name": s })),
    "tool": (source.tools || []).map((t) => ({ "@type": "HowToTool", "name": t })),
    "step": steps
  };

  return compact(schema);
}

// Node: const { buildHowToSchema } = require('./how-to-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildHowToSchema };
