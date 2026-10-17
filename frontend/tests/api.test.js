import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, authConfig } from '../src/lib/api-client.js';

test('empty proxy errors produce an actionable gateway error instead of a JSON parsing failure', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('', { status: 500 });
  await assert.rejects(authConfig(true), error => error instanceof ApiError && error.status === 500 && /gateway/.test(error.message) && /npm run dev/.test(error.message));
});

test('configuration can be retried successfully after a gateway connection failure', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new TypeError('Connection refused'); };
  await assert.rejects(authConfig(true), error => error instanceof ApiError && error.status === 0);
  const config = { csrf_token: 'a'.repeat(64), google_enabled: false };
  globalThis.fetch = async () => Response.json(config);
  assert.deepEqual(await authConfig(), config);
});

test('successful HTTP responses must actually contain authentication configuration', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ message: 'A different service' });
  await assert.rejects(authConfig(true), error => error instanceof ApiError && error.status === 502);
});
