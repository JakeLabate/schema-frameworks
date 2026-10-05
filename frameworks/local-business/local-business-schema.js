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


const LOCAL_BUSINESS_TYPES = {
  restaurant: "Restaurant",
  cafe: "CafeOrCoffeeShop",
  bakery: "Bakery",
  day_spa: "DaySpa",
  gym: "HealthClub",
  dentist: "Dentist",
  auto_repair: "AutoRepair",
  hardware_store: "HardwareStore"
};
const FOOD_TYPES = ["Restaurant", "CafeOrCoffeeShop", "Bakery"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Use the most specific LocalBusiness subtype available.
function chooseLocalBusinessType(source) {
  return LOCAL_BUSINESS_TYPES[source.category] || "LocalBusiness";
}

function hasFiveDecimals(value) {
  return typeof value === "number" && /^-?\d+\.\d{5,}$/.test(String(value));
}

function buildHours(spec) {
  const days = (spec.days || []).filter((d) => DAYS.includes(d));
  if (!days.length || !TIME.test(spec.opens || "") || !TIME.test(spec.closes || "")) return null;
  // 24 hours: 00:00 to 23:59. Closed all day: 00:00 to 00:00. Past midnight: closes earlier than opens.
  return {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: days.map((d) => `https://schema.org/${d}`),
    opens: spec.opens,
    closes: spec.closes,
    validFrom: toIsoDate(spec.validFrom), // seasonal hours only
    validThrough: toIsoDate(spec.validThrough)
  };
}

function buildLocalBusinessSchema(source) {
  // (a) Page gates: indexable, self-canonical, business details visible on the page.
  if (!passesPageGates(source)) return null;

  // (b) Required: name, address.
  const address = source.address || {};
  if (!source.name || !address.street || !address.locality) return null;

  const type = chooseLocalBusinessType(source);
  const country = String(address.country || "").toUpperCase();
  const geo = source.geo || {};

  // (c) Required + recommended properties, only when the source has them.
  const schema = {
    "@context": "https://schema.org",
    "@type": type,
    "@id": isAbsoluteUrl(source.url) ? `${source.url}#business` : null,
    name: source.name,
    url: isAbsoluteUrl(source.url) ? source.url : null,
    image: (source.images || []).filter(isAbsoluteUrl),
    // (d) Custom rules: international phone, 5-decimal geo, hh:mm hours, short priceRange.
    telephone: /^\+\d/.test(source.telephone || "") ? source.telephone : null,
    address: {
      "@type": "PostalAddress",
      streetAddress: address.street,
      addressLocality: address.locality,
      addressRegion: address.region,
      postalCode: address.postalCode,
      addressCountry: /^[A-Z]{2}$/.test(country) ? country : null
    },
    geo: hasFiveDecimals(geo.latitude) && hasFiveDecimals(geo.longitude)
      ? { "@type": "GeoCoordinates", latitude: geo.latitude, longitude: geo.longitude }
      : null,
    openingHoursSpecification: (source.hours || []).map(buildHours),
    priceRange: source.priceRange && source.priceRange.length < 100 ? source.priceRange : null,
    menu: FOOD_TYPES.includes(type) && isAbsoluteUrl(source.menuUrl) ? source.menuUrl : null,
    servesCuisine: FOOD_TYPES.includes(type) ? source.cuisines : null,
    department: (source.departments || []).map((dept) => ({
      "@type": chooseLocalBusinessType(dept),
      // "{store name} {department name}" unless the department name is its own brand.
      name: dept.branded ? dept.name : `${source.name} ${dept.name}`,
      telephone: /^\+\d/.test(dept.telephone || "") ? dept.telephone : null,
      openingHoursSpecification: (dept.hours || []).map(buildHours)
    })),
    // Ratings only on sites that collect reviews about other businesses (no self-serving reviews).
    aggregateRating: source.reviewsAreAboutOtherBusinesses && source.rating ? {
      "@type": "AggregateRating",
      ratingValue: source.rating.value,
      reviewCount: source.rating.count
    } : null
  };

  // (e) Strip empty values.
  return compact(schema);
}

// Node: const { buildLocalBusinessSchema } = require('./local-business-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildLocalBusinessSchema };
