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


const EVENT_STATUS = {
  scheduled: "https://schema.org/EventScheduled",
  cancelled: "https://schema.org/EventCancelled",
  postponed: "https://schema.org/EventPostponed",
  rescheduled: "https://schema.org/EventRescheduled"
};
const TICKET_AVAILABILITY = {
  in_stock: "https://schema.org/InStock",
  sold_out: "https://schema.org/SoldOut",
  pre_order: "https://schema.org/PreOrder"
};

function buildPostalAddress(address = {}) {
  const country = String(address.country || "").toUpperCase();
  return {
    "@type": "PostalAddress",
    streetAddress: address.street,
    addressLocality: address.locality,
    addressRegion: address.region,
    postalCode: address.postalCode,
    addressCountry: /^[A-Z]{2}$/.test(country) ? country : null
  };
}

function buildOffer(ticket) {
  const price = Number(ticket.price);
  const currency = String(ticket.currency || "").toUpperCase();
  // Price includes fees; 0 means free. Currency is a 3-letter ISO 4217 code.
  if (ticket.price == null || !Number.isFinite(price) || price < 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  return {
    "@type": "Offer",
    name: ticket.name,
    price,
    priceCurrency: currency,
    availability: TICKET_AVAILABILITY[ticket.availability] || null,
    validFrom: toIsoDateTime(ticket.onSaleFrom),
    url: isAbsoluteUrl(ticket.url) ? ticket.url : null
  };
}

function buildEventSchema(source) {
  // (a) Page gates: indexable, self-canonical, event visible on this leaf page.
  if (!passesPageGates(source)) return null;

  // (b) Required: name, startDate, location (a physical Place with a PostalAddress).
  const venue = source.venue || {};
  const toDate = source.allDay ? toIsoDate : toIsoDateTime; // all-day events: date only, no fake midnight
  const startDate = toDate(source.startDate);
  if (!source.name || !startDate) return null;
  if (source.attendanceMode === "online" || !venue.address) return null; // virtual-only events are not supported
  if (venue.name && venue.name === source.name) return null; // the event title must not be the venue name

  // (d) Custom rules: status enum, endDate not before startDate, previousStartDate only when rescheduled.
  const status = EVENT_STATUS[source.status] || EVENT_STATUS.scheduled;
  let endDate = toDate(source.endDate);
  if (endDate && Date.parse(endDate) < Date.parse(startDate)) endDate = null;
  const previousStartDate = status === EVENT_STATUS.rescheduled
    ? (source.previousStartDates || []).map(toDate)
    : null;

  // (c) Required + recommended properties, only when the source has them.
  const schema = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: source.name,
    description: source.description,
    startDate, // keep startDate even when the event is cancelled or postponed
    endDate,
    eventStatus: status,
    previousStartDate,
    location: {
      "@type": "Place",
      name: venue.name,
      address: buildPostalAddress(venue.address)
    },
    image: (source.images || []).filter(isAbsoluteUrl),
    offers: (source.tickets || []).map(buildOffer), // one Offer per ticket type
    organizer: source.organizer && {
      "@type": source.organizer.type === "Person" ? "Person" : "Organization",
      name: source.organizer.name,
      url: isAbsoluteUrl(source.organizer.url) ? source.organizer.url : null
    },
    performer: (source.performers || []).map((p) => ({
      "@type": p.type === "Person" ? "Person" : "PerformingGroup",
      name: p.name
    }))
  };

  // (e) Strip empty values.
  return compact(schema);
}

// Node: const { buildEventSchema } = require('./event-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildEventSchema };
