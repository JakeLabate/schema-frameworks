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


const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACTOR", "TEMPORARY", "INTERN", "VOLUNTEER", "PER_DIEM", "OTHER"];
const SALARY_UNITS = ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"];
const CREDENTIAL_CATEGORIES = ["high school", "associate degree", "bachelor degree", "professional certificate", "postgraduate degree"];

function toCountryCode(value) {
  const code = String(value || "").toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function buildJobPlace(location) {
  const country = toCountryCode(location.country);
  if (!country) return null; // addressCountry is required on every jobLocation
  return {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      streetAddress: location.street,
      addressLocality: location.locality,
      addressRegion: location.region,
      postalCode: location.postalCode,
      addressCountry: country
    }
  };
}

function buildBaseSalary(salary) {
  if (!salary) return null;
  const currency = String(salary.currency || "").toUpperCase();
  const unitText = String(salary.unit || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || !SALARY_UNITS.includes(unitText)) return null;
  const { value, min, max } = salary;
  if (value == null && (min == null || max == null || min > max)) return null; // a value, or a valid range
  return {
    "@type": "MonetaryAmount",
    currency,
    value: {
      "@type": "QuantitativeValue",
      value: value ?? null,
      minValue: value == null ? min : null,
      maxValue: value == null ? max : null,
      unitText
    }
  };
}

function buildJobPostingSchema(source, now = new Date()) {
  // (a) Page gates: indexable, self-canonical, a single job visible on this leaf page.
  if (!passesPageGates(source)) return null;

  // (b) Required: title, description (HTML, not the title), datePosted, hiringOrganization.
  const datePosted = toIsoDateTime(source.datePosted);
  const org = source.hiringOrganization || {};
  if (!source.title || !source.descriptionHtml || !datePosted || !org.name) return null;
  if (source.descriptionHtml.trim() === source.title.trim()) return null;

  // Expired postings must not keep active markup.
  const validThrough = toIsoDateTime(source.validThrough);
  if (validThrough && Date.parse(validThrough) < now.getTime()) return null;

  // Either-or: jobLocation, or applicantLocationRequirements for fully remote jobs.
  const jobLocation = (source.locations || []).map(buildJobPlace).filter(Boolean);
  const applicantCountries = (source.remoteEligibleCountries || []).map(toCountryCode).filter(Boolean);
  const isRemote = source.fullyRemote === true;
  if (isRemote && !applicantCountries.length && !jobLocation.length) return null; // TELECOMMUTE needs a country
  if (!isRemote && !jobLocation.length) return null;

  // (c) Required + recommended properties, only when the source has them.
  const schema = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: source.title,
    description: source.descriptionHtml,
    datePosted,
    validThrough,
    hiringOrganization: {
      "@type": "Organization",
      name: org.name,
      sameAs: isAbsoluteUrl(org.url) ? org.url : null,
      logo: isAbsoluteUrl(org.logo) ? org.logo : null
    },
    jobLocation,
    jobLocationType: isRemote ? "TELECOMMUTE" : null,
    applicantLocationRequirements: isRemote
      ? applicantCountries.map((code) => ({ "@type": "Country", name: code }))
      : null,
    // (d) Custom rules: enums, salary range, booleans.
    employmentType: (source.employmentTypes || []).filter((t) => EMPLOYMENT_TYPES.includes(t)),
    baseSalary: source.postedByEmployer ? buildBaseSalary(source.salary) : null, // only employers provide baseSalary
    directApply: typeof source.directApply === "boolean" ? source.directApply : null,
    identifier: source.requisitionId && {
      "@type": "PropertyValue",
      name: org.name,
      value: String(source.requisitionId)
    },
    educationRequirements: CREDENTIAL_CATEGORIES.includes(source.education) ? {
      "@type": "EducationalOccupationalCredential",
      credentialCategory: source.education
    } : null,
    experienceRequirements: Number.isInteger(source.monthsOfExperience) && source.monthsOfExperience >= 0 ? {
      "@type": "OccupationalExperienceRequirements",
      monthsOfExperience: source.monthsOfExperience
    } : null,
    experienceInPlaceOfEducation: typeof source.experienceInPlaceOfEducation === "boolean"
      ? source.experienceInPlaceOfEducation
      : null
  };

  // (e) Strip empty values.
  return compact(schema);
}

// Node: const { buildJobPostingSchema } = require('./job-posting-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildJobPostingSchema };
