import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createPaymentDiagnosticsRouter, isLoopbackAddress } from '../src/routes/paymentDiagnostics.js';

async function withDiagnosticServer(config, run) {
  const app = express();
  app.use('/api/diagnostics', createPaymentDiagnosticsRouter(config));
  const server = app.listen(0, '127.0.0.1');

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}/api/diagnostics/payment-provider`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('development diagnostic reports effective provider and safe booleans only', async () => {
  const config = {
    nodeEnv: 'development',
    paymentProvider: 'chapa',
    chapaEnvironment: 'test',
    chapaSecretKey: 'diagnostic-secret-sentinel',
    chapaWebhookSecret: 'webhook-secret-sentinel',
    stripeSecretKey: 'stripe-secret-sentinel',
    databaseUrl: 'database-url-sentinel',
  };

  await withDiagnosticServer(config, async (url) => {
    const response = await fetch(url);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      provider: 'chapa',
      chapaTestConfiguration: {
        environmentIsTest: true,
        secretConfigured: true,
        valid: true,
      },
    });
    for (const secret of [
      config.chapaSecretKey,
      config.chapaWebhookSecret,
      config.stripeSecretKey,
      config.databaseUrl,
    ]) {
      assert.equal(response.headers.get('content-type')?.includes('application/json'), true);
      assert.equal(JSON.stringify(body).includes(secret), false);
    }
  });
});

test('payment diagnostic route is absent outside local development', async () => {
  for (const nodeEnv of ['test', 'production']) {
    await withDiagnosticServer({ nodeEnv }, async (url) => {
      const response = await fetch(url);
      assert.equal(response.status, 404);
    });
  }
});

test('payment diagnostic accepts loopback addresses only', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.0.0.2'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.10'), false);
  assert.equal(isLoopbackAddress('203.0.113.10'), false);
});
