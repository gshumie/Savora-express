import { APPROVED_ETB_PRICES } from './approvedPrices.js';

export class UnapprovedProductPricingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnapprovedProductPricingError';
  }
}

export function getApprovedEtbPrice(product) {
  const slug = product?.slug;
  if (typeof slug !== 'string' || !slug.trim()) {
    throw new UnapprovedProductPricingError('Product is missing its approved pricing identifier.');
  }

  if (!Object.prototype.hasOwnProperty.call(APPROVED_ETB_PRICES, slug)) {
    throw new UnapprovedProductPricingError('Product does not have an approved ETB price.');
  }

  return APPROVED_ETB_PRICES[slug];
}

export function applyApprovedEtbPrices(products) {
  if (!Array.isArray(products)) {
    throw new TypeError('Products must be provided as an array.');
  }

  const seenSlugs = new Set();
  return products.map((product) => {
    const price = getApprovedEtbPrice(product);
    if (seenSlugs.has(product.slug)) {
      throw new UnapprovedProductPricingError('Product pricing identifier is ambiguous.');
    }
    seenSlugs.add(product.slug);
    return { ...product, price };
  });
}
