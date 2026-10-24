// frontend/tests/lead-intel.test.js — Lead Intelligence UI logic (run: npm test)
// Same input rules as the API (services/lead-intel/src/models/schemas.py), plain-English labels,
// and error messages that never show raw HTML to the user.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLead } from '../src/features/lead-intel/components/Scorer.jsx';
import { factorLabel, minutes, source } from '../src/features/lead-intel/lang.js';
import { call } from '../src/lib/api-client.js';

const OK = { lead_id: 'L-1', total_visits: 3, time_on_site_sec: 300, pages_per_visit: 2 };

describe('checkLead (form validation)', () => {
  it('accepts a normal lead and empty optional fields', () => {
    expect(checkLead(OK)).toEqual({});
    expect(checkLead({ lead_id: '', total_visits: '', time_on_site_sec: '', pages_per_visit: '' })).toEqual({});
  });
  it('refuses time or pages with 0 visits', () => {
    expect(checkLead({ ...OK, total_visits: 0, time_on_site_sec: 600 }).total_visits).toMatch(/0 visits/);
  });
  it('refuses visits without pages, negative and too large numbers', () => {
    expect(checkLead({ ...OK, pages_per_visit: 0 }).pages_per_visit).toBeTruthy();
    expect(checkLead({ ...OK, total_visits: -1 }).total_visits).toBeTruthy();
    expect(checkLead({ ...OK, time_on_site_sec: 999999 }).time_on_site_sec).toBeTruthy();
  });
  it('refuses lead IDs with spaces or HTML', () => {
    expect(checkLead({ ...OK, lead_id: 'bad id' }).lead_id).toBeTruthy();
    expect(checkLead({ ...OK, lead_id: '<script>' }).lead_id).toBeTruthy();
  });
});

describe('plain-English labels', () => {
  it('shows time in seconds or minutes', () => {
    expect(minutes(26)).toBe('26 sec');
    expect(minutes(600)).toBe('10 min');
  });
  it('adds the lead\'s own value to number reasons', () => {
    expect(factorLabel({ feature: 'num__time_on_site_sec', value: 600 })).toBe('Time spent on our website (10 min)');
    expect(factorLabel({ feature: 'cat__occupation_Unemployed', value: 'Unemployed' })).toBe('Job: Unemployed');
  });
  it('never shows an empty source', () => {
    expect(source(null)).toBe('Unknown');
  });
});

describe('gateway errors', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status, body, type = 'text/html') => vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(body, { status, headers: { 'Content-Type': type } })));

  it('turns an nginx 502 HTML page into one sentence', async () => {
    respond(502, '<html><head><title>502 Bad Gateway</title></head></html>');
    await expect(call({ token: 't' }, '/leads/score')).rejects.toMatchObject({ status: 502 });
    try { await call({ token: 't' }, '/leads/score'); } catch (e) {
      expect(e.message).not.toMatch(/<html/);
      expect(e.message).toMatch(/not reachable/);
    }
  });
  it('shows a validation error as plain words', async () => {
    respond(422, JSON.stringify({ detail: [{ loc: ['body', 'pages_per_visit'], msg: 'Input should be greater than or equal to 0' }] }), 'application/json');
    await expect(call({ token: 't' }, '/leads/score', { method: 'POST', body: {} }))
      .rejects.toThrow('pages per visit: Input should be greater than or equal to 0');
  });
});
