import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const configModuleUrl = pathToFileURL(resolve('src/config.js')).href;
const isolatedImport = `
  import { createHash } from 'node:crypto';
  try {
    const { config } = await import(process.env.CONFIG_MODULE_URL);
    const result = {
      ok: true,
      secretLength: config.jwtSecret.length,
      secretIsHex: /^[a-f0-9]+$/i.test(config.jwtSecret),
      secretMatchesConfigured: config.jwtSecret === process.env.JWT_SECRET,
    };
    if (!process.env.JWT_SECRET) {
      result.secretFingerprint = createHash('sha256').update(config.jwtSecret).digest('hex');
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, message: error.message }));
    process.exitCode = 1;
  }
`;
const applicationEnvironmentKeys = [
  'JWT_SECRET',
  'NODE_ENV',
  'DATABASE_URL',
  'PAYMENT_STATUS_TOKEN_SECRET',
  'PAYMENT_PROVIDER',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CURRENCY',
  'CHAPA_SECRET_KEY',
  'CHAPA_WEBHOOK_SECRET',
  'CHAPA_ENVIRONMENT',
  'CHAPA_CURRENCY',
  'ETB_PRICES_APPROVED',
  'DIRECT_URL',
  'CLIENT_URL',
  'APP_BASE_URL',
];

function importConfig(overrides = {}) {
  const env = { ...process.env, CONFIG_MODULE_URL: configModuleUrl };
  for (const key of applicationEnvironmentKeys) {
    delete env[key];
  }
  Object.assign(env, {
    NODE_ENV: 'development',
    PAYMENT_PROVIDER: 'demo',
    PAYMENT_STATUS_TOKEN_SECRET: 'test-payment-status-secret-is-not-real',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    CLIENT_URL: 'https://savora.example',
    ...overrides,
  });

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', isolatedImport], {
    cwd: tmpdir(),
    env,
    encoding: 'utf8',
  });
  assert.equal(child.error, undefined);
  const cleanStderr = child.stderr
    .split(/\r?\n/)
    .filter((line) => line && !line.includes('[config] WARNING: Running in production mode with PAYMENT_PROVIDER="demo"'))
    .join('\n');
  assert.equal(cleanStderr, '');
  const output = child.stdout.trim().split(/\r?\n/).at(-1);
  return { ...JSON.parse(output), exitCode: child.status };
}

test('missing JWT_SECRET in development generates a fresh 256-bit fallback', () => {
  const first = importConfig();
  const second = importConfig();

  for (const result of [first, second]) {
    assert.equal(result.exitCode, 0);
    assert.equal(result.ok, true);
    assert.equal(result.secretLength, 64);
    assert.equal(result.secretIsHex, true);
    assert.equal(result.secretMatchesConfigured, false);
  }
  assert.notEqual(first.secretFingerprint, second.secretFingerprint);
});

test('known JWT placeholder and example values are rejected in all environments', () => {
  const placeholders = [
    'dev-secret-change-me',
    'change-this-to-a-long-random-secret',
    'my-example-key',
    'replace-this-value',
    'your_secret',
    'placeholder-value',
  ];

  for (const nodeEnv of ['development', 'production']) {
    for (const JWT_SECRET of placeholders) {
      const result = importConfig({ NODE_ENV: nodeEnv, JWT_SECRET });
      assert.equal(result.exitCode, 1, `${nodeEnv} should reject a known placeholder`);
      assert.equal(result.ok, false);
      assert.match(result.message, /JWT_SECRET must be a private secret/);
    }
  }
});

test('missing, blank, and weak JWT_SECRET values are rejected in production', () => {
  for (const JWT_SECRET of [undefined, '', '   ', 'short-secret']) {
    const overrides = { NODE_ENV: 'production' };
    if (JWT_SECRET !== undefined) overrides.JWT_SECRET = JWT_SECRET;
    const result = importConfig(overrides);

    assert.equal(result.exitCode, 1);
    assert.equal(result.ok, false);
    assert.match(result.message, /at least 32 characters/);
  }
});

test('a valid configured JWT_SECRET is accepted in production', () => {
  const JWT_SECRET = 'test-only-private-jwt-secret-value-32-bytes-minimum';
  const result = importConfig({ NODE_ENV: 'production', JWT_SECRET });

  assert.equal(result.exitCode, 0);
  assert.equal(result.ok, true);
  assert.equal(result.secretMatchesConfigured, true);
  assert.equal(result.secretLength, JWT_SECRET.length);
});

test('missing CLIENT_URL in production throws fatal error', () => {
  const result = importConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'test-only-private-jwt-secret-value-32-bytes-minimum',
    CLIENT_URL: '',
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.ok, false);
  assert.match(result.message, /CLIENT_URL must be configured/);
});
