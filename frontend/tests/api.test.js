import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, authConfig, api } from '../src/lib/api-client.js';

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

test('permission rejection refreshes authorization without signing the user out',async t=>{
  const originalFetch=globalThis.fetch,originalWindow=globalThis.window,events=[];
  t.after(()=>{globalThis.fetch=originalFetch;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;});
  globalThis.window={dispatchEvent:event=>events.push(event.type)};
  globalThis.fetch=async()=>Response.json({error:'Permission denied'},{status:403});
  await assert.rejects(api('/email/learning'),error=>error.status===403);
  assert.deepEqual(events,['ciftron-permissions-changed']);
  events.length=0;
  globalThis.fetch=async()=>Response.json({error:'No session'},{status:401});
  await assert.rejects(api('/auth/me'),error=>error.status===401);
  assert.deepEqual(events,[]);
  await assert.rejects(api('/platform/snapshot'),error=>error.status===401);
  assert.deepEqual(events,['ciftron-session-expired']);
});
