export const CURRENCY = 'ETB';
export const CURRENCY_LOCALE = 'en-ET';
export const TAX_RATE_BASIS_POINTS = 800;
export const DELIVERY_FEE_MINOR_UNITS = 10000;

const currencyFormatter = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  currencyDisplay: 'code',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function toMinorUnits(value) {
  const normalized = typeof value === 'string' ? value.trim() : String(value);
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new RangeError('Monetary values must be non-negative and have at most two decimal places.');
  }

  const wholeUnits = Number(match[1]);
  const fractionalUnits = Number((match[2] || '').padEnd(2, '0'));
  const minorUnits = wholeUnits * 100 + fractionalUnits;
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError('Monetary value exceeds the supported range.');
  }
  return minorUnits;
}

export function minorUnitsToDecimal(minorUnits) {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError('Monetary value must be a safe integer number of minor units.');
  }

  const sign = minorUnits < 0 ? '-' : '';
  const absoluteValue = Math.abs(minorUnits);
  const wholeUnits = Math.floor(absoluteValue / 100);
  const fractionalUnits = String(absoluteValue % 100).padStart(2, '0');
  return `${sign}${wholeUnits}.${fractionalUnits}`;
}

export function formatMinorUnits(minorUnits) {
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0) {
    throw new RangeError('Displayed monetary values must be non-negative safe integer minor units.');
  }
  return currencyFormatter.format(minorUnits / 100);
}

export function calculateTaxMinorUnits(subtotalMinorUnits) {
  if (!Number.isSafeInteger(subtotalMinorUnits) || subtotalMinorUnits < 0) {
    throw new RangeError('Subtotal must be a non-negative safe integer number of minor units.');
  }

  const numerator = BigInt(subtotalMinorUnits) * BigInt(TAX_RATE_BASIS_POINTS);
  return Number((numerator + 5000n) / 10000n);
}

export function calculateCartSubtotalMinorUnits(items) {
  return items.reduce((subtotal, item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 0) {
      throw new RangeError('Cart quantities must be non-negative whole numbers.');
    }
    const lineAmount = toMinorUnits(item.unitPrice) * item.quantity;
    const nextSubtotal = subtotal + lineAmount;
    if (!Number.isSafeInteger(nextSubtotal)) {
      throw new RangeError('Cart subtotal exceeds the supported range.');
    }
    return nextSubtotal;
  }, 0);
}

export function calculateCheckoutTotals(subtotalMinorUnits, fulfillment) {
  const deliveryFeeMinorUnits = fulfillment === 'pickup' ? 0 : DELIVERY_FEE_MINOR_UNITS;
  const taxMinorUnits = calculateTaxMinorUnits(subtotalMinorUnits);
  const totalMinorUnits = subtotalMinorUnits + taxMinorUnits + deliveryFeeMinorUnits;
  if (!Number.isSafeInteger(totalMinorUnits)) {
    throw new RangeError('Checkout total exceeds the supported range.');
  }
  return {
    subtotalMinorUnits,
    taxMinorUnits,
    deliveryFeeMinorUnits,
    totalMinorUnits,
  };
}
