const LEGACY_PRODUCT_IDS = Object.freeze({
  margherita: 'garden-margherita',
  'savora-burger': 'the-savora-stack',
  pappardelle: 'sunday-pappardelle',
  tiramisu: 'house-tiramisu',
  'house-lemonade': 'fresh-mint-lemonade',
});

export function normalizePersistedCart(savedCart, products) {
  if (!savedCart || typeof savedCart !== 'object' || Array.isArray(savedCart)) {
    return { cart: {}, removedCount: 0 };
  }

  const cart = {};
  let removedCount = 0;
  for (const [savedId, quantity] of Object.entries(savedCart)) {
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
      removedCount += 1;
      continue;
    }

    const product = products.find((item) => item.id === savedId || item.slug === savedId)
      || products.find((item) => item.slug === LEGACY_PRODUCT_IDS[savedId]);
    if (!product) {
      removedCount += 1;
      continue;
    }

    cart[product.id] = Math.min(99, (cart[product.id] || 0) + quantity);
  }
  return { cart, removedCount };
}

export function serializePersistedCart(cart, products) {
  return Object.fromEntries(
    Object.entries(cart).flatMap(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return product && Number.isInteger(quantity) && quantity >= 1 && quantity <= 99
        ? [[product.slug || product.id, quantity]]
        : [];
    }),
  );
}
