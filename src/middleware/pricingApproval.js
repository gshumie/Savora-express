export function requireEtbPriceApproval(config) {
  return (_req, res, next) => {
    if (config.etbPricesApproved) return next();
    return res.status(503).json({ error: 'Checkout is disabled until ETB prices are approved.' });
  };
}
