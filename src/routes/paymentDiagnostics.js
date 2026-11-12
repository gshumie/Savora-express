import { Router } from 'express';
import { canUseChapa, resolvePaymentProvider } from '../services/chapa.js';

function isLoopbackAddress(address) {
  if (address === '::1') return true;
  const normalizedAddress = address?.startsWith('::ffff:')
    ? address.slice('::ffff:'.length)
    : address;
  const octets = normalizedAddress?.split('.').map(Number);
  return octets?.length === 4
    && octets[0] === 127
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
}

export function createPaymentDiagnosticsRouter(config) {
  const router = Router();
  if (config.nodeEnv !== 'development') return router;

  router.get('/payment-provider', (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      return res.sendStatus(404);
    }

    return res.json({
      provider: resolvePaymentProvider(config),
      chapaTestConfiguration: {
        environmentIsTest: config.chapaEnvironment === 'test',
        secretConfigured: typeof config.chapaSecretKey === 'string'
          && config.chapaSecretKey.trim().length > 0,
        valid: canUseChapa({
          nodeEnv: config.nodeEnv,
          environment: config.chapaEnvironment,
          secretKey: config.chapaSecretKey,
        }),
      },
    });
  });

  return router;
}

export { isLoopbackAddress };
