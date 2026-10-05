// Product page schema: one product with variants, sold on this page.
// ProductGroup with a Product per variant (each with its own Offer), the
// page's WebPage and BreadcrumbList, and @id links to the Organization,
// return policy and loyalty tiers defined once on the homepage.

const CURRENCY = /^[A-Z]{3}$/;
const GTIN = /^(\d{8}|\d{12}|\d{13}|\d{14})$/;

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

const AVAILABILITY = {
  in_stock: 'https://schema.org/InStock',
  out_of_stock: 'https://schema.org/OutOfStock',
  preorder: 'https://schema.org/PreOrder',
  backorder: 'https://schema.org/BackOrder',
};
const CONDITION = {
  new: 'https://schema.org/NewCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
  used: 'https://schema.org/UsedCondition',
};
const VARIES_BY = { color: 'https://schema.org/color', size: 'https://schema.org/size', material: 'https://schema.org/material' };

function breadcrumb(trail, id) {
  const items = (trail || []).filter((c) => c.name && isUrl(c.url));
  if (items.length < 2) return undefined;
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: clean(c.name), item: c.url })),
  };
}

// An Offer only exists for a variant with a real price and currency. Member
// pricing references a loyalty tier by @id from the homepage graph.
function offer(v, ctx) {
  if (!(Number.isFinite(v.price) && v.price > 0) || !CURRENCY.test(ctx.currency)) return undefined;
  const memberPrices = (v.memberPrices || [])
    .filter((m) => m.tier && Number.isFinite(m.price) && m.price > 0 && m.price < v.price)
    .map((m) => ({
      '@type': 'UnitPriceSpecification',
      price: m.price,
      priceCurrency: ctx.currency,
      validForMemberTier: { '@id': `${ctx.root}/#tier-${m.tier}` },
    }));
  return compact({
    '@type': 'Offer',
    url: ctx.variantUrl(v),
    price: v.price,
    priceCurrency: ctx.currency,
    priceSpecification: memberPrices.length ? memberPrices : undefined,
    availability: AVAILABILITY[v.availability] || 'https://schema.org/InStock',
    itemCondition: CONDITION[v.condition] || CONDITION.new,
    seller: { '@id': `${ctx.root}/#organization` },
    // Org-level return policy applies by default; a product with different
    // terms points at its own policy here instead.
    hasMerchantReturnPolicy: v.returnPolicyId ? { '@id': v.returnPolicyId } : undefined,
  });
}

function buildProductPageSchema(source) {
  const site = source.site || {};
  const page = source.page || {};
  const p = source.product || {};
  if (!isUrl(site.url) || !isUrl(page.url) || !p.name || !p.groupId) return null;

  const root = site.url.replace(/\/+$/, '');
  const pageUrl = page.url;
  const groupId = `${pageUrl}#product-group`;
  const variesBy = (p.variesBy || []).filter((k) => VARIES_BY[k]);
  const ctx = {
    root,
    currency: clean(p.currency),
    variantUrl: (v) => {
      const params = variesBy.filter((k) => v[k]).map((k) => `${k}=${encodeURIComponent(String(v[k]).toLowerCase())}`);
      return params.length ? `${pageUrl}?${params.join('&')}` : pageUrl;
    },
  };

  // A variant needs a unique SKU, a name, an image and a sellable offer;
  // anything less is dropped rather than shipped half built.
  const seen = new Set();
  const variants = (p.variants || [])
    .filter((v) => v.sku && !seen.has(v.sku) && seen.add(v.sku))
    .map((v) => {
      const o = offer(v, ctx);
      const image = (v.images || p.images || []).filter(isUrl);
      if (!o || !image.length) return undefined;
      return compact({
        '@type': 'Product',
        '@id': `${pageUrl}#sku-${v.sku}`,
        sku: v.sku,
        gtin: GTIN.test(String(v.gtin || '')) ? String(v.gtin) : undefined,
        name: [p.name, ...variesBy.map((k) => v[k])].filter(Boolean).join(', '),
        image,
        color: variesBy.includes('color') ? clean(v.color) : undefined,
        size: variesBy.includes('size') ? clean(v.size) : undefined,
        material: variesBy.includes('material') ? clean(v.material) : undefined,
        url: o.url,
        inProductGroupWithID: p.groupId,
        isVariantOf: { '@id': groupId },
        offers: o,
      });
    })
    .filter(Boolean);
  if (!variants.length) return null;

  // Ratings only when there are real reviews behind them.
  const rating = p.rating && p.rating.count > 0 && p.rating.value >= 1 && p.rating.value <= 5
    ? { '@type': 'AggregateRating', ratingValue: p.rating.value, reviewCount: p.rating.count, bestRating: 5, worstRating: 1 }
    : undefined;

  const group = compact({
    '@type': 'ProductGroup',
    '@id': groupId,
    name: clean(p.name),
    description: clean(p.description),
    url: pageUrl,
    brand: p.brand ? { '@type': 'Brand', name: clean(p.brand) } : undefined,
    productGroupID: p.groupId,
    variesBy: variesBy.map((k) => VARIES_BY[k]),
    aggregateRating: rating,
    hasVariant: variants,
  });

  const crumbs = breadcrumb(page.breadcrumbs, `${pageUrl}#breadcrumb`);
  const webpage = compact({
    '@type': 'ItemPage',
    '@id': `${pageUrl}#webpage`,
    url: pageUrl,
    name: clean(page.title) || clean(p.name),
    isPartOf: { '@id': `${root}/#website` },
    breadcrumb: crumbs ? { '@id': crumbs['@id'] } : undefined,
    mainEntity: { '@id': groupId },
  });

  return { '@context': 'https://schema.org', '@graph': [webpage, crumbs, group].filter(Boolean) };
}

// Node: const { buildProductPageSchema } = require('./product-page-schema.js');
if (typeof module !== 'undefined' && module.exports) module.exports = { buildProductPageSchema };
