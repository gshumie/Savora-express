import test from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';

test('config defaults are initialized', () => {
  assert.ok(config.port > 0);
  assert.equal(config.databaseUrl, process.env.DATABASE_URL);
  assert.ok(config.jwtSecret.length > 0);
});

test('base server configuration is valid', () => {
  assert.equal(typeof config.port, 'number');
  assert.equal(typeof config.clientUrl, 'string');
});
