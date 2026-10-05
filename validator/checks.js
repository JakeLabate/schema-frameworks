// Feature-specific rules from the Google docs that need code, keyed by the check id in specs.js.
// Each check receives (obj, ctx) and reports through ctx.push(severity?, message, path?, detail?).
// When severity is omitted the level from the spec is used. Checks that need the live page
// (robots.txt, CSS selectors, image pixel sizes) are not here; they surface as manual checks.

import { typesOf, isA, anyIsA } from './types.js';
import { asArray, isObj, isPresent, isAbsUrl, isIsoDate, isIsoDateTime, isIsoDuration, hasTimezone, parseDate, durationSeconds, toNumber, normEnum, text, nameOf } from './util.js';

const T = (o) => typesOf(o);
const items = (list) => asArray(list?.itemListElement).filter(isObj);
const num = toNumber;
const past = (s, now) => { const d = parseDate(s); return d && d < now; };
const before = (a, b) => { const x = parseDate(a); const y = parseDate(b); return x && y && x > y; };
const PROMO = /(\d+\s?%\s?off|\bsale\b|\bdiscount\b|\bfree shipping\b|\bbuy now\b|\bbest\b|\btop\b|\$\s?\d|€\s?\d|£\s?\d)/i;
const HONORIFIC = /^(dr|mr|mrs|ms|prof)\.?\s|posted by|written by|\b(ceo|editor|staff writer|reporter|founder)\b/i;
const ISO_4217 = /^[A-Z]{3}$/;
const ISO_COUNTRY = /^[A-Z]{2,3}$/;

function positionsSequential(list, ctx, label) {
  const pos = items(list).map((li) => num(li.position));
  if (!pos.length) return;
  if (pos.some((p) => p === null)) { ctx.push(undefined, `${label}: every ListItem needs a numeric position`, 'itemListElement'); return; }
  const sorted = [...pos].sort((a, b) => a - b);
  const ok = sorted[0] === 1 && sorted.every((p, i) => p === i + 1);
  if (!ok) ctx.push(undefined, `${label}: positions must start at 1 and increase by 1 (found ${pos.join(', ')})`, 'itemListElement.position');
}

function ratingRange(r, ctx, path) {
  if (!isObj(r)) return;
  const v = r.ratingValue;
  const best = num(r.bestRating) ?? 5;
  const worst = num(r.worstRating) ?? 1;
  if (typeof v === 'string' && /,/.test(v)) ctx.push('error', `${path}.ratingValue "${v}" uses a comma; use a dot as the decimal separator`, `${path}.ratingValue`);
  const n = num(v);
  if (n !== null && (n < worst || n > best)) ctx.push('error', `${path}.ratingValue ${n} is outside ${worst} to ${best} (worstRating to bestRating)`, `${path}.ratingValue`);
  if (num(r.bestRating) !== null && num(r.worstRating) !== null && num(r.worstRating) >= num(r.bestRating)) ctx.push('error', `${path}.worstRating must be lower than bestRating`, path);
}

function reviewAuthor(rv, ctx, path) {
  const a = asArray(rv.author)[0];
  const n = nameOf(a);
  if (!a) return;
  if (!n) ctx.push('error', `${path}.author needs a name`, `${path}.author`);
  else if (n.length >= 100) ctx.push('error', `${path}.author.name must be under 100 characters`, `${path}.author.name`);
  else if (PROMO.test(n)) ctx.push('error', `${path}.author.name "${n}" is not a valid person or organization name`, `${path}.author.name`);
}

function reviewSnippetNested(obj, ctx) {
  asArray(obj.review).filter(isObj).forEach((rv, i) => {
    const p = asArray(obj.review).length > 1 ? `review[${i}]` : 'review';
    if (!isPresent(rv.author)) ctx.push('error', `${p}.author is required`, `${p}.author`);
    reviewAuthor(rv, ctx, p);
    if (!isObj(rv.reviewRating) || !isPresent(rv.reviewRating.ratingValue)) ctx.push('error', `${p}.reviewRating.ratingValue is required`, `${p}.reviewRating`);
    else ratingRange(rv.reviewRating, ctx, `${p}.reviewRating`);
  });
  const ar = obj.aggregateRating;
  if (isObj(ar)) {
    if (!isPresent(ar.ratingValue)) ctx.push('error', 'aggregateRating.ratingValue is required', 'aggregateRating');
    if (!isPresent(ar.ratingCount) && !isPresent(ar.reviewCount)) ctx.push('error', 'aggregateRating needs ratingCount or reviewCount', 'aggregateRating');
    ratingRange(ar, ctx, 'aggregateRating');
  }
}

const dateOrder = (a, b, msg) => (obj, ctx) => { if (before(obj[a], obj[b])) ctx.push(undefined, msg, b); };

export const CUSTOM_CHECKS = {
  // ------------------------------------------------------------------ Article
  article_author_name_clean(obj, ctx) {
    asArray(obj.author).forEach((a) => { const n = nameOf(a); if (n && (HONORIFIC.test(n) || /https?:\/\//.test(n))) ctx.push(undefined, `author name "${n}" should contain only the name (no titles, roles, URLs or "posted by")`, 'author.name'); });
  },
  article_author_type(obj, ctx) {
    asArray(obj.author).forEach((a) => {
      if (typeof a === 'string') ctx.push(undefined, `author "${a}" is plain text; use a Person or Organization object with name`, 'author');
      else if (isObj(a) && !T(a).length && !a['@id']) ctx.push(undefined, 'author object has no @type; use Person or Organization', 'author');
    });
  },
  article_author_url_or_sameas(obj, ctx) {
    asArray(obj.author).filter(isObj).forEach((a) => { const r = ctx.resolve(a); if (!isPresent(r.url) && !isPresent(r.sameAs)) ctx.push(undefined, `author ${nameOf(r) || ''} should include url or sameAs so Google can identify them`.replace('  ', ' '), 'author.url'); });
  },
  article_date_timezone(obj, ctx) {
    for (const k of ['datePublished', 'dateModified']) { const v = obj[k]; if (typeof v === 'string' && /T\d/.test(v) && !hasTimezone(v)) ctx.push(undefined, `${k} has no timezone offset; Google will use Googlebot's timezone`, k); }
  },
  article_date_order: dateOrder('datePublished', 'dateModified', 'dateModified is earlier than datePublished'),
  article_image_crawlable(obj, ctx) {
    asArray(obj.image).forEach((im) => { const u = typeof im === 'string' ? im : im?.url || im?.contentUrl; if (typeof u === 'string' && /^data:/i.test(u)) ctx.push('error', 'image is a data URI; use a crawlable image URL', 'image'); });
  },

  // ------------------------------------------------------------------ Breadcrumb
  breadcrumb_min_items(obj, ctx) { if (items(obj).length < 2) ctx.push(undefined, `BreadcrumbList has ${items(obj).length} item(s); at least 2 are needed`, 'itemListElement'); },
  breadcrumb_item_optional_last(obj, ctx) {
    const li = items(obj);
    const maxPos = Math.max(...li.map((x) => num(x.position) ?? 0));
    li.forEach((x) => { if ((num(x.position) ?? 0) !== maxPos && !isPresent(x.item)) ctx.push(undefined, `ListItem at position ${x.position} needs item (the URL of that breadcrumb); only the last item may omit it`, 'itemListElement.item'); });
  },
  breadcrumb_name_from_item(obj, ctx) {
    items(obj).forEach((x) => { if (!isPresent(x.name) && !(isObj(x.item) && isPresent(x.item.name))) ctx.push(undefined, `ListItem at position ${x.position} needs a name`, 'itemListElement.name'); });
  },
  breadcrumb_positions(obj, ctx) { positionsSequential(obj, ctx, 'BreadcrumbList'); },
  breadcrumb_item_url_valid(obj, ctx) {
    items(obj).forEach((x) => { const u = typeof x.item === 'string' ? x.item : x.item?.['@id'] || x.item?.url; if (u && !isAbsUrl(u)) ctx.push(undefined, `ListItem at position ${x.position}: item "${u}" must be an absolute URL`, 'itemListElement.item'); });
  },

  // ------------------------------------------------------------------ Carousel
  carousel_supported_type(obj, ctx) {
    const bad = items(obj).flatMap((li) => T(li.item)).filter((t) => !['Course', 'Movie', 'Recipe', 'Restaurant'].includes(t));
    if (bad.length) ctx.push(undefined, `Carousel items must be Course, Movie, Recipe or Restaurant (found ${[...new Set(bad)].join(', ')})`, 'itemListElement.item');
  },
  carousel_same_type(obj, ctx) { const t = new Set(items(obj).flatMap((li) => T(li.item))); if (t.size > 1) ctx.push(undefined, `All carousel items must be the same type (found ${[...t].join(', ')})`, 'itemListElement'); },
  carousel_mode_consistent(obj, ctx) { const li = items(obj); const u = li.filter((x) => isPresent(x.url)).length; const it = li.filter((x) => isObj(x.item)).length; if (u && it) ctx.push(undefined, 'Do not mix the summary pattern (url) and the all-in-one pattern (item) in one list', 'itemListElement'); },
  carousel_positions(obj, ctx) { positionsSequential(obj, ctx, 'ItemList'); },
  carousel_urls_unique_same_domain(obj, ctx) {
    const urls = items(obj).map((x) => x.url).filter((u) => typeof u === 'string');
    if (new Set(urls).size !== urls.length) ctx.push(undefined, 'ListItem urls must be unique', 'itemListElement.url');
    const hosts = new Set(urls.map((u) => { try { return new URL(u).host; } catch { return u; } }));
    if (hosts.size > 1) ctx.push(undefined, `ListItem urls must all be on the same domain (found ${[...hosts].join(', ')})`, 'itemListElement.url');
  },

  // ------------------------------------------------------------------ Course list
  course_name_promotional(obj, ctx) { if (PROMO.test(text(obj.name))) ctx.push(undefined, `Course name "${obj.name}" looks promotional (prices, discounts or superlatives)`, 'name'); },
  course_description_length(obj, ctx) { const d = text(obj.description); if (d.length > 60) ctx.push(undefined, `description is ${d.length} characters; Google shows about 60`, 'description'); },
  course_itemlist_present(obj, ctx) { ctx.push('info', 'Course list rich results need an ItemList of at least three courses on a summary page; a single Course on its own is not shown as a carousel', ''); },

  // ------------------------------------------------------------------ Dataset
  dataset_description_length(obj, ctx) { const n = text(obj.description).length; if (n && (n < 50 || n > 5000)) ctx.push(undefined, `description is ${n} characters; it must be between 50 and 5000`, 'description'); },
  dataset_temporal_iso8601(obj, ctx) {
    const v = text(obj.temporalCoverage);
    if (v && !v.split('/').every((p) => p === '..' || isIsoDate(p) || isIsoDateTime(p) || /^\d{4}(-\d{2})?$/.test(p))) ctx.push(undefined, `temporalCoverage "${v}" should be an ISO 8601 date or interval (start/end)`, 'temporalCoverage');
  },
  dataset_distribution_contenturl(obj, ctx) { asArray(obj.distribution).filter(isObj).forEach((d, i) => { if (!isPresent(d.contentUrl)) ctx.push(undefined, `distribution[${i}] needs contentUrl`, 'distribution.contentUrl'); }); },
  dataset_geoshape_format(obj, ctx) {
    asArray(obj.spatialCoverage).filter(isObj).forEach((sc) => { const g = sc.geo; if (isObj(g) && typeof g.box === 'string' && g.box.trim().split(/[\s,]+/).length !== 4) ctx.push(undefined, 'spatialCoverage.geo.box must be two points: 4 space separated numbers', 'spatialCoverage.geo.box'); });
  },

  // ------------------------------------------------------------------ Discussion forum
  forum_content_or_external(obj, ctx) {
    const external = typeof obj.url === 'string' && ctx.pageUrl && !obj.url.startsWith(ctx.pageUrl.split('#')[0]);
    if (!external && !['text', 'image', 'video'].some((k) => isPresent(obj[k]))) ctx.push(undefined, 'Post needs text, image or video', 'text');
    const walkC = (c, p, d) => asArray(c).filter(isObj).forEach((x, i) => { if (!['text', 'image', 'video'].some((k) => isPresent(x[k]))) ctx.push(undefined, `${p}[${i}] needs text, image or video`, p); if (d < 5) walkC(x.comment, `${p}[${i}].comment`, d + 1); });
    walkC(obj.comment, 'comment', 0);
  },
  forum_interaction_type_enum(obj, ctx) {
    const ok = ['LikeAction', 'DislikeAction', 'ViewAction', 'CommentAction', 'ReplyAction', 'ShareAction'];
    asArray(obj.interactionStatistic).filter(isObj).forEach((s) => { const t = normEnum(isObj(s.interactionType) ? T(s.interactionType)[0] : s.interactionType); if (t && !ok.includes(t)) ctx.push(undefined, `interactionType ${t} is not supported (use ${ok.join(', ')})`, 'interactionStatistic.interactionType'); });
  },
  forum_iso_dates(obj, ctx) { for (const k of ['datePublished', 'dateModified']) if (typeof obj[k] === 'string' && !isIsoDateTime(obj[k]) && !isIsoDate(obj[k])) ctx.push(undefined, `${k} must be ISO 8601`, k); },
  forum_headline_duplicate(obj, ctx) { const h = text(obj.headline).trim(); const t = text(obj.text).trim(); if (h && t && (h === t || (t.startsWith(h.replace(/\.{3}$|…$/, '')) && h.length > 20))) ctx.push(undefined, 'headline repeats the start of text; use a real title', 'headline'); },
  forum_comment_count_consistency(obj, ctx) { const n = num(obj.commentCount); const c = asArray(obj.comment).length; if (n !== null && n < c) ctx.push(undefined, `commentCount (${n}) is lower than the ${c} comments marked up`, 'commentCount'); },

  // ------------------------------------------------------------------ Education Q&A
  eduqa_single_accepted_answer(obj, ctx) { asArray(obj.hasPart).filter(isObj).forEach((q, i) => { if (Array.isArray(q.acceptedAnswer) && q.acceptedAnswer.length > 1) ctx.push(undefined, `hasPart[${i}] has ${q.acceptedAnswer.length} acceptedAnswers; use exactly one`, 'hasPart.acceptedAnswer'); }); },
  eduqa_all_flashcard(obj, ctx) { asArray(obj.hasPart).filter(isObj).forEach((q, i) => { const t = text(q.eduQuestionType); if (t && t !== 'Flashcard') ctx.push(undefined, `hasPart[${i}].eduQuestionType is "${t}"; only Flashcard is eligible`, 'hasPart.eduQuestionType'); }); },

  // ------------------------------------------------------------------ Employer rating
  er_count_anyof(obj, ctx) { if (!isPresent(obj.ratingCount) && !isPresent(obj.reviewCount)) ctx.push(undefined, 'Include ratingCount or reviewCount', 'ratingCount'); },
  er_value_in_range(obj, ctx) { ratingRange(obj, ctx, 'rating'); },

  // ------------------------------------------------------------------ Event
  event_previous_start_requires_rescheduled(obj, ctx) { if (isPresent(obj.previousStartDate) && normEnum(obj.eventStatus) !== 'EventRescheduled') ctx.push(undefined, 'previousStartDate is set, so eventStatus must be EventRescheduled', 'eventStatus'); },
  event_location_physical(obj, ctx) {
    const locs = asArray(obj.location).map(ctx.resolve);
    if (locs.length && locs.every((l) => isObj(l) && anyIsA(T(l), 'VirtualLocation'))) ctx.push(undefined, 'Online-only events are not eligible; location needs a Place with an address', 'location');
    locs.filter((l) => isObj(l) && !anyIsA(T(l), 'VirtualLocation')).forEach((l) => { if (!isPresent(l.address)) ctx.push('error', 'location (Place) needs an address', 'location.address'); });
  },
  event_end_after_start: dateOrder('startDate', 'endDate', 'endDate is before startDate'),
  event_startdate_timezone(obj, ctx) { const s = text(obj.startDate); if (/T\d/.test(s) && !hasTimezone(s)) ctx.push(undefined, 'startDate has a time but no UTC offset; Google will use the venue timezone', 'startDate'); },
  event_startdate_midnight(obj, ctx) { if (/T00:00(:00)?/.test(text(obj.startDate))) ctx.push(undefined, 'startDate is midnight, which often means a placeholder; use a date only for all-day events', 'startDate'); },
  event_name_not_venue(obj, ctx) { const loc = ctx.resolve(asArray(obj.location)[0]); if (nameOf(loc) && nameOf(loc).trim().toLowerCase() === text(obj.name).trim().toLowerCase()) ctx.push(undefined, 'Event name is the venue name; use the event title', 'name'); },
  event_name_no_price_url(obj, ctx) { if (/https?:\/\/|[$€£]\s?\d/.test(text(obj.name))) ctx.push(undefined, 'Event name should not contain URLs or prices', 'name'); },
  event_offer_price_currency(obj, ctx) { asArray(obj.offers).filter(isObj).forEach((o) => { if (isPresent(o.price) && !ISO_4217.test(text(o.priceCurrency))) ctx.push(undefined, 'offers.price needs a 3-letter priceCurrency (ISO 4217)', 'offers.priceCurrency'); }); },
  event_status_keep_startdate(obj, ctx) { if (['EventCancelled', 'EventPostponed', 'EventRescheduled'].includes(normEnum(obj.eventStatus)) && !isPresent(obj.startDate)) ctx.push(undefined, 'Keep startDate even when the event is cancelled, postponed or rescheduled', 'startDate'); },

  // ------------------------------------------------------------------ Fact check
  claimreview_single_per_page(obj, ctx) { },
  rating_worst_lt_best(obj, ctx) { ratingRange(obj.reviewRating, ctx, 'reviewRating'); },
  rating_text_present(obj, ctx) { const r = obj.reviewRating; if (isObj(r) && !isPresent(r.alternateName) && !isPresent(r.name)) ctx.push(undefined, 'reviewRating needs alternateName (the verdict text)', 'reviewRating.alternateName'); },

  // ------------------------------------------------------------------ Image license
  imagelicense_creator_name(obj, ctx) { asArray(obj.creator).filter(isObj).forEach((c) => { if (!nameOf(ctx.resolve(c))) ctx.push(undefined, 'creator needs a name', 'creator.name'); }); },
  imagelicense_licensable_badge(obj, ctx) { if (!isPresent(obj.license)) ctx.push('info', 'Add license (and acquireLicensePage) to get the Licensable badge in Google Images', 'license'); },
  imagelicense_url_values(obj, ctx) { for (const k of ['contentUrl', 'license', 'acquireLicensePage']) if (isPresent(obj[k]) && !isAbsUrl(obj[k])) ctx.push(undefined, `${k} must be an absolute URL`, k); },

  // ------------------------------------------------------------------ Job posting
  job_telecommute_country(obj, ctx) {
    if (normEnum(obj.jobLocationType) !== 'TELECOMMUTE') return;
    const fromReq = asArray(obj.applicantLocationRequirements).some((r) => isPresent(r) && (typeof r === 'string' || isPresent(r.name)));
    const fromLoc = asArray(obj.jobLocation).some((l) => isPresent(l?.address?.addressCountry));
    if (!fromReq && !fromLoc) ctx.push(undefined, 'Remote (TELECOMMUTE) jobs need at least one country in applicantLocationRequirements', 'applicantLocationRequirements');
  },
  job_description_not_title(obj, ctx) { if (text(obj.description).trim() && text(obj.description).trim() === text(obj.title).trim()) ctx.push(undefined, 'description can not be the same as title', 'description'); },
  job_description_html_breaks(obj, ctx) { const d = text(obj.description); if (d.length > 300 && !/<(p|br|ul|li)\b|\n/i.test(d)) ctx.push(undefined, 'description is one long block; use <p>, <ul>/<li> or line breaks', 'description'); },
  job_expired(obj, ctx) { if (past(obj.validThrough, ctx.now)) ctx.push(undefined, `validThrough ${obj.validThrough} is in the past; the job is expired and must not keep active markup`, 'validThrough'); },
  job_title_clean(obj, ctx) { const t = text(obj.title); if (/\b(req|job)\s?(id|#|no)\b|#\d{3,}|[$€£]\s?\d|\d{4}-\d{2}-\d{2}|!{2,}|\*{2,}/i.test(t)) ctx.push(undefined, `title "${t}" should be only the job title (no codes, salaries, dates or symbols)`, 'title'); },
  job_salary_range(obj, ctx) {
    const v = obj.baseSalary?.value;
    if (isObj(v)) {
      if (num(v.minValue) !== null && num(v.maxValue) !== null && num(v.minValue) > num(v.maxValue)) ctx.push(undefined, 'baseSalary minValue is higher than maxValue', 'baseSalary.value');
      if (isPresent(v.unitText) && !['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR'].includes(text(v.unitText))) ctx.push(undefined, `baseSalary unitText must be HOUR, DAY, WEEK, MONTH or YEAR (found ${v.unitText})`, 'baseSalary.value.unitText');
    }
  },

  // ------------------------------------------------------------------ Local business
  lb_specific_subtype(obj, ctx) { if (T(obj).includes('LocalBusiness') && T(obj).length === 1) ctx.push(undefined, 'Use the most specific LocalBusiness subtype (for example Dentist, Restaurant, ProfessionalService)', '@type'); },
  lb_geo_precision(obj, ctx) {
    const g = obj.geo;
    if (!isObj(g)) return;
    for (const k of ['latitude', 'longitude']) { const s = String(g[k] ?? ''); if (s && (s.split('.')[1] || '').length < 5) ctx.push(undefined, `geo.${k} ${s} has fewer than 5 decimal places`, `geo.${k}`); }
  },
  lb_price_range_length(obj, ctx) { if (text(obj.priceRange).length >= 100) ctx.push(undefined, 'priceRange is 100+ characters and will not be shown', 'priceRange'); },
  lb_hours_format(obj, ctx) {
    asArray(obj.openingHoursSpecification).filter(isObj).forEach((h, i) => {
      for (const k of ['opens', 'closes']) if (isPresent(h[k]) && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text(h[k])) && text(h[k]) !== '24:00' && text(h[k]) !== '24:00:00') ctx.push(undefined, `openingHoursSpecification[${i}].${k} "${h[k]}" must be hh:mm or hh:mm:ss`, `openingHoursSpecification.${k}`);
      for (const k of ['validFrom', 'validThrough']) if (isPresent(h[k]) && !isIsoDate(text(h[k]))) ctx.push(undefined, `openingHoursSpecification[${i}].${k} must be YYYY-MM-DD`, `openingHoursSpecification.${k}`);
    });
  },
  lb_self_serving_reviews(obj, ctx) { if (isPresent(obj.aggregateRating) || isPresent(obj.review)) ctx.push(undefined, 'Reviews about this business on its own site are self-serving and not eligible for review stars', 'aggregateRating'); },

  // ------------------------------------------------------------------ Loyalty program
  lp_single_url(obj, ctx) { if (Array.isArray(obj.url) && obj.url.length > 1) ctx.push(undefined, 'url must be a single URL', 'url'); },
  lp_points_requires_earned(obj, ctx) { asArray(obj.hasTiers).filter(isObj).forEach((t, i) => { if (asArray(t.hasTierBenefit).some((b) => /TierBenefitLoyaltyPoints/.test(String(b))) && !isPresent(t.membershipPointsEarned)) ctx.push(undefined, `hasTiers[${i}] offers loyalty points but has no membershipPointsEarned`, 'hasTiers.membershipPointsEarned'); }); },
  lp_tier_ids(obj, ctx) { asArray(obj.hasTiers).filter(isObj).forEach((t, i) => { if (!t['@id']) ctx.push('info', `hasTiers[${i}] has no @id, so offers cannot reference it with validForMemberTier`, 'hasTiers.@id'); }); },

  // ------------------------------------------------------------------ Math solver
  mathsolver_type_array(obj, ctx) { const t = T(obj); if (!(t.includes('MathSolver') && t.includes('LearningResource'))) ctx.push(undefined, '@type must be ["MathSolver", "LearningResource"]', '@type'); },
  mathsolver_usageinfo_url(obj, ctx) { if (isPresent(obj.usageInfo) && !isAbsUrl(obj.usageInfo)) ctx.push(undefined, 'usageInfo must be an absolute URL to the privacy policy', 'usageInfo'); },
  mathsolver_homepage(obj, ctx) { try { if (ctx.pageUrl && new URL(ctx.pageUrl).pathname.replace(/\/$/, '') !== '') ctx.push(undefined, 'MathSolver markup belongs on the site home page', ''); } catch { /* no page url */ } },

  // ------------------------------------------------------------------ Merchant listing
  price_gt_zero(obj, ctx) { asArray(obj.offers).filter(isObj).forEach((o) => { const p = num(o.price ?? asArray(o.priceSpecification)[0]?.price); if (p !== null && p <= 0) ctx.push(undefined, `Offer price is ${p}; merchant listings need a price above zero`, 'offers.price'); }); },
  aggregate_offer_not_supported(obj, ctx) { if (asArray(obj.offers).some((o) => T(o).includes('AggregateOffer'))) ctx.push(undefined, 'Merchant listings need Offer, not AggregateOffer (AggregateOffer still works for product snippets)', 'offers'); },
  validity_order(obj, ctx) { asArray(obj.offers).filter(isObj).forEach((o) => { if (before(o.validFrom, o.validThrough) || before(o.validFrom, o.priceValidUntil)) ctx.push(undefined, 'Offer validFrom is after validThrough or priceValidUntil', 'offers.validFrom'); }); },
  price_valid_until_past(obj, ctx) { asArray(obj.offers).filter(isObj).forEach((o) => { if (past(o.priceValidUntil, ctx.now)) ctx.push(undefined, `offers.priceValidUntil ${o.priceValidUntil} is in the past; the listing may not show`, 'offers.priceValidUntil'); }); },
  finite_window_days(obj, ctx) {
    asArray(obj.offers).filter(isObj).forEach((o) => asArray(o.hasMerchantReturnPolicy).filter(isObj).forEach((rp) => { if (normEnum(rp.returnPolicyCategory) === 'MerchantReturnFiniteReturnWindow' && !isPresent(rp.merchantReturnDays)) ctx.push(undefined, 'Return policy has a finite window but no merchantReturnDays', 'offers.hasMerchantReturnPolicy.merchantReturnDays'); }));
  },
  return_shipping_fee_amount(obj, ctx) {
    asArray(obj.offers).filter(isObj).forEach((o) => asArray(o.hasMerchantReturnPolicy).filter(isObj).forEach((rp) => { if (normEnum(rp.returnFees) === 'ReturnShippingFees' && !isPresent(rp.returnShippingFeesAmount)) ctx.push(undefined, 'returnFees is ReturnShippingFees, so returnShippingFeesAmount is required', 'offers.hasMerchantReturnPolicy.returnShippingFeesAmount'); }));
  },
  single_values(obj, ctx) { for (const k of ['brand', 'size', 'inProductGroupWithID', 'subjectOf']) if (Array.isArray(obj[k]) && obj[k].length > 1) ctx.push(undefined, `${k} should have a single value`, k); asArray(obj.offers).filter(isObj).forEach((o) => { for (const k of ['availability', 'itemCondition', 'url']) if (Array.isArray(o[k]) && o[k].length > 1) ctx.push(undefined, `offers.${k} should have a single value`, `offers.${k}`); }); },
  gtin_numeric(obj, ctx) { for (const k of ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14']) asArray(obj[k]).forEach((g) => { const s = String(g).trim(); if (!/^\d{8}$|^\d{12,14}$/.test(s)) ctx.push(undefined, `${k} "${s}" must be 8, 12, 13 or 14 digits`, k); }); },
  sku_whitespace(obj, ctx) { if (/\s/.test(text(obj.sku))) ctx.push(undefined, 'sku must not contain spaces', 'sku'); },
  certification_max(obj, ctx) { if (asArray(obj.hasCertification).length > 10) ctx.push(undefined, 'At most 10 hasCertification entries are used', 'hasCertification'); },
  adult_consideration_value(obj, ctx) { asArray(obj.hasAdultConsideration).forEach((v) => { if (normEnum(v) !== 'SexualContentConsideration') ctx.push(undefined, 'hasAdultConsideration only supports SexualContentConsideration', 'hasAdultConsideration'); }); },
  active_price_shape(obj, ctx) {
    asArray(obj.offers).filter(isObj).forEach((o) => {
      const specs = asArray(o.priceSpecification).filter(isObj);
      if (specs.length && !isPresent(o.price) && !specs.some((s) => !isPresent(s.priceType) && !isPresent(s.validForMemberTier))) ctx.push(undefined, 'No active price: one priceSpecification must have no priceType and no validForMemberTier', 'offers.priceSpecification');
    });
  },
  strikethrough_higher(obj, ctx) {
    asArray(obj.offers).filter(isObj).forEach((o) => {
      const specs = asArray(o.priceSpecification).filter(isObj);
      const active = num(o.price) ?? num(specs.find((s) => !isPresent(s.priceType))?.price);
      const strike = num(specs.find((s) => /StrikethroughPrice|ListPrice/.test(String(s.priceType)))?.price);
      if (active !== null && strike !== null && strike <= active) ctx.push(undefined, `Strikethrough price ${strike} should be higher than the active price ${active}`, 'offers.priceSpecification');
    });
  },

  // ------------------------------------------------------------------ Movie
  movie_itemlist_positions(obj, ctx) { },

  // ------------------------------------------------------------------ Organization
  org_logo_imageobject_url(obj, ctx) { asArray(obj.logo).filter(isObj).forEach((l) => { const r = ctx.resolve(l); if (!isAbsUrl(r.contentUrl) && !isAbsUrl(r.url)) ctx.push(undefined, 'logo ImageObject needs a url or contentUrl', 'logo'); }); },
  org_iso6523_format(obj, ctx) { if (isPresent(obj.iso6523Code) && !/^\d{4}:.+/.test(text(obj.iso6523Code))) ctx.push(undefined, 'iso6523Code should look like ICD:identifier (for example 0199:LEI)', 'iso6523Code'); },
  org_specific_subtype(obj, ctx) { const t = T(obj); if (t.length === 1 && ['Organization', 'OnlineBusiness'].includes(t[0])) ctx.push('info', `Consider a more specific type than ${t[0]} (for example OnlineStore, Corporation or a LocalBusiness subtype)`, '@type'); },
  org_name_matches_site_name(obj, ctx) {
    const site = [...ctx.idIndex.values()].find((n) => T(n).includes('WebSite'));
    if (site && nameOf(site) && nameOf(obj) && nameOf(site).toLowerCase() !== nameOf(obj).toLowerCase() && !asArray(site.alternateName).map(String).map((x) => x.toLowerCase()).includes(nameOf(obj).toLowerCase())) ctx.push(undefined, `Organization name "${nameOf(obj)}" differs from the WebSite name "${nameOf(site)}"`, 'name');
  },

  // ------------------------------------------------------------------ Paywalled content
  paywall_boolean_value(obj, ctx) { const v = obj.isAccessibleForFree; if (!(typeof v === 'boolean' || /^(true|false)$/i.test(String(v)))) ctx.push(undefined, `isAccessibleForFree must be true or false (found ${JSON.stringify(v)})`, 'isAccessibleForFree'); },
  paywall_haspart_when_false(obj, ctx) { if (/^false$/i.test(String(obj.isAccessibleForFree)) && !asArray(obj.hasPart).some((p) => isPresent(p?.cssSelector))) ctx.push(undefined, 'Content is marked not free; add hasPart WebPageElement entries with cssSelector for the paywalled sections', 'hasPart'); },
  paywall_class_selector_only(obj, ctx) { asArray(obj.hasPart).filter(isObj).forEach((p) => { const s = text(p.cssSelector).trim(); if (s && !/^\.[A-Za-z_-][\w-]*$/.test(s)) ctx.push(undefined, `hasPart.cssSelector "${s}" must be a single class selector (for example .paywall)`, 'hasPart.cssSelector'); }); },

  // ------------------------------------------------------------------ Product snippet
  offers_without_rating(obj, ctx) { if (isPresent(obj.offers) && !isPresent(obj.review) && !isPresent(obj.aggregateRating)) ctx.push('info', 'Product has offers but no review or aggregateRating; review stars will not show', 'aggregateRating'); },
  aggregate_offer_props(obj, ctx) { asArray(obj.offers).filter((o) => T(o).includes('AggregateOffer')).forEach((o) => { if (!isPresent(o.lowPrice)) ctx.push(undefined, 'AggregateOffer needs lowPrice', 'offers.lowPrice'); if (!ISO_4217.test(text(o.priceCurrency))) ctx.push(undefined, 'AggregateOffer needs a 3-letter priceCurrency', 'offers.priceCurrency'); }); },
  pros_cons_min_statements(obj, ctx) {
    asArray(obj.review).filter(isObj).forEach((r) => {
      if (!isPresent(r.positiveNotes) && !isPresent(r.negativeNotes)) return;
      const n = items(r.positiveNotes).length + items(r.negativeNotes).length;
      if (n < 2) ctx.push(undefined, 'Pros and cons need at least two statements in total', 'review.positiveNotes');
    });
  },
  review_snippet_rules: reviewSnippetNested,
  price_and_pricespec_both(obj, ctx) { },

  // ------------------------------------------------------------------ Product variants
  unique_variant_ids(obj, ctx) {
    const ids = asArray(obj.hasVariant).map(ctx.resolve).filter(isObj).map((v) => text(v.sku) || text(v.gtin) || text(v.gtin13)).filter(Boolean);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    if (dup.length) ctx.push(undefined, `Variants share the same sku/gtin: ${[...new Set(dup)].join(', ')}`, 'hasVariant.sku');
  },
  group_id_present(obj, ctx) {
    const gid = text(obj.productGroupID);
    const variantIds = asArray(obj.hasVariant).map(ctx.resolve).filter(isObj).map((v) => text(v.inProductGroupWithID)).filter(Boolean);
    if (!gid && !variantIds.length) ctx.push(undefined, 'Give the group an ID with productGroupID (or inProductGroupWithID on the variants)', 'productGroupID');
    if (gid && variantIds.some((v) => v !== gid)) ctx.push(undefined, 'Variant inProductGroupWithID does not match productGroupID', 'hasVariant.inProductGroupWithID');
  },
  varies_by_props_present(obj, ctx) {
    const map = { color: 'color', size: 'size', suggestedAge: 'suggestedAge', suggestedGender: 'suggestedGender', material: 'material', pattern: 'pattern' };
    const by = asArray(obj.variesBy).map((v) => normEnum(v)).filter((v) => map[v]);
    asArray(obj.hasVariant).map(ctx.resolve).filter(isObj).forEach((v, i) => by.forEach((k) => { if (!isPresent(v[map[k]]) && !isPresent(v.audience?.[map[k]])) ctx.push(undefined, `hasVariant[${i}] is missing ${k}, which the group varies by`, `hasVariant.${k}`); }));
  },

  // ------------------------------------------------------------------ Profile page
  profile_interaction_types(obj, ctx) {
    const m = ctx.resolve(obj.mainEntity);
    if (!isObj(m)) return;
    asArray(m.interactionStatistic).filter(isObj).forEach((s) => { const t = normEnum(s.interactionType?.['@type'] || s.interactionType); if (t && !['FollowAction', 'LikeAction', 'BefriendAction'].includes(t)) ctx.push(undefined, `interactionStatistic.interactionType ${t} is not supported`, 'mainEntity.interactionStatistic'); });
    asArray(m.agentInteractionStatistic).filter(isObj).forEach((s) => { const t = normEnum(s.interactionType?.['@type'] || s.interactionType); if (t && !['FollowAction', 'LikeAction', 'WriteAction', 'ShareAction'].includes(t)) ctx.push(undefined, `agentInteractionStatistic.interactionType ${t} is not supported`, 'mainEntity.agentInteractionStatistic'); });
  },
  profile_main_entity_type(obj, ctx) { const m = ctx.resolve(obj.mainEntity); if (isObj(m) && T(m).length && !anyIsA(T(m), 'Person') && !anyIsA(T(m), 'Organization')) ctx.push(undefined, `mainEntity is ${T(m).join(', ')}; it must be a Person or Organization`, 'mainEntity'); },
  profile_date_order: dateOrder('dateCreated', 'dateModified', 'dateModified is earlier than dateCreated'),
  profile_placeholder_image(obj, ctx) { const m = ctx.resolve(obj.mainEntity); asArray(m?.image).forEach((im) => { const u = typeof im === 'string' ? im : im?.url || im?.contentUrl || ''; if (/default|placeholder|avatar-blank|blank-profile|d=mp|mystery/i.test(u)) ctx.push(undefined, 'mainEntity.image looks like a default avatar', 'mainEntity.image'); }); },

  // ------------------------------------------------------------------ Q&A
  qapage_single_question(obj, ctx) { const m = asArray(obj.mainEntity); if (m.length !== 1 || !anyIsA(T(ctx.resolve(m[0])), 'Question')) ctx.push(undefined, 'QAPage needs exactly one Question as mainEntity', 'mainEntity'); },
  qapage_answercount_consistency(obj, ctx) { const q = ctx.resolve(asArray(obj.mainEntity)[0]); if (!isObj(q)) return; const n = num(q.answerCount); const c = asArray(q.acceptedAnswer).length + asArray(q.suggestedAnswer).length; if (n !== null && n < c) ctx.push(undefined, `answerCount (${n}) is lower than the ${c} answers marked up`, 'mainEntity.answerCount'); },
  qapage_full_text(obj, ctx) { const q = ctx.resolve(asArray(obj.mainEntity)[0]); if (!isObj(q)) return; [q, ...asArray(q.acceptedAnswer), ...asArray(q.suggestedAnswer)].filter(isObj).forEach((x) => { if (/(\.\.\.|…)\s*$/.test(text(x.text))) ctx.push(undefined, 'Question and answer text should be the full text, not a truncated excerpt', 'mainEntity.text'); }); },
  qapage_answer_url_unique(obj, ctx) { const q = ctx.resolve(asArray(obj.mainEntity)[0]); if (!isObj(q)) return; const urls = [...asArray(q.acceptedAnswer), ...asArray(q.suggestedAnswer)].map((a) => a?.url).filter(Boolean); if (new Set(urls).size !== urls.length) ctx.push(undefined, 'Each Answer.url should be unique (link to the answer, for example with #fragment)', 'mainEntity.acceptedAnswer.url'); },
  qapage_iso_datetimes(obj, ctx) { },
  qapage_comment_spec(obj, ctx) { },

  // ------------------------------------------------------------------ Recipe
  recipe_howtosection(obj, ctx) { asArray(obj.recipeInstructions).filter((s) => isObj(s) && T(s).includes('HowToSection')).forEach((s, i) => { if (!isPresent(s.name)) ctx.push(undefined, `recipeInstructions[${i}] (HowToSection) needs name`, 'recipeInstructions.name'); if (!isPresent(s.itemListElement)) ctx.push(undefined, `recipeInstructions[${i}] (HowToSection) needs itemListElement steps`, 'recipeInstructions.itemListElement'); }); },
  recipe_calories_requires_yield(obj, ctx) { if (isPresent(obj.nutrition?.calories) && !asArray(obj.recipeYield).some((y) => /\d/.test(String(y)))) ctx.push(undefined, 'nutrition.calories is set, so recipeYield must give the number of servings', 'recipeYield'); },
  recipe_cook_prep_pair(obj, ctx) { if (isPresent(obj.cookTime) !== isPresent(obj.prepTime)) ctx.push(undefined, 'Use cookTime and prepTime together', isPresent(obj.cookTime) ? 'prepTime' : 'cookTime'); },
  recipe_time_present(obj, ctx) { if (!isPresent(obj.totalTime) && !(isPresent(obj.cookTime) && isPresent(obj.prepTime))) ctx.push(undefined, 'Provide totalTime, or both cookTime and prepTime', 'totalTime'); },
  recipe_iso_durations(obj, ctx) { for (const k of ['cookTime', 'prepTime', 'totalTime']) if (isPresent(obj[k]) && !isIsoDuration(text(obj[k]))) ctx.push(undefined, `${k} "${obj[k]}" must be an ISO 8601 duration (for example PT1H30M)`, k); },
  recipe_instructions_no_boilerplate(obj, ctx) { asArray(obj.recipeInstructions).filter(isObj).forEach((s, i) => { if (/^(directions|instructions|step \d+|watch the video)\b/i.test(text(s.text).trim())) ctx.push(undefined, `recipeInstructions[${i}].text starts with boilerplate ("Directions", "Step 1"...)`, 'recipeInstructions.text'); }); },
  recipe_instructions_single_text(obj, ctx) { if (typeof obj.recipeInstructions === 'string') ctx.push(undefined, 'recipeInstructions is one text block; use HowToStep items', 'recipeInstructions'); },
  recipe_keywords_not_category(obj, ctx) { const kw = text(obj.keywords).toLowerCase().split(',').map((s) => s.trim()); const cats = [...asArray(obj.recipeCategory), ...asArray(obj.recipeCuisine)].map((s) => String(s).toLowerCase().trim()); const dup = kw.filter((k) => k && cats.includes(k)); if (dup.length) ctx.push(undefined, `keywords repeat recipeCategory/recipeCuisine (${dup.join(', ')})`, 'keywords'); },
  recipe_single_review_author(obj, ctx) { const r = asArray(obj.review); if (r.length === 1 && isObj(r[0])) reviewAuthor(r[0], ctx, 'review'); },

  // ------------------------------------------------------------------ Return policy
  rp_required_option(obj, ctx) { if (!isPresent(obj.merchantReturnLink) && !(isPresent(obj.applicableCountry) && isPresent(obj.returnPolicyCategory))) ctx.push(undefined, 'Provide applicableCountry and returnPolicyCategory, or merchantReturnLink', 'returnPolicyCategory'); },
  rp_finite_days(obj, ctx) { [obj, ...asArray(obj.returnPolicySeasonalOverride)].filter(isObj).forEach((o) => { if (normEnum(o.returnPolicyCategory) === 'MerchantReturnFiniteReturnWindow' && !isPresent(o.merchantReturnDays)) ctx.push(undefined, 'Finite return window needs merchantReturnDays', 'merchantReturnDays'); }); },
  rp_shipping_fees_amount(obj, ctx) { const f = normEnum(obj.returnFees); if (f === 'ReturnShippingFees' && !isPresent(obj.returnShippingFeesAmount)) ctx.push(undefined, 'returnFees is ReturnShippingFees, so add returnShippingFeesAmount', 'returnShippingFeesAmount'); if (f !== 'ReturnShippingFees' && isPresent(obj.returnShippingFeesAmount)) ctx.push('warning', 'returnShippingFeesAmount is only used when returnFees is ReturnShippingFees', 'returnShippingFeesAmount'); },
  rp_country_limit(obj, ctx) { for (const k of ['applicableCountry', 'returnPolicyCountry']) { const v = asArray(obj[k]); if (v.length > 50) ctx.push(undefined, `${k} lists ${v.length} countries; the limit is 50`, k); v.forEach((c) => { if (typeof c === 'string' && !/^[A-Z]{2}$/.test(c)) ctx.push(undefined, `${k} "${c}" must be a 2-letter ISO 3166-1 code`, k); }); } },
  rp_not_permitted_extras(obj, ctx) { if (normEnum(obj.returnPolicyCategory) === 'MerchantReturnNotPermitted' && ['merchantReturnDays', 'returnFees', 'returnMethod'].some((k) => isPresent(obj[k]))) ctx.push(undefined, 'Returns are not permitted, so return days, fees and method are ignored', 'returnPolicyCategory'); },

  // ------------------------------------------------------------------ Review snippet
  type_split(obj, ctx) {
    if (anyIsA(T(obj), 'Review')) {
      if (!isPresent(obj.author)) ctx.push('error', 'Review needs author', 'author');
      if (!isObj(obj.reviewRating) || !isPresent(obj.reviewRating.ratingValue)) ctx.push('error', 'Review needs reviewRating.ratingValue', 'reviewRating');
      reviewAuthor(obj, ctx, 'review');
    }
    if (T(obj).includes('AggregateRating') && !isPresent(obj.ratingValue)) ctx.push('error', 'AggregateRating needs ratingValue', 'ratingValue');
  },
  aggregate_count(obj, ctx) { if (T(obj).includes('AggregateRating') && !isPresent(obj.ratingCount) && !isPresent(obj.reviewCount)) ctx.push(undefined, 'AggregateRating needs ratingCount or reviewCount', 'ratingCount'); },
  item_reviewed_nested(obj, ctx) {
    const it = ctx.resolve(asArray(obj.itemReviewed)[0]);
    if (!isPresent(obj.itemReviewed)) ctx.push(undefined, 'A standalone Review/AggregateRating needs itemReviewed (or nest it inside the item it rates)', 'itemReviewed');
    else if (isObj(it) && !nameOf(it)) ctx.push(undefined, 'itemReviewed needs a name', 'itemReviewed.name');
  },
  rating_in_range(obj, ctx) { ratingRange(T(obj).includes('AggregateRating') ? obj : obj.reviewRating, ctx, T(obj).includes('AggregateRating') ? 'aggregateRating' : 'reviewRating'); },
  author_name_length(obj, ctx) { if (anyIsA(T(obj), 'Review')) reviewAuthor(obj, ctx, 'review'); },
  self_serving(obj, ctx) { const it = ctx.resolve(asArray(obj.itemReviewed)[0]); if (isObj(it) && anyIsA(T(it), 'Organization')) ctx.push(undefined, 'Reviews of an organization on its own site are self-serving and not eligible for review stars', 'itemReviewed'); },

  // ------------------------------------------------------------------ Shipping policy
  sp_rate_value_xor_max(obj, ctx) { },
  sp_days_whole(obj, ctx) { },

  // ------------------------------------------------------------------ Site name
  sn_url_is_root(obj, ctx) { try { const u = new URL(text(obj.url)); if (u.pathname.replace(/\/$/, '') !== '' || u.search) ctx.push(undefined, `WebSite url ${obj.url} must be the home page (root path) of the domain`, 'url'); } catch { /* url missing is reported elsewhere */ } },
  sn_home_page_only(obj, ctx) { try { if (ctx.pageUrl && new URL(ctx.pageUrl).pathname.replace(/\/$/, '') !== '') ctx.push('info', 'Google only reads WebSite site name markup on the home page; here it has no effect', ''); } catch { /* no page url */ } },
  sn_concise(obj, ctx) { if (/\b(inc|llc|ltd|gmbh|corp|co)\.?$/i.test(text(obj.name).trim())) ctx.push(undefined, `Site name "${obj.name}" includes a legal suffix; keep it short`, 'name'); },

  // ------------------------------------------------------------------ Software app
  currency_if_paid(obj, ctx) { asArray(obj.offers).filter(isObj).forEach((o) => { if ((num(o.price) ?? 0) > 0 && !ISO_4217.test(text(o.priceCurrency))) ctx.push(undefined, 'offers.price is above 0, so a 3-letter priceCurrency is required', 'offers.priceCurrency'); }); },
  videogame_cotype(obj, ctx) { const t = T(obj); if (t.length === 1 && t[0] === 'VideoGame') ctx.push(undefined, 'VideoGame alone is not eligible; co-type it, for example ["VideoGame", "MobileApplication"]', '@type'); },

  // ------------------------------------------------------------------ Speakable
  speakable_selector_exclusive(obj, ctx) { asArray(obj.speakable).filter(isObj).forEach((s) => { if (isPresent(s.cssSelector) && isPresent(s.xpath)) ctx.push(undefined, 'Use cssSelector or xpath in speakable, not both', 'speakable'); }); },

  // ------------------------------------------------------------------ Vacation rental
  single_accommodation(obj, ctx) { const c = asArray(obj.containsPlace).filter(isObj); if (c.length !== 1) ctx.push(undefined, `containsPlace must hold exactly one Accommodation (found ${c.length})`, 'containsPlace'); },
  lat_lng_precision(obj, ctx) { for (const k of ['latitude', 'longitude']) { const s = String(obj[k] ?? obj.geo?.[k] ?? ''); if (s && (s.split('.')[1] || '').length < 5) ctx.push(undefined, `${k} needs at least 5 decimal places`, k); } },
  image_count(obj, ctx) { const n = asArray(obj.image).length; if (n < 8) ctx.push(undefined, `${n} image(s); vacation rentals need at least 8 (bedroom, bathroom, common area)`, 'image'); },
  france_reference_time(obj, ctx) { if (/^FR$/i.test(text(obj.address?.addressCountry))) asArray(obj.review).filter(isObj).forEach((r, i) => { if (!isPresent(r.contentReferenceTime)) ctx.push(undefined, `review[${i}] needs contentReferenceTime (French listings)`, 'review.contentReferenceTime'); }); },
  review_date(obj, ctx) { asArray(obj.review).filter(isObj).forEach((r, i) => { if (!isPresent(r.datePublished)) ctx.push(undefined, `review[${i}] needs datePublished`, 'review.datePublished'); }); },

  // ------------------------------------------------------------------ Video
  video_uploaddate_timezone(obj, ctx) { for (const k of ['uploadDate', 'expires']) { const v = text(obj[k]); if (v && (!/T\d/.test(v) || !hasTimezone(v))) ctx.push(undefined, `${k} should be a date-time with a timezone (for example 2026-10-04T08:00:00+00:00)`, k); } },
  video_duration_iso(obj, ctx) { if (isPresent(obj.duration) && !isIsoDuration(text(obj.duration))) ctx.push(undefined, `duration "${obj.duration}" must be an ISO 8601 duration (for example PT1M33S)`, 'duration'); },
  video_contenturl_not_page(obj, ctx) { const page = (ctx.pageUrl || '').split('#')[0]; for (const k of ['contentUrl', 'embedUrl']) { const v = text(obj[k]); if (v && page && v.split('#')[0] === page) ctx.push(undefined, `${k} must point to the video file or player, not the page itself`, k); if (/^data:/i.test(v)) ctx.push(undefined, `${k} must not be a data URI`, k); } },
  video_region_conflict(obj, ctx) { if (isPresent(obj.ineligibleRegion) && isPresent(obj.regionsAllowed)) ctx.push(undefined, 'Use ineligibleRegion or regionsAllowed, not both', 'regionsAllowed'); },
  video_expires_future(obj, ctx) { if (past(obj.expires, ctx.now)) ctx.push(undefined, `expires ${obj.expires} is in the past; the video will not be shown`, 'expires'); },
  video_author_name(obj, ctx) { for (const k of ['creator', 'author']) asArray(obj[k]).filter(isObj).forEach((a) => { if (!nameOf(ctx.resolve(a))) ctx.push(undefined, `${k} needs a name`, `${k}.name`); }); },
  keymoments_clip_unique_start(obj, ctx) { const s = asArray(obj.hasPart).filter((c) => isObj(c) && T(c).includes('Clip')).map((c) => num(c.startOffset)); if (new Set(s).size !== s.length) ctx.push(undefined, 'Two Clips share the same startOffset', 'hasPart.startOffset'); },
  keymoments_clip_end_after_start(obj, ctx) { asArray(obj.hasPart).filter(isObj).forEach((c, i) => { if (num(c.endOffset) !== null && num(c.startOffset) !== null && num(c.endOffset) <= num(c.startOffset)) ctx.push(undefined, `hasPart[${i}] endOffset must be after startOffset`, 'hasPart.endOffset'); }); },
  keymoments_min_duration(obj, ctx) { const s = durationSeconds(text(obj.duration)); if (s !== null && s < 30) ctx.push(undefined, 'Videos under 30 seconds are not eligible for key moments', 'duration'); },
  keymoments_requires_base_video(obj, ctx) { const miss = ['name', 'thumbnailUrl', 'uploadDate'].filter((k) => !isPresent(obj[k])); if (miss.length) ctx.push(undefined, `Key moments need the base video properties: ${miss.join(', ')}`, miss[0]); },
  keymoments_clip_url_same_path(obj, ctx) {
    const page = ctx.pageUrl;
    if (!page) return;
    let p; try { p = new URL(page).pathname; } catch { return; }
    asArray(obj.hasPart).filter(isObj).forEach((c, i) => { try { if (c.url && new URL(c.url).pathname !== p) ctx.push(undefined, `hasPart[${i}].url must be this page's URL with a time parameter`, 'hasPart.url'); } catch { ctx.push(undefined, `hasPart[${i}].url is not a valid URL`, 'hasPart.url'); } });
  },
  keymoments_seektoaction_target_page(obj, ctx) { asArray(obj.potentialAction).filter((a) => isObj(a) && T(a).includes('SeekToAction')).forEach((a) => { if (!/\{seek_to_second_number\}/.test(text(a.target))) ctx.push(undefined, 'SeekToAction target must include {seek_to_second_number}', 'potentialAction.target'); }); },
  live_end_after_start(obj, ctx) { asArray(obj.publication).filter(isObj).forEach((p) => { if (before(p.startDate, p.endDate)) ctx.push(undefined, 'publication.endDate is before startDate', 'publication.endDate'); }); },
  live_enddate_after_finish(obj, ctx) { asArray(obj.publication).filter(isObj).forEach((p) => { if (past(p.startDate, ctx.now) && !isPresent(p.endDate)) ctx.push(undefined, 'Livestream started in the past but has no endDate; add it once the stream ends', 'publication.endDate'); }); },
  live_datetime_format(obj, ctx) { asArray(obj.publication).filter(isObj).forEach((p) => { for (const k of ['startDate', 'endDate']) if (isPresent(p[k]) && !isIsoDateTime(text(p[k]))) ctx.push(undefined, `publication.${k} must be an ISO 8601 date-time`, `publication.${k}`); }); },
  live_requires_base_video(obj, ctx) { const miss = ['name', 'thumbnailUrl', 'uploadDate'].filter((k) => !isPresent(obj[k])); if (miss.length) ctx.push(undefined, `LIVE badge needs the base video properties: ${miss.join(', ')}`, miss[0]); },

  // ------------------------------------------------------------------ Book
  isbn13(obj, ctx) {
    asArray(obj.workExample).filter(isObj).concat([obj]).forEach((w) => { const s = text(w.isbn).replace(/-/g, ''); if (!s) return; if (!/^\d{13}$/.test(s)) { ctx.push(undefined, `isbn ${w.isbn} must be ISBN-13`, 'isbn'); return; } const sum = s.split('').reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0); if (sum % 10) ctx.push(undefined, `isbn ${w.isbn} has an invalid checksum`, 'isbn'); });
  },
};
// Checks that intentionally do nothing extra (the spec walker already covers them).
for (const id of ['claimreview_single_per_page', 'movie_itemlist_positions', 'price_and_pricespec_both', 'qapage_iso_datetimes', 'qapage_comment_spec', 'sp_rate_value_xor_max', 'sp_days_whole']) delete CUSTOM_CHECKS[id];
