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

function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const isCurrencyCode = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);

// Rating or AggregateRating; null when ratingValue falls outside worstRating..bestRating.
function buildRating(input, type) {
  if (!input) return null;
  const best = toNumber(input.bestRating) ?? 5;
  const worst = toNumber(input.worstRating) ?? 1;
  const value = toNumber(input.ratingValue);
  if (value === null || worst >= best || value < worst || value > best) return null;
  const rating = { "@type": type, ratingValue: value, bestRating: best, worstRating: worst };
  if (type === "AggregateRating") {
    const ratingCount = toNumber(input.ratingCount);
    const reviewCount = toNumber(input.reviewCount);
    if (!(ratingCount > 0) && !(reviewCount > 0)) return null;
    rating.ratingCount = ratingCount > 0 ? ratingCount : null;
    rating.reviewCount = reviewCount > 0 ? reviewCount : null;
  }
  return rating;
}

// Review with a valid author name (under 100 characters) and an in-range rating.
function buildReview(input) {
  const authorName = String(input?.authorName ?? "").trim();
  const reviewRating = buildRating(input?.rating, "Rating");
  if (!authorName || authorName.length >= 100 || !reviewRating) return null;
  return {
    "@type": "Review",
    author: { "@type": input.authorType === "Organization" ? "Organization" : "Person", name: authorName },
    reviewRating,
    datePublished: toIsoDate(input.datePublished)
  };
}

const BOOLEAN_AMENITIES = new Set([
  "ac", "airportShuttle", "balcony", "beachAccess", "childFriendly", "crib", "elevator", "fireplace",
  "freeBreakfast", "gymFitnessEquipment", "heating", "hotTub", "instantBookable", "ironingBoard", "kitchen",
  "microwave", "outdoorGrill", "ovenStove", "patio", "petsAllowed", "pool", "privateBeachAccess",
  "selfCheckinCheckout", "smokingAllowed", "tv", "washerDryer", "wheelchairAccessible", "wifi"
]);
const TEXT_AMENITIES = {
  internetType: ["Free", "Paid", "None"],
  parkingType: ["Free", "Paid", "None"],
  poolType: ["Indoor", "Outdoor", "None"]
};
const RENTAL_TYPES = ["Apartment", "Bungalow", "Cabin", "Chalet", "Cottage", "Gite", "HolidayVillageRental", "House", "Villa", "VacationRental"];
const PLACE_TYPES = ["EntirePlace", "PrivateRoom", "SharedRoom"];
const TIME = /^\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/;
const oneOf = (value, allowed) => (allowed.includes(value) ? value : null);

// latitude and longitude need at least 5 decimal places in the emitted number.
function toCoordinate(value) {
  const num = toNumber(value);
  return num !== null && /^-?\d+\.\d{5,}$/.test(String(num)) ? num : null;
}

// Boolean amenities take true/false; typed amenities take their enum; licenseNum is repeatable text.
function buildAmenities(amenities = {}) {
  const features = [];
  for (const [name, value] of Object.entries(amenities)) {
    if (BOOLEAN_AMENITIES.has(name) && typeof value === "boolean") features.push({ name, value });
    else if (TEXT_AMENITIES[name]?.includes(value)) features.push({ name, value });
    else if (name === "licenseNum") [].concat(value).filter(Boolean).forEach((v) => features.push({ name, value: String(v) }));
  }
  return features.map((f) => ({ "@type": "LocationFeatureSpecification", ...f }));
}

function buildAccommodation(unit = {}) {
  const occupancy = toNumber(unit.maxGuests);
  if (!Number.isInteger(occupancy) || occupancy < 1) return null;
  const floorArea = toNumber(unit.floorSize?.value);
  return {
    "@type": "Accommodation",
    additionalType: oneOf(unit.placeType, PLACE_TYPES),
    occupancy: { "@type": "QuantitativeValue", value: occupancy },
    numberOfBedrooms: toNumber(unit.bedrooms),
    numberOfBathroomsTotal: toNumber(unit.bathrooms),
    numberOfRooms: toNumber(unit.rooms),
    floorSize: floorArea > 0 && ["FTK", "SQFT", "MTK", "SQM"].includes(unit.floorSize.unitCode)
      ? { "@type": "QuantitativeValue", value: floorArea, unitCode: unit.floorSize.unitCode }
      : null,
    bed: (unit.beds ?? [])
      .filter((b) => Number.isInteger(b.count) && b.count > 0)
      .map((b) => ({ "@type": "BedDetails", numberOfBeds: b.count, typeOfBed: b.type })),
    amenityFeature: buildAmenities(unit.amenities)
  };
}

function buildVacationRentalSchema(source) {
  if (!passesPageGates(source)) return null;

  // Required: name, identifier, 8+ images (bedroom, bathroom, common area), precise coordinates, one Accommodation.
  const name = String(source.name ?? "").trim();
  const identifier = String(source.listingId ?? "").trim();
  const images = (source.images ?? []).filter((img) => isAbsoluteUrl(img.url));
  const rooms = new Set(images.map((img) => img.room));
  const hasRoomMix = ["bedroom", "bathroom", "common"].every((room) => rooms.has(room));
  const latitude = toCoordinate(source.latitude);
  const longitude = toCoordinate(source.longitude);
  const containsPlace = buildAccommodation(source.unit);
  if (!name || !identifier || images.length < 8 || !hasRoomMix || latitude === null || longitude === null || !containsPlace) return null;

  const country = /^[A-Z]{2}$/.test(source.address?.country ?? "") ? source.address.country : null;

  // Reviews need datePublished; properties in France also need contentReferenceTime (start of the stay).
  const reviews = (source.reviews ?? []).map((r) => {
    const review = buildReview(r);
    const contentReferenceTime = toIsoDateTime(r.stayStartDate);
    if (!review || !review.datePublished || (country === "FR" && !contentReferenceTime)) return null;
    return { ...review, contentReferenceTime };
  }).filter(Boolean);

  return compact({
    "@context": "https://schema.org",
    "@type": "VacationRental",
    additionalType: oneOf(source.rentalType, RENTAL_TYPES),
    name,
    identifier,
    url: source.url,
    description: source.description,
    brand: source.hotelCenterBrandId ? { "@type": "Brand", name: source.hotelCenterBrandId } : null,
    image: images.map((img) => img.url),
    latitude,
    longitude,
    address: source.address && {
      "@type": "PostalAddress",
      streetAddress: source.address.street,
      addressLocality: source.address.city,
      addressRegion: source.address.region,
      postalCode: source.address.postalCode,
      addressCountry: country
    },
    checkinTime: TIME.test(source.checkinTime ?? "") ? source.checkinTime : null,
    checkoutTime: TIME.test(source.checkoutTime ?? "") ? source.checkoutTime : null,
    knowsLanguage: (source.hostLanguages ?? []).filter((l) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)),
    containsPlace,
    aggregateRating: buildRating(source.rating, "AggregateRating"),
    review: reviews
  });
}

// Node: const { buildVacationRentalSchema } = require('./vacation-rental-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildVacationRentalSchema };
