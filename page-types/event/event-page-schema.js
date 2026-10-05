// Event page schema: one in-person workshop at one of the store's locations.
// Event with a start time in the venue's timezone, the store as the venue
// (same @id as its location page), the Organization from the homepage as
// organizer, the instructor as performer, a free ticket offer, and the
// page's WebPage and BreadcrumbList.

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
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

const STATUS = {
  scheduled: 'https://schema.org/EventScheduled',
  rescheduled: 'https://schema.org/EventRescheduled',
  postponed: 'https://schema.org/EventPostponed',
  cancelled: 'https://schema.org/EventCancelled',
};

function buildEventPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const ev = source.event || {};
  const venue = ev.venue || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !ev.name) return null;
  // A start time needs its timezone, or the event shows at the wrong hour.
  if (!ISO_DATE_TIME.test(ev.start || '')) return null;
  if (!venue.street || !venue.city || !COUNTRY.test(venue.country || '')) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const eventId = `${pageUrl}#event`;
  const status = STATUS[ev.status] || STATUS.scheduled;

  // An end time is only stated when it comes after the start.
  const end = ISO_DATE_TIME.test(ev.end || '') && Date.parse(ev.end) > Date.parse(ev.start) ? ev.end : undefined;

  // A rescheduled event keeps the new date in startDate and the old one in
  // previousStartDate; a postponed one keeps its original date.
  const previous = status === STATUS.rescheduled && ISO_DATE_TIME.test(ev.previousStart || '') ? ev.previousStart : undefined;

  const offer = ev.ticket && CURRENCY.test(ev.ticket.currency || '') && Number.isFinite(ev.ticket.price) && ev.ticket.price >= 0
    ? compact({
        '@type': 'Offer',
        url: isUrl(ev.ticket.url) ? ev.ticket.url : pageUrl,
        price: ev.ticket.price,
        priceCurrency: ev.ticket.currency,
        availability: ev.ticket.soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        validFrom: ISO_DATE_TIME.test(ev.ticket.onSale || '') ? ev.ticket.onSale : undefined,
      })
    : undefined;

  const event = compact({
    '@type': 'Event',
    '@id': eventId,
    name: clean(ev.name),
    description: clean(ev.description),
    image: (ev.images || []).filter(isUrl),
    startDate: ev.start,
    endDate: end,
    previousStartDate: previous,
    eventStatus: status,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      '@id': isUrl(venue.locationPageUrl) ? `${venue.locationPageUrl}#location` : undefined,
      name: clean(venue.name),
      address: {
        '@type': 'PostalAddress',
        streetAddress: clean(venue.street),
        addressLocality: clean(venue.city),
        addressRegion: clean(venue.region),
        postalCode: clean(venue.postalCode),
        addressCountry: venue.country,
      },
    },
    organizer: { '@id': `${root}/#organization` },
    performer: (ev.hosts || []).filter((h) => h.name).map((h) => ({ '@type': 'Person', name: clean(h.name) })),
    offers: offer,
    maximumAttendeeCapacity: Number.isInteger(ev.capacity) && ev.capacity > 0 ? ev.capacity : undefined,
  });

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(ev.name),
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: { '@id': eventId },
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, event].filter(Boolean) };
}

// Node: const { buildEventPageSchema } = require('./event-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildEventPageSchema };
