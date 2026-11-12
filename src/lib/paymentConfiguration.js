export function validateCurrencyCode(currency, settingName) {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`${settingName} must be a three-letter uppercase currency code.`);
  }
  if (!Intl.supportedValuesOf('currency').includes(currency)) {
    throw new Error(`${settingName} must be a recognized currency code.`);
  }

  let fractionDigits;
  try {
    fractionDigits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    throw new Error(`${settingName} must be a recognized currency code.`);
  }
  if (fractionDigits !== 2) {
    throw new Error(`${settingName} must use two minor-unit digits.`);
  }

  return currency;
}

export function validatePaymentConfiguration({
  paymentProvider,
  stripeWebhookSecret,
  stripeCurrency,
  catalogCurrency,
}) {
  if (paymentProvider === 'stripe' && !stripeWebhookSecret?.trim()) {
    throw new Error('STRIPE_WEBHOOK_SECRET must be configured when PAYMENT_PROVIDER is stripe.');
  }
  if (
    paymentProvider === 'stripe'
    && stripeCurrency
    && catalogCurrency
    && stripeCurrency !== catalogCurrency
  ) {
    throw new Error('STRIPE_CURRENCY must match the ETB catalog prices; currency conversion is not configured.');
  }
}
