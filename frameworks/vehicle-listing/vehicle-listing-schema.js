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
const isVin = (value) => typeof value === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(value);

const VEHICLE_TYPES = { car: "Car", motorcycle: "Motorcycle", bus: "BusOrCoach", ebike: "MotorizedBicycle" };
const CONDITIONS = {
  new: "https://schema.org/NewCondition",
  used: "https://schema.org/UsedCondition",
  refurbished: "https://schema.org/RefurbishedCondition"
};
const AVAILABILITY = {
  in_stock: "https://schema.org/InStock",
  sold_out: "https://schema.org/SoldOut",
  pre_order: "https://schema.org/PreOrder"
};
const ODOMETER_UNITS = { mi: "SMI", km: "KMT" };
const DRIVE_WHEELS = {
  awd: "https://schema.org/AllWheelDriveConfiguration",
  fwd: "https://schema.org/FrontWheelDriveConfiguration",
  rwd: "https://schema.org/RearWheelDriveConfiguration",
  "4wd": "https://schema.org/FourWheelDriveConfiguration"
};

// Vehicle and its subtypes are Product subtypes in schema.org.
function chooseVehicleType(source) {
  return VEHICLE_TYPES[source.vehicleClass] || "Vehicle";
}

// Vehicle listing rich results are retired (Sep 9, 2025). The output is still a
// Product subtype, so it is gated on the Product rules validators apply to it:
// name, absolute image, and an Offer with price > 0 in an ISO 4217 currency.
function buildVehicleSchema(source) {
  if (!passesPageGates(source.page)) return null;

  const images = (source.images || []).filter(isAbsoluteUrl);
  const offer = source.offer || {};
  const price = toNumber(offer.price);
  if (!source.name || images.length === 0) return null;
  if (price === null || price <= 0 || !isCurrencyCode(offer.currency)) return null;

  const condition = CONDITIONS[source.condition] || null;
  const mileage = toNumber(source.mileage && source.mileage.value);
  const mileageUnit = source.mileage && ODOMETER_UNITS[source.mileage.unit];
  const validUntil = toIsoDate(offer.validUntil);
  const schema = {
    "@context": "https://schema.org",
    "@type": chooseVehicleType(source),
    name: source.name,
    description: source.description,
    image: images,
    url: source.page.url,
    category: source.category,
    sku: typeof source.stockNumber === "string" && !/\s/.test(source.stockNumber) ? source.stockNumber : null,
    vehicleIdentificationNumber: isVin(source.vin) ? source.vin : null,
    brand: source.make ? { "@type": "Brand", name: source.make } : null,
    model: source.model,
    vehicleModelDate: /^\d{4}$/.test(String(source.modelYear || "")) ? String(source.modelYear) : null,
    bodyType: source.bodyType,
    color: source.color,
    fuelType: source.fuelType,
    vehicleTransmission: source.transmission,
    driveWheelConfiguration: DRIVE_WHEELS[source.drivetrain] || null,
    numberOfDoors: toNumber(source.doors),
    mileageFromOdometer: mileage !== null && mileage >= 0 && mileageUnit
      ? { "@type": "QuantitativeValue", value: mileage, unitCode: mileageUnit }
      : null,
    itemCondition: condition,
    offers: {
      "@type": "Offer",
      price,
      priceCurrency: offer.currency,
      availability: AVAILABILITY[offer.availability] || null,
      itemCondition: condition,
      url: source.page.url,
      priceValidUntil: validUntil && validUntil >= new Date().toISOString().slice(0, 10) ? validUntil : null,
      seller: offer.dealerName ? { "@type": "AutoDealer", name: offer.dealerName } : null
    }
  };

  return compact(schema);
}

// Node: const { buildVehicleSchema } = require('./vehicle-listing-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildVehicleSchema };
