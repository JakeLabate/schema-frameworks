// Vacation rental page schema: the page for one place to stay. A
// VacationRental with its photos, map position, the one Accommodation it
// holds, guest rating and reviews, plus the page's WebPage, published by
// the Organization from the homepage, and its BreadcrumbList.
//
// Google needs a name, a listing ID, eight photos that show a bedroom, a
// bathroom and a common area, a map position to five decimal places, and
// how many guests the place sleeps. Without all of them the builder outputs
// nothing.

const COUNTRY = /^[A-Z]{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

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

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// A rating only counts with a score inside its scale and a count above zero.
function aggregateRating(r) {
  if (!r) return undefined;
  const best = num(r.best) ?? 5;
  const worst = num(r.worst) ?? 1;
  const value = num(r.value);
  if (value === null || worst >= best || value < worst || value > best) return undefined;
  if (!(num(r.count) > 0)) return undefined;
  return { '@type': 'AggregateRating', ratingValue: value, bestRating: best, worstRating: worst, ratingCount: r.count };
}

// A map position Google can place: a number with five or more decimals.
const coordinate = (v) => (num(v) !== null && /^-?\d+\.\d{5,}$/.test(String(v)) ? v : undefined);

// A guest review needs a named author, a score inside its scale and the date
// it was written.
function review(r) {
  const author = clean(r.author);
  const best = num(r.best) ?? 5;
  const worst = num(r.worst) ?? 1;
  const value = num(r.rating);
  if (!author || author.length >= 100 || !ISO_DATE.test(r.date || '')) return undefined;
  if (value === null || worst >= best || value < worst || value > best) return undefined;
  return compact({
    '@type': 'Review',
    author: { '@type': 'Person', name: author },
    reviewRating: { '@type': 'Rating', ratingValue: value, bestRating: best, worstRating: worst },
    datePublished: r.date,
    contentReferenceTime: ISO_DATE.test(r.stayed || '') ? r.stayed : undefined,
  });
}

const RENTAL_TYPES = ['Apartment', 'Bungalow', 'Cabin', 'Chalet', 'Cottage', 'Gite', 'HolidayVillageRental', 'House', 'Villa', 'VacationRental'];
const PLACE_TYPES = ['EntirePlace', 'PrivateRoom', 'SharedRoom'];
const FLOOR_UNITS = ['FTK', 'SQFT', 'MTK', 'SQM'];
const YES_NO_AMENITIES = [
  'ac', 'airportShuttle', 'balcony', 'beachAccess', 'childFriendly', 'crib', 'elevator', 'fireplace',
  'freeBreakfast', 'gymFitnessEquipment', 'heating', 'hotTub', 'instantBookable', 'ironingBoard', 'kitchen',
  'microwave', 'outdoorGrill', 'ovenStove', 'patio', 'petsAllowed', 'pool', 'privateBeachAccess',
  'selfCheckinCheckout', 'smokingAllowed', 'tv', 'washerDryer', 'wheelchairAccessible', 'wifi',
];
const CHOICE_AMENITIES = {
  internetType: ['Free', 'Paid', 'None'],
  parkingType: ['Free', 'Paid', 'None'],
  poolType: ['Indoor', 'Outdoor', 'None'],
};

// Only amenities from Google's list, each with the kind of value it takes.
function amenities(list) {
  const out = [];
  for (const [name, value] of Object.entries(list || {})) {
    if (YES_NO_AMENITIES.includes(name) && typeof value === 'boolean') out.push({ name, value });
    else if ((CHOICE_AMENITIES[name] || []).includes(value)) out.push({ name, value });
    else if (name === 'licenseNum' && value) out.push({ name, value: String(value) });
  }
  return out.map((a) => ({ '@type': 'LocationFeatureSpecification', ...a }));
}

function buildVacationRentalPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const rental = source.rental || {};
  const unit = rental.unit || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !rental.name || !rental.listingId) return null;

  // Eight photos, with a bedroom, a bathroom and a common area among them.
  const photos = (rental.photos || []).filter((p) => isUrl(p.url));
  const shown = new Set(photos.map((p) => p.shows));
  if (photos.length < 8 || !['bedroom', 'bathroom', 'common'].every((room) => shown.has(room))) return null;

  const latitude = coordinate(rental.latitude);
  const longitude = coordinate(rental.longitude);
  if (latitude === undefined || longitude === undefined) return null;
  if (!Number.isInteger(unit.sleeps) || unit.sleeps < 1) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const rentalId = `${pageUrl}#rental`;
  const address = rental.address || {};

  const place = compact({
    '@type': 'VacationRental',
    '@id': rentalId,
    additionalType: RENTAL_TYPES.includes(rental.type) ? rental.type : undefined,
    name: clean(rental.name),
    identifier: clean(String(rental.listingId)),
    url: pageUrl,
    description: clean(rental.description),
    // Google reads brand as the listing's brand ID in Hotel Center.
    brand: rental.hotelCenterBrand ? { '@type': 'Brand', name: clean(rental.hotelCenterBrand) } : undefined,
    image: photos.map((p) => p.url),
    latitude,
    longitude,
    address: {
      '@type': 'PostalAddress',
      streetAddress: clean(address.street),
      addressLocality: clean(address.city),
      addressRegion: clean(address.region),
      postalCode: clean(address.postalCode),
      addressCountry: COUNTRY.test(address.country || '') ? address.country : undefined,
    },
    checkinTime: TIME.test(rental.checkin || '') ? rental.checkin : undefined,
    checkoutTime: TIME.test(rental.checkout || '') ? rental.checkout : undefined,
    knowsLanguage: (rental.hostLanguages || []).filter((l) => LANGUAGE.test(l)),
    containsPlace: {
      '@type': 'Accommodation',
      additionalType: PLACE_TYPES.includes(unit.kind) ? unit.kind : undefined,
      occupancy: { '@type': 'QuantitativeValue', value: unit.sleeps },
      numberOfBedrooms: num(unit.bedrooms) ?? undefined,
      numberOfBathroomsTotal: num(unit.bathrooms) ?? undefined,
      numberOfRooms: num(unit.rooms) ?? undefined,
      floorSize: num(unit.floorArea) > 0 && FLOOR_UNITS.includes(unit.floorUnit)
        ? { '@type': 'QuantitativeValue', value: unit.floorArea, unitCode: unit.floorUnit }
        : undefined,
      bed: (unit.beds || [])
        .filter((b) => Number.isInteger(b.count) && b.count > 0 && b.type)
        .map((b) => ({ '@type': 'BedDetails', numberOfBeds: b.count, typeOfBed: clean(b.type) })),
      amenityFeature: amenities(unit.amenities),
    },
    aggregateRating: aggregateRating(rental.rating),
    review: (rental.reviews || []).map(review).filter(Boolean),
  });

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(rental.name),
    isPartOf: { '@id': `${root}/#website` },
    publisher: { '@id': `${root}/#organization` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: { '@id': rentalId },
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, place].filter(Boolean) };
}

// Node: const { buildVacationRentalPageSchema } = require('./vacation-rental-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildVacationRentalPageSchema };
