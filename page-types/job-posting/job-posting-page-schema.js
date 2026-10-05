// Job posting page schema: one open role at one of the store's locations.
// JobPosting with the hiring Organization from the homepage by @id, the work
// location as the same store @id used on the location page, salary and
// expiry, plus the page's WebPage and BreadcrumbList.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

const clean = (v) => (typeof v === 'string' ? v.trim() : v);
const isUrl = (v) => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);
const compact = (obj) => {
  if (Array.isArray(obj)) {
    const out = obj.map(compact).filter((v) => v !== undefined);
    return out.length ? out : undefined;
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = compact(v);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return obj === null || obj === '' ? undefined : obj;
};

function breadcrumb(trail, id) {
  const items = (trail || []).filter((c) => c.name && isUrl(c.url));
  if (items.length < 2) return undefined;
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: clean(c.name), item: c.url })),
  };
}

const EMPLOYMENT = { full_time: 'FULL_TIME', part_time: 'PART_TIME', contract: 'CONTRACTOR', temporary: 'TEMPORARY', intern: 'INTERN', seasonal: 'TEMPORARY' };
const UNIT = { hour: 'HOUR', week: 'WEEK', month: 'MONTH', year: 'YEAR' };

// Pay: a single figure or a range, never a range that runs backwards.
function salary(pay) {
  if (!pay || !CURRENCY.test(pay.currency || '') || !UNIT[pay.per]) return undefined;
  const min = Number(pay.min);
  const max = Number(pay.max);
  let value;
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > min) value = { minValue: min, maxValue: max };
  else if (Number.isFinite(min) && min > 0) value = { value: min };
  else return undefined;
  return { '@type': 'MonetaryAmount', currency: pay.currency, value: { '@type': 'QuantitativeValue', ...value, unitText: UNIT[pay.per] } };
}

function buildJobPostingPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const job = source.job || {};
  const where = job.location || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !job.title || !job.descriptionHtml) return null;
  if (!ISO_DATE.test(job.datePosted || '')) return null;

  // A posting past its closing date is not marked up at all; Google asks for
  // expired jobs to be removed, not left with a past validThrough.
  const today = (source.today || new Date().toISOString()).slice(0, 10);
  if (ISO_DATE.test(job.validThrough || '') && job.validThrough < today) return null;

  // The title is the job title only: no codes, pay, dates or exclamation marks.
  const title = clean(job.title).replace(/\s*[(#].*$/, '').replace(/!+/g, '').trim();

  const remote = job.remoteCountries && job.remoteCountries.length;
  const onsite = where.street && where.city && COUNTRY.test(where.country || '');
  if (!remote && !onsite) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const jobId = `${pageUrl}#job`;

  const posting = compact({
    '@type': 'JobPosting',
    '@id': jobId,
    title,
    description: job.descriptionHtml.trim(),
    identifier: job.reference ? { '@type': 'PropertyValue', name: clean(site.name) || 'Job reference', value: String(job.reference) } : undefined,
    datePosted: job.datePosted,
    validThrough: ISO_DATE.test(job.validThrough || '') ? `${job.validThrough}T23:59:59${job.timezoneOffset || 'Z'}` : undefined,
    employmentType: [].concat(job.employmentType || []).map((t) => EMPLOYMENT[t]).filter(Boolean),
    hiringOrganization: { '@id': `${root}/#organization` },
    // The work site is the store from its location page: same @id, with the
    // address repeated because Google reads jobLocation on its own.
    jobLocation: onsite
      ? {
          '@type': 'Place',
          '@id': isUrl(where.locationPageUrl) ? `${where.locationPageUrl}#location` : undefined,
          name: clean(where.name),
          address: {
            '@type': 'PostalAddress',
            streetAddress: clean(where.street),
            addressLocality: clean(where.city),
            addressRegion: clean(where.region),
            postalCode: clean(where.postalCode),
            addressCountry: where.country,
          },
        }
      : undefined,
    jobLocationType: remote && !onsite ? 'TELECOMMUTE' : undefined,
    applicantLocationRequirements: remote
      ? job.remoteCountries.filter((c) => COUNTRY.test(c)).map((c) => ({ '@type': 'Country', name: c }))
      : undefined,
    baseSalary: salary(job.pay),
    directApply: typeof job.directApply === 'boolean' ? job.directApply : undefined,
    experienceRequirements: Number.isInteger(job.monthsExperience) && job.monthsExperience > 0
      ? { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: job.monthsExperience }
      : undefined,
    experienceInPlaceOfEducation: job.monthsExperience > 0 ? true : undefined,
  });

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || title,
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: { '@id': jobId },
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, posting].filter(Boolean) };
}

// Node: const { buildJobPostingPageSchema } = require('./job-posting-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildJobPostingPageSchema };
