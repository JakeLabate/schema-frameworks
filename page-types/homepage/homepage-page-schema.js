// Homepage schema: the site's identity, defined once.
// Organization (with its return policy, shipping service and loyalty
// program), WebSite for the site name, and the home WebPage. Every other
// page type points at these nodes by @id instead of repeating them.

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

function ids(siteUrl) {
  const root = siteUrl.replace(/\/+$/, '');
  return {
    root,
    organization: `${root}/#organization`,
    website: `${root}/#website`,
    returnPolicy: `${root}/#return-policy`,
    shipping: `${root}/#shipping`,
    memberProgram: `${root}/#member-program`,
    tier: (key) => `${root}/#tier-${key}`,
  };
}

// Return policy: only emitted when the category is known, and only with the
// fields that category allows (a store that does not accept returns has no
// return window or method).
function returnPolicy(p, id) {
  if (!p || !COUNTRY.test(p.country || '') || !isUrl(p.link)) return undefined;
  const category = {
    finite: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    unlimited: 'https://schema.org/MerchantReturnUnlimitedWindow',
    none: 'https://schema.org/MerchantReturnNotPermitted',
  }[p.window];
  if (!category) return undefined;
  const allowsReturns = p.window !== 'none';
  return compact({
    '@type': 'MerchantReturnPolicy',
    '@id': id,
    applicableCountry: p.country,
    returnPolicyCountry: p.country,
    returnPolicyCategory: category,
    merchantReturnLink: p.link,
    merchantReturnDays: p.window === 'finite' && Number.isInteger(p.days) && p.days > 0 ? p.days : undefined,
    returnMethod: allowsReturns && p.byMail ? 'https://schema.org/ReturnByMail' : undefined,
    returnFees: allowsReturns ? (p.freeReturns ? 'https://schema.org/FreeReturn' : 'https://schema.org/ReturnFeesCustomerResponsibility') : undefined,
    refundType: allowsReturns ? 'https://schema.org/FullRefund' : undefined,
  });
}

// Shipping service: one ShippingConditions entry per destination with a
// valid country and either a flat rate or free shipping above a threshold.
function shippingService(s, id) {
  if (!s || !Array.isArray(s.destinations) || !CURRENCY.test(s.currency || '')) return undefined;
  const transit = (d) =>
    Number.isInteger(d.minDays) && Number.isInteger(d.maxDays) && d.minDays <= d.maxDays
      ? { '@type': 'ServicePeriod', duration: { '@type': 'QuantitativeValue', minValue: d.minDays, maxValue: d.maxDays, unitCode: 'DAY' } }
      : undefined;
  const conditions = s.destinations
    .filter((d) => COUNTRY.test(d.country || '') && Number.isFinite(d.rate) && d.rate >= 0)
    .flatMap((d) => {
      const region = { '@type': 'DefinedRegion', addressCountry: d.country };
      const paid = {
        '@type': 'ShippingConditions',
        shippingDestination: region,
        shippingRate: { '@type': 'MonetaryAmount', value: d.rate, currency: s.currency },
        transitTime: transit(d),
      };
      // Free shipping above a threshold is a second condition with its own
      // order value band, not a note on the first.
      if (!(Number.isFinite(d.freeOver) && d.freeOver > 0 && d.rate > 0)) return [compact(paid)];
      return [
        compact({ ...paid, orderValue: { '@type': 'MonetaryAmount', minValue: 0, maxValue: d.freeOver, currency: s.currency } }),
        compact({
          '@type': 'ShippingConditions',
          shippingDestination: region,
          orderValue: { '@type': 'MonetaryAmount', minValue: d.freeOver, currency: s.currency },
          shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: s.currency },
          transitTime: transit(d),
        }),
      ];
    });
  if (!conditions.length) return undefined;
  return compact({ '@type': 'ShippingService', '@id': id, name: clean(s.name), shippingConditions: conditions });
}

// Loyalty program: each tier needs a name and at least one benefit, and gets
// its own @id so product offers can price against it. Google recognises two
// benefits, points and member pricing; a points tier must say how many points
// a purchase earns, or the tier is dropped.
function memberProgram(m, idOf, id) {
  if (!m || !m.name || !m.description) return undefined;
  const tiers = (m.tiers || [])
    .filter((t) => t.key && t.name)
    .map((t) => {
      const points = t.benefits?.includes('points') && Number.isFinite(t.pointsPerDollar) && t.pointsPerDollar > 0;
      const benefits = [
        points ? 'https://schema.org/TierBenefitLoyaltyPoints' : undefined,
        t.benefits?.includes('price') ? 'https://schema.org/TierBenefitLoyaltyPrice' : undefined,
      ].filter(Boolean);
      if (!benefits.length) return undefined;
      return compact({
        '@type': 'MemberProgramTier',
        '@id': idOf(t.key),
        name: clean(t.name),
        url: isUrl(t.url) ? t.url : undefined,
        hasTierBenefit: benefits,
        membershipPointsEarned: points ? { '@type': 'QuantitativeValue', value: t.pointsPerDollar, unitText: 'points per USD' } : undefined,
        hasTierRequirement: Number.isFinite(t.minSpend) && t.minSpend > 0
          ? { '@type': 'MonetaryAmount', value: t.minSpend, currency: 'USD' }
          : undefined,
      });
    })
    .filter(Boolean);
  if (!tiers.length) return undefined;
  return compact({ '@type': 'MemberProgram', '@id': id, name: clean(m.name), description: clean(m.description), url: isUrl(m.url) ? m.url : undefined, hasTiers: tiers });
}

function buildHomepageSchema(source) {
  const site = source.site || {};
  if (!isUrl(site.url) || !site.name) return null;
  const id = ids(site.url);

  const organization = compact({
    '@type': site.type || 'Organization',
    '@id': id.organization,
    name: clean(site.name),
    alternateName: clean(site.alternateName),
    url: `${id.root}/`,
    logo: isUrl(site.logo) ? { '@type': 'ImageObject', url: site.logo } : undefined,
    description: clean(site.description),
    email: clean(site.email),
    telephone: clean(site.telephone),
    sameAs: (site.sameAs || []).filter(isUrl),
    foundingDate: ISO_DATE.test(site.foundingDate || '') ? site.foundingDate : undefined,
    address: site.address && site.address.street && COUNTRY.test(site.address.country || '')
      ? {
          '@type': 'PostalAddress',
          streetAddress: clean(site.address.street),
          addressLocality: clean(site.address.city),
          addressRegion: clean(site.address.region),
          postalCode: clean(site.address.postalCode),
          addressCountry: site.address.country,
        }
      : undefined,
    contactPoint: site.email || site.telephone
      ? { '@type': 'ContactPoint', contactType: 'customer service', email: clean(site.email), telephone: clean(site.telephone) }
      : undefined,
    hasMerchantReturnPolicy: returnPolicy(site.returnPolicy, id.returnPolicy),
    hasShippingService: shippingService(site.shipping, id.shipping),
    hasMemberProgram: memberProgram(site.loyalty, id.tier, id.memberProgram),
  });

  // Site name: only on the home page, with the same name as the Organization.
  const website = compact({
    '@type': 'WebSite',
    '@id': id.website,
    name: clean(site.name),
    alternateName: clean(site.alternateName),
    url: `${id.root}/`,
    publisher: { '@id': id.organization },
  });

  const webpage = compact({
    '@type': 'WebPage',
    '@id': `${id.root}/#webpage`,
    url: `${id.root}/`,
    name: clean(source.page?.title) || clean(site.name),
    isPartOf: { '@id': id.website },
    about: { '@id': id.organization },
  });

  return { '@context': 'https://schema.org', '@graph': [organization, website, webpage] };
}

// Node: const { buildHomepageSchema } = require('./homepage-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildHomepageSchema };
