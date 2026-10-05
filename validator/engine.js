// SchemaCDN structured data validator.
// Validates one JSON-LD object against Google Search Central rich result requirements:
// general rules, every matching feature spec (required, recommended, value types, enums,
// lengths, ranges, either-or rules, nested objects) and feature-specific custom checks.
// Runs unchanged in the browser and in Supabase Edge Functions (Deno).

import SPECS from './specs.js';
import { typesOf, isA, anyIsA, normType, isKnownType } from './types.js';
import { CUSTOM_CHECKS } from './checks.js';
import { isAbsUrl, isIsoDate, isIsoDateTime, isIsoTime, isIsoDuration, hasTimezone, toNumber, normEnum, asArray, isPresent, isObj } from './util.js';

const BY_SLUG = Object.fromEntries(SPECS.specs.map((s) => [s.slug, s]));
const MAX_DEPTH = 7;

// ---------------------------------------------------------------- feature selection

const has = (o, k) => isPresent(o?.[k]);
const exact = (types, list) => types.some((t) => list.includes(t));

/** Which feature specs apply to an object, with the reason. Order = display order. */
export function featuresFor(obj) {
  const T = typesOf(obj);
  const out = [];
  const add = (slug, why) => BY_SLUG[slug] && !out.some((f) => f.slug === slug) && out.push({ spec: BY_SLUG[slug], why });

  if (exact(T, ['DiscussionForumPosting', 'SocialMediaPosting'])) add('discussion-forum', 'type');
  else if (anyIsA(T, 'Article')) add('article', 'type');
  if (exact(T, ['BreadcrumbList'])) add('breadcrumb', 'type');
  if (exact(T, ['ItemList']) && carouselItemType(obj)) add('carousel', 'ItemList of supported items');
  if (anyIsA(T, 'Course')) add('course', 'type');
  if (anyIsA(T, 'Dataset')) add('dataset', 'type');
  if (anyIsA(T, 'ProfilePage')) add('profile-page', 'type');
  if (anyIsA(T, 'Event')) add('event', 'type');
  if (anyIsA(T, 'JobPosting')) add('job-posting', 'type');
  if (exact(T, ['VacationRental'])) add('vacation-rental', 'type');
  else if (anyIsA(T, 'LocalBusiness')) add('local-business', 'type');
  else if (anyIsA(T, 'Organization')) add('organization', 'type');
  if (anyIsA(T, 'MerchantReturnPolicy')) add('return-policy', 'type');
  if (exact(T, ['ShippingService'])) add('shipping-policy', 'type');
  if (exact(T, ['MemberProgram'])) add('loyalty-program', 'type');
  if (exact(T, ['EmployerAggregateRating'])) add('employer-rating', 'type');
  if (exact(T, ['WebSite'])) {
    add('site-name', 'type');
    if (asArray(obj.potentialAction).some((a) => anyIsA(typesOf(a), 'SearchAction'))) add('sitelinks-searchbox', 'potentialAction SearchAction');
  }
  if (exact(T, ['ProductGroup'])) add('product-variants', 'type');
  if (anyIsA(T, 'Product') && !exact(T, ['ProductGroup'])) {
    add('product-snippet', 'type');
    const offers = asArray(obj.offers).filter(isObj);
    if (offers.length && offers.some((o) => !exact(typesOf(o), ['AggregateOffer']))) add('merchant-listing', 'offers present');
  }
  if (exact(T, ['Review', 'AggregateRating', 'CriticReview', 'UserReview'])) add('review-snippet', 'type');
  if (anyIsA(T, 'SoftwareApplication')) add('software-app', 'type');
  const bookActions = (o) => asArray(o?.potentialAction).some((a) => exact(typesOf(a), ['ReadAction', 'BorrowAction']));
  if (anyIsA(T, 'Book') && (bookActions(obj) || asArray(obj.workExample).some(bookActions))) add('book', 'ReadAction or BorrowAction');
  if (anyIsA(T, 'Recipe')) add('recipe', 'type');
  if (anyIsA(T, 'VideoObject')) {
    add('video', 'type');
    if (has(obj, 'hasPart') || asArray(obj.potentialAction).some((a) => exact(typesOf(a), ['SeekToAction']))) add('video-key-moments', 'Clip or SeekToAction');
    if (has(obj, 'publication')) add('video-live-badge', 'publication present');
    if (exact(T, ['LearningResource'])) add('learning-video', 'co-typed LearningResource');
  }
  if (anyIsA(T, 'Movie')) add('movie-carousel', 'type');
  if (exact(T, ['ImageObject']) && ['license', 'acquireLicensePage', 'creditText', 'copyrightNotice', 'creator'].some((k) => has(obj, k))) add('image-license-metadata', 'license fields present');
  if (has(obj, 'speakable')) add('speakable', 'speakable present');
  // Paywall markup is only meaningful when content is marked as not free (true is plain licensing metadata).
  if (has(obj, 'isAccessibleForFree') && /^false$/i.test(String(obj.isAccessibleForFree))) add('paywalled-content', 'isAccessibleForFree is false');
  if (exact(T, ['MathSolver'])) add('math-solver', 'type');
  if (exact(T, ['Quiz'])) add('education-qa', 'type');
  if (anyIsA(T, 'QAPage')) add('qapage', 'type');
  if (exact(T, ['ClaimReview'])) add('factcheck', 'type');
  if (exact(T, ['FAQPage'])) add('faqpage', 'type');
  if (exact(T, ['HowTo'])) add('how-to', 'type');
  if (exact(T, ['Occupation', 'OccupationAggregationByEmployer'])) add('estimated-salary', 'type');
  if (exact(T, ['SpecialAnnouncement'])) add('special-announcements', 'type');
  if (anyIsA(T, 'Vehicle')) add('vehicle-listing', 'type');
  return out;
}

function carouselItemType(list) {
  const items = asArray(list.itemListElement).filter(isObj);
  const t = items.flatMap((li) => typesOf(li.item));
  return t.find((x) => ['Course', 'Movie', 'Recipe', 'Restaurant'].includes(x)) || null;
}

// ---------------------------------------------------------------- value checks

const looseTypes = new Set(['Thing', 'Intangible', 'StructuredValue', 'CreativeWork']);

function valueMatches(v, expects, ctx) {
  // Returns null if OK, otherwise a short reason.
  if (!expects || !expects.length) return null;
  const reasons = [];
  for (const e of expects) {
    switch (e) {
      case 'Text':
        if (typeof v === 'string' || typeof v === 'number') return null;
        if (isObj(v) && !typesOf(v).length && !v['@id']) return null; // language maps and similar
        reasons.push('text'); break;
      case 'URL':
        if (typeof v === 'string' && isAbsUrl(v)) return null;
        if (isObj(v) && (isAbsUrl(v.url) || isAbsUrl(v['@id']) || isAbsUrl(v.contentUrl))) return null;
        reasons.push(typeof v === 'string' ? 'an absolute URL (https://...)' : 'a URL'); break;
      case 'ImageObject':
        if (typeof v === 'string' && isAbsUrl(v)) return null;
        if (isObj(v) && (isAbsUrl(v.url) || isAbsUrl(v.contentUrl) || (v['@id'] && ctx.resolves(v)))) return null;
        reasons.push('an image URL or ImageObject with url'); break;
      case 'Date':
        if (typeof v === 'string' && (isIsoDate(v) || isIsoDateTime(v))) return null;
        reasons.push('an ISO 8601 date (YYYY-MM-DD)'); break;
      case 'DateTime':
        if (typeof v === 'string' && (isIsoDateTime(v) || isIsoDate(v))) return null;
        reasons.push('an ISO 8601 date-time'); break;
      case 'Time':
        if (typeof v === 'string' && (isIsoTime(v) || isIsoDateTime(v))) return null;
        reasons.push('a time (hh:mm or hh:mm:ss)'); break;
      case 'Duration':
        if (typeof v === 'string' && isIsoDuration(v)) return null;
        if (isObj(v) && anyIsA(typesOf(v), 'StructuredValue')) return null; // QuantitativeValue durations
        reasons.push('an ISO 8601 duration (for example PT1H30M)'); break;
      case 'Number':
        if (toNumber(v) !== null) return null;
        reasons.push('a number'); break;
      case 'Integer':
        if (Number.isInteger(toNumber(v))) return null;
        reasons.push('a whole number'); break;
      case 'Boolean':
        if (typeof v === 'boolean' || /^(true|false|https?:\/\/schema\.org\/(True|False))$/i.test(String(v))) return null;
        reasons.push('true or false'); break;
      case 'Enum':
        return null; // checked by constraints.enum
      default: {
        if (isObj(v)) {
          const vt = typesOf(v);
          if (!vt.length) {
            if (v['@id'] && !ctx.resolves(v)) return null; // unresolved reference: can't judge
            return null; // untyped object: not wrong for our purposes
          }
          if (vt.some((t) => isA(t, e))) return null;
          if (vt.some((t) => !isKnownType(t)) || looseTypes.has(e)) return null; // unknown subtypes: give benefit of doubt
          reasons.push(`a ${e}`);
        } else if (typeof v === 'string' && (looseTypes.has(e) || ['Brand', 'Organization', 'Person', 'Place', 'Language', 'DefinedTerm', 'Audience', 'Country', 'AdministrativeArea', 'Rating'].includes(e))) {
          reasons.push(`a ${e} object (found plain text)`);
        } else {
          reasons.push(`a ${e}`);
        }
      }
    }
  }
  return reasons.length ? `expected ${[...new Set(reasons)].join(' or ')}` : null;
}

const fmt = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

function checkConstraints(v, c, push, label, isReq) {
  if (!c) return;
  const sev = isReq ? 'error' : 'warning';
  if (c.enum?.length) {
    const ok = c.enum.map(normEnum);
    if (typeof v === 'string' && !ok.includes(normEnum(v))) push(sev, `${label} has value "${fmt(v)}", which is not one of: ${c.enum.map(normEnum).join(', ')}`, 'enum');
  }
  const s = typeof v === 'string' ? v : null;
  if (s !== null && c.maxLength && s.length > c.maxLength) push('warning', `${label} is ${s.length} characters; Google uses at most ${c.maxLength}`, 'length');
  if (s !== null && c.minLength && s.trim().length < c.minLength) push(sev, `${label} is ${s.trim().length} characters; at least ${c.minLength} required`, 'length');
  const n = toNumber(v);
  if (n !== null && typeof c.minValue === 'number' && n < c.minValue) push(sev, `${label} is ${n}; minimum is ${c.minValue}`, 'range');
  if (n !== null && typeof c.maxValue === 'number' && n > c.maxValue) push(sev, `${label} is ${n}; maximum is ${c.maxValue}`, 'range');
  if (s !== null && c.pattern) {
    try { if (!new RegExp(c.pattern).test(s)) push('warning', `${label} "${fmt(s)}" does not match the expected format${c.note ? `: ${c.note}` : ''}`, 'format'); } catch { /* bad regex in spec */ }
  }
  if (c.image) checkImage(v, c.image, push, label);
}

const IMG_EXT = { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', svg: 'SVG', bmp: 'BMP', avif: 'AVIF' };
function checkImage(v, spec, push, label) {
  const url = typeof v === 'string' ? v : (v?.contentUrl || v?.url);
  if (typeof url === 'string') {
    if (/^data:/i.test(url)) push('error', `${label} is a data URI; Google needs a crawlable image URL`, 'image');
    const ext = (url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase();
    if (ext && spec.formats?.length && !IMG_EXT[ext] && !['php', 'aspx', 'jsp'].includes(ext)) push('warning', `${label} uses .${ext}, which Google Images may not support (${spec.formats.join(', ')})`, 'image');
    if (ext && IMG_EXT[ext] && spec.formats?.length && !spec.formats.map((f) => f.toUpperCase()).includes(IMG_EXT[ext].toUpperCase())) push('warning', `${label} format ${IMG_EXT[ext]} is not listed as supported (${spec.formats.join(', ')})`, 'image');
  }
  if (isObj(v)) {
    const w = toNumber(v.width?.value ?? v.width);
    const h = toNumber(v.height?.value ?? v.height);
    if (w && h) {
      if (spec.minWidthPx && w < spec.minWidthPx) push('warning', `${label} is ${w}px wide; at least ${spec.minWidthPx}px recommended`, 'image');
      if (spec.minPixels && w * h < spec.minPixels) push('warning', `${label} is ${w}x${h} (${(w * h).toLocaleString('en-US')} pixels); at least ${spec.minPixels.toLocaleString('en-US')} pixels needed`, 'image');
      if (spec.aspectRatios?.length) {
        const r = w / h;
        const match = spec.aspectRatios.some((a) => { const [x, y] = a.split('x').map(Number); return x && y && Math.abs(r - x / y) / (x / y) < 0.03; });
        if (!match) push('info', `${label} aspect ratio is ${(r).toFixed(2)}; Google prefers ${spec.aspectRatios.join(', ')}`, 'image');
      }
    }
  }
}

// ---------------------------------------------------------------- spec walking

function walk(obj, objSpec, path, ctx, F, depth) {
  if (!objSpec || depth > MAX_DEPTH || !isObj(obj)) return;
  const skipRequired = new Set(F.skipRequired?.(obj, path) || []);
  const anyOfProps = new Set((objSpec.anyOf || []).flatMap((a) => a.props));

  for (const p of objSpec.properties || []) {
    const label = path ? `${path}.${p.name}` : p.name;
    if (p.appliesTo && !p.appliesTo.some((t) => anyIsA(typesOf(obj), t))) continue;
    const raw = obj[p.name];
    const isReq = p.level === 'required' && !skipRequired.has(p.name);
    if (!isPresent(raw)) {
      if (anyOfProps.has(p.name)) continue; // members of an either-or group are reported once, by the group
      if (isReq) F.push('error', `Missing required property: ${label}`, 'required', label, p.message);
      else if (p.level === 'recommended' && !skipRequired.has(p.name)) F.push('warning', `Missing recommended property: ${label}`, 'recommended', label, p.message);
      continue;
    }
    F.pass(isReq ? 'Required properties' : p.level === 'optional' ? 'Optional properties' : 'Recommended properties', `${label} is present`, raw);
    const values = asArray(raw);
    if (p.constraints?.minItems && values.length < p.constraints.minItems) F.push(isReq ? 'error' : 'warning', `${label} has ${values.length} item(s); at least ${p.constraints.minItems} needed`, 'count', label);
    for (const [i, v0] of values.entries()) {
      const v = ctx.resolve(v0);
      const at = values.length > 1 ? `${label}[${i}]` : label;
      if (v === null || v === undefined || v === '') { F.push(isReq ? 'error' : 'warning', `${at} is empty`, 'empty', at); continue; }
      const bad = valueMatches(v, p.expects, ctx);
      if (bad) F.push(isReq ? 'error' : 'warning', `${at}: ${bad}`, 'type', at, `Found ${fmt(v)}`);
      checkConstraints(v, p.constraints, (sev, msg, code) => F.push(sev, msg, code, at), at, isReq);
      if (p.nested && isObj(v) && !(v['@id'] && Object.keys(v).length <= 2 && !ctx.resolves(v))) walk(v, p.nested, at, ctx, F, depth + 1);
    }
  }
  for (const a of objSpec.anyOf || []) {
    if (!a.props.some((k) => isPresent(obj[k]))) {
      F.push(a.level === 'required' ? 'error' : 'warning', a.message || `Include one of: ${a.props.map((k) => (path ? `${path}.${k}` : k)).join(', ')}`, 'anyOf', path || a.props.join('|'));
    }
  }
}

// ---------------------------------------------------------------- general rules

const URL_KEYS = new Set(['url', 'image', 'logo', 'sameAs', 'item', 'contentUrl', 'embedUrl', 'thumbnailUrl', 'acquireLicensePage', 'license', 'mainEntityOfPage', 'hasMap', 'downloadUrl', 'installUrl', 'merchantReturnLink', 'usageInfo', 'applicationContact', 'urlTemplate']);
const DATE_KEYS = new Set(['startDate', 'endDate', 'previousStartDate', 'datePublished', 'dateModified', 'dateCreated', 'uploadDate', 'datePosted', 'expires', 'priceValidUntil', 'validFrom', 'validThrough', 'availabilityStarts', 'availabilityEnds', 'birthDate', 'foundingDate', 'dissolutionDate', 'releaseDate']);
const PLACEHOLDER = /(lorem ipsum|\bTODO\b|\bTBD\b|\{\{.*\}\}|\$\{[^}]*\}|\[object Object\]|^undefined$|^null$|^NaN$|example\.com|your (business|company) name)/i;
const HTML_TAG = /<\/?(p|div|span|br|a|strong|em|b|i|ul|li|h[1-6]|img)\b[^>]*>/i;

function generalChecks(obj, ctx, push) {
  const ctxVal = obj['@context'];
  const ctxStr = JSON.stringify(ctxVal || '');
  if (!ctxVal) push('error', 'Missing @context; JSON-LD must declare "@context": "https://schema.org"', 'context', '@context');
  else if (ctxVal && /data-vocabulary\.org/i.test(ctxStr)) push('error', 'data-vocabulary.org is no longer supported for rich results; use https://schema.org', 'context', '@context');
  else if (ctxVal && !/schema\.org/i.test(ctxStr)) push('error', `@context ${fmt(ctxVal)} does not reference schema.org`, 'context', '@context');

  const T = typesOf(obj);
  if (!T.length) push('error', 'Missing @type; every item must declare a schema.org type', 'type', '@type');
  for (const t of T) if (!/^[A-Z0-9][A-Za-z0-9]*$/.test(t)) push('warning', `@type "${t}" does not look like a schema.org type name (types are PascalCase, for example LocalBusiness)`, 'type', '@type');

  // Walk every value once for format problems that apply to any type.
  const seen = new WeakSet();
  const visit = (v, key, path, depth) => {
    if (depth > 10 || v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach((x, i) => visit(x, key, `${path}[${i}]`, depth + 1)); return; }
    if (isObj(v)) {
      if (seen.has(v)) return;
      seen.add(v);
      for (const [k, x] of Object.entries(v)) if (k !== '@context') visit(x, k, path ? `${path}.${k}` : k, depth + 1);
      return;
    }
    if (typeof v !== 'string') return;
    const s = v.trim();
    if (!s) { push('warning', `${path} is an empty string; remove it or give it a value`, 'empty', path); return; }
    if (PLACEHOLDER.test(s) && !/example\.com/i.test(ctx.pageUrl || '')) push('warning', `${path} looks like placeholder text: "${fmt(s)}"`, 'placeholder', path);
    if (URL_KEYS.has(key) && !/^(https?:)?\/\//i.test(s) && !/^data:/i.test(s) && (/^\//.test(s) || /^[\w-]+\.(html?|php|aspx?)$/i.test(s) || /^www\./i.test(s))) push('warning', `${path} is a relative URL ("${fmt(s)}"); use an absolute URL`, 'url', path);
    if (URL_KEYS.has(key) && /^http:\/\//i.test(s) && /^https:/i.test(ctx.pageUrl || '')) push('info', `${path} uses http:// on an https site`, 'url', path);
    if (DATE_KEYS.has(key)) {
      if (!isIsoDate(s) && !isIsoDateTime(s)) push('error', `${path} "${fmt(s)}" is not an ISO 8601 date or date-time`, 'date', path);
      else if (/T\d/.test(s) && !hasTimezone(s)) push('warning', `${path} has a time but no timezone offset; Google will assume one`, 'timezone', path);
    }
    if (HTML_TAG.test(s) && ['name', 'headline', 'alternativeHeadline', 'title', 'caption'].includes(key)) push('warning', `${path} contains HTML tags; use plain text`, 'html', path);
  };
  visit(obj, '', '', 0);

  // Unresolved @id references to nodes that should be on the page.
  if (ctx.idIndex.size) {
    const refs = [];
    const collect = (v, depth) => {
      if (depth > 8 || !v) return;
      if (Array.isArray(v)) return v.forEach((x) => collect(x, depth + 1));
      if (isObj(v)) {
        if (v['@id'] && Object.keys(v).length === 1) refs.push(v['@id']);
        else Object.entries(v).forEach(([k, x]) => k !== '@id' && collect(x, depth + 1));
      }
    };
    collect(obj, 0);
    const missing = [...new Set(refs)].filter((id) => !ctx.idIndex.has(id));
    if (missing.length) push('info', `References ${missing.length} @id node(s) not defined on this page (${missing.slice(0, 3).map(fmt).join(', ')}${missing.length > 3 ? ', ...' : ''}); Google can only connect them if they are defined somewhere it crawls`, 'reference', '@id');
  }
}

// ---------------------------------------------------------------- public API

/**
 * Validate one structured data object.
 * @param {object} obj           JSON-LD object (a single node; split @graph before calling, or pass it whole)
 * @param {object} [opts]
 * @param {string} [opts.pageUrl]   URL of the page the markup lives on
 * @param {object[]} [opts.siblings] other JSON-LD nodes on the same page, used to resolve @id references
 * @param {Date}   [opts.now]
 */
export function validateSchema(obj, opts = {}) {
  const now = opts.now || new Date();
  if (isObj(obj) && Array.isArray(obj['@graph'])) {
    const nodes = obj['@graph'].map((n) => ({ '@context': obj['@context'], ...n }));
    const results = nodes.map((n) => validateSchema(n, { ...opts, siblings: [...(opts.siblings || []), ...nodes] }));
    return mergeResults(results, typesOf(obj).join(', ') || '@graph');
  }

  const idIndex = new Map();
  for (const s of [...(opts.siblings || []), obj]) indexIds(s, idIndex, 0);
  const ctx = {
    pageUrl: opts.pageUrl || '',
    now,
    idIndex,
    resolves: (v) => isObj(v) && v['@id'] && idIndex.has(v['@id']),
    resolve: (v) => (isObj(v) && v['@id'] && Object.keys(v).length <= 2 && idIndex.has(v['@id']) ? { ...idIndex.get(v['@id']), ...v } : v),
  };

  const errors = [];
  const warnings = [];
  const notices = [];
  const passedChecks = [];
  const features = [];
  const manualChecks = [];

  const pushTo = (bucket) => (severity, message, code, path, detail) => {
    const item = { severity, message, code, path: path || '', detail: detail || '', ...bucket };
    if (severity === 'error') errors.push(item);
    else if (severity === 'warning') warnings.push(item);
    else notices.push(item);
    return item;
  };

  if (!isObj(obj)) {
    errors.push({ severity: 'error', message: 'Structured data must be a JSON object', code: 'shape', path: '' });
    return finish();
  }

  generalChecks(obj, ctx, pushTo({ feature: 'General', featureSlug: 'general' }));
  if (typesOf(obj).length) passedChecks.push({ category: 'Core structure', check: '@type is present', value: typesOf(obj).join(', ') });
  if (obj['@context']) passedChecks.push({ category: 'Core structure', check: '@context references schema.org', value: typeof obj['@context'] === 'string' ? obj['@context'] : 'schema.org' });

  for (const { spec, why } of featuresFor(obj)) {
    const fe = { feature: spec.feature, featureSlug: spec.slug };
    const before = { e: errors.length, w: warnings.length };
    const deprecated = spec.status === 'deprecated';
    const push = (sev, ...rest) => pushTo(fe)(deprecated && sev === 'error' ? 'info' : sev, ...rest);
    const F = {
      push,
      pass: (cat, check, value) => passedChecks.push({ category: `${spec.feature}: ${cat}`, check, value: typeof value === 'string' ? value : Array.isArray(value) ? `${value.length} value(s)` : 'object' }),
      skipRequired: spec.slug === 'return-policy' ? (o) => (isPresent(o.merchantReturnLink) ? ['applicableCountry', 'returnPolicyCategory'] : ['merchantReturnLink']) : null,
    };
    if (deprecated) push('info', `${spec.feature} rich results are no longer shown in Google Search. ${spec.statusNote || ''}`.trim(), 'deprecated', '');
    else if (spec.status === 'limited' && spec.statusNote) push('info', `${spec.feature} is limited: ${spec.statusNote}`, 'limited', '');

    walk(obj, spec.entity, '', ctx, F, 0);

    for (const c of spec.customChecks || []) {
      const impl = CUSTOM_CHECKS[c.id];
      if (impl) {
        try { impl(obj, { ...ctx, push: (sev, msg, path, detail) => push(sev || c.level, msg, c.id, path, detail), spec, check: c }); }
        catch (e) { /* a check bug must never break validation */ }
      } else if (!deprecated && c.level !== 'info') {
        manualChecks.push({ feature: spec.feature, id: c.id, description: c.description });
      }
    }

    const fErrors = errors.slice(before.e).filter((x) => x.featureSlug === spec.slug).length;
    const fWarnings = warnings.slice(before.w).filter((x) => x.featureSlug === spec.slug).length;
    features.push({
      feature: spec.feature,
      slug: spec.slug,
      docUrl: spec.docUrl,
      status: spec.status,
      statusNote: spec.statusNote || '',
      matchedBecause: why,
      eligible: !deprecated && fErrors === 0,
      errors: fErrors,
      warnings: fWarnings,
    });
  }

  return finish();

  function finish() {
    dedupe(errors); dedupe(warnings); dedupe(notices);
    const valid = errors.length === 0;
    return {
      success: true,
      valid,
      hasWarnings: warnings.length > 0,
      errors,
      warnings,
      notices,
      passedChecks,
      features,
      richResultEligible: features.filter((f) => f.eligible).map((f) => f.feature),
      manualChecks,
      schemaType: typesOf(obj).join(', ') || 'Unknown',
      timestamp: new Date().toISOString(),
      validationType: 'google-rich-results',
      specVersion: '2026-10-04',
    };
  }
}

function indexIds(v, map, depth) {
  if (depth > 8 || !v) return;
  if (Array.isArray(v)) return v.forEach((x) => indexIds(x, map, depth + 1));
  if (!isObj(v)) return;
  if (v['@id'] && Object.keys(v).length > 1 && !map.has(v['@id'])) map.set(v['@id'], v);
  if (Array.isArray(v['@graph'])) indexIds(v['@graph'], map, depth + 1);
  for (const [k, x] of Object.entries(v)) if (k !== '@graph' && (isObj(x) || Array.isArray(x))) indexIds(x, map, depth + 1);
}

function dedupe(list) {
  const seen = new Set();
  const keep = list.filter((x) => {
    const k = `${x.featureSlug}|${x.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  list.splice(0, list.length, ...keep);
}

function mergeResults(results, schemaType) {
  const cat = (k) => results.flatMap((r) => r[k] || []);
  const features = cat('features');
  return {
    success: true,
    valid: results.every((r) => r.valid),
    hasWarnings: results.some((r) => r.hasWarnings),
    errors: cat('errors'), warnings: cat('warnings'), notices: cat('notices'),
    passedChecks: cat('passedChecks'), features,
    richResultEligible: features.filter((f) => f.eligible).map((f) => f.feature),
    manualChecks: cat('manualChecks'),
    schemaType,
    timestamp: new Date().toISOString(),
    validationType: 'google-rich-results',
    specVersion: '2026-10-04',
  };
}

/** Validate every node on a page at once (resolves @id references across them). */
export function validatePage(nodes, opts = {}) {
  const flat = nodes.flatMap((n) => (isObj(n) && Array.isArray(n['@graph']) ? n['@graph'].map((g) => ({ '@context': n['@context'], ...g })) : [n]));
  return flat.map((n) => ({ node: n, result: validateSchema(n, { ...opts, siblings: flat }) }));
}

export const specList = () => SPECS.specs.map((s) => ({ feature: s.feature, slug: s.slug, status: s.status, statusNote: s.statusNote, docUrl: s.docUrl, triggerTypes: s.triggerTypes }));
export { featuresFor as _featuresFor, normType };
