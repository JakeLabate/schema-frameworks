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
const TICKET_AVAILABILITY = {
  in_stock: "https://schema.org/InStock",
  sold_out: "https://schema.org/SoldOut",
  pre_order: "https://schema.org/PreOrder"
};

// Seconds to ISO 8601 duration, for example 2700 -> "PT45M".
function toIsoDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return "PT" + (h ? h + "H" : "") + (m ? m + "M" : "") + (s ? s + "S" : "");
}

// Home activities rich results were removed Jun 4, 2024. What still qualifies:
// a scheduled session with a physical venue (Event, optionally also streamed),
// or a recording (VideoObject). Online-only live sessions get no markup type.
function chooseHomeActivityType(source) {
  const venue = source.venue || {};
  if (source.startDate && venue.name && venue.streetAddress) return "Event";
  if (source.recording && source.recording.uploadDate) return "VideoObject";
  return null;
}

function buildEvent(source) {
  // Google Event required: name, startDate, location (Place with address).
  const startDate = toIsoDateTime(source.startDate);
  if (!source.name || !startDate) return null;
  const endDate = toIsoDateTime(source.endDate);
  const venue = source.venue;
  const streamed = isAbsoluteUrl(source.streamUrl);
  const offer = source.offer || {};
  const price = toNumber(offer.price);

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: source.name,
    description: source.description,
    startDate,
    endDate: endDate && Date.parse(endDate) > Date.parse(startDate) ? endDate : null,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: streamed
      ? "https://schema.org/MixedEventAttendanceMode"
      : "https://schema.org/OfflineEventAttendanceMode",
    // Google's Event doc requires location as a Place; VirtualLocation entries fail
    // validation, so the stream link stays in the visible page content.
    location: {
      "@type": "Place",
      name: venue.name,
      address: {
        "@type": "PostalAddress",
        streetAddress: venue.streetAddress,
        addressLocality: venue.locality,
        addressRegion: venue.region,
        postalCode: venue.postalCode,
        addressCountry: /^[A-Z]{2}$/.test(venue.country || "") ? venue.country : null
      }
    },
    image: (source.images || []).filter(isAbsoluteUrl),
    offers: price !== null && price >= 0 && isCurrencyCode(offer.currency) ? {
      "@type": "Offer",
      price,
      priceCurrency: offer.currency,
      availability: TICKET_AVAILABILITY[offer.availability] || null,
      validFrom: toIsoDateTime(offer.validFrom),
      url: isAbsoluteUrl(offer.url) ? offer.url : null
    } : null,
    organizer: source.organizer && source.organizer.name ? {
      "@type": "Organization",
      name: source.organizer.name,
      url: isAbsoluteUrl(source.organizer.url) ? source.organizer.url : null
    } : null,
    performer: source.instructor ? { "@type": "Person", name: source.instructor } : null
  };
}

function buildRecording(source) {
  // Google Video required: name, thumbnailUrl, uploadDate (DateTime with offset).
  const rec = source.recording;
  const thumbnails = (rec.thumbnailUrls || []).filter(isAbsoluteUrl);
  const uploadDate = toIsoDateTime(rec.uploadDate);
  if (!source.name || thumbnails.length === 0 || !uploadDate) return null;
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: source.name,
    description: source.description,
    thumbnailUrl: thumbnails,
    uploadDate,
    duration: toIsoDuration(rec.durationSeconds),
    contentUrl: isAbsoluteUrl(rec.contentUrl) && rec.contentUrl !== source.page.url ? rec.contentUrl : null
  };
}

function buildHomeActivitySchema(source) {
  if (!passesPageGates(source.page)) return null;
  const type = chooseHomeActivityType(source);
  const schema = type === "Event" ? buildEvent(source) : type === "VideoObject" ? buildRecording(source) : null;
  return schema ? compact(schema) : null;
}

// Node: const { buildHomeActivitySchema } = require('./home-activities-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildHomeActivitySchema };
