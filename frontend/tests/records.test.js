import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignCSV, dailyCounts } from '../src/lib/records.js';
import { storageRead, storageWrite } from '../src/lib/preferences.js';
test('activity chart counts only actual records in the chosen UTC date range', () => {
  const result = dailyCounts([{ created_at: '2026-10-18T12:00:00Z' }, { created_at: '2026-10-20T00:00:00Z' }, { created_at: '2026-10-20T10:00:00Z' }, { created_at: '2026-10-17T20:00:00Z' }, { created_at: '2026-10-21T00:00:00Z' }], 3, new Date('2026-10-20T14:00:00Z'));
  assert.deepEqual(result, [{ date: '2026-10-18', count: 1 }, { date: '2026-10-19', count: 0 }, { date: '2026-10-20', count: 2 }]);
});
test('an empty database produces an empty activity chart', () => {
  assert.ok(dailyCounts([], 30).every(day => day.count === 0));
});
test('database aggregates retain counts beyond the loaded table rows', () => {
  const result = dailyCounts([{ created_at: '2026-10-20', count: 2500 }], 1, new Date('2026-10-20T14:00:00Z'));
  assert.equal(result[0].count, 2500);
});
test('CSV escapes formulas and leaves unavailable delivery metrics empty', () => {
  const csv = campaignCSV([{ name: '=HYPERLINK("test")', audience: 'A, B', status: 'Draft', sent: null, open: null, click: null }]);
  assert.ok(csv.includes('"\'=HYPERLINK(""test"")"'));
  assert.ok(csv.includes('"A, B"'));
  assert.ok(csv.endsWith('"Draft","","",""'));
});
test('blocked browser preferences do not break the workspace', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  try { assert.equal(storageRead('theme', 'light'), 'light'); assert.equal(storageWrite('theme', 'dark'), false); }
  finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; }
});
