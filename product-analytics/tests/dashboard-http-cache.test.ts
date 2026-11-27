import assert from 'node:assert/strict';
import test from 'node:test';
import { createDashboardApi } from '../dashboard/http-cache.ts';
import { parseSnapshot } from '../dashboard/snapshot.ts';

const snapshot = {
  version: 1, app: 'demo', from: '2026-06-01', to: '2026-11-28', timeZone: 'Asia/Tokyo',
  observedUntil: '2026-11-27T15:00:00Z', knownAt: '2026-11-27T15:00:00Z',
  daily: Array.from({ length: 180 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 5, i + 1)).toISOString().slice(0, 10),
    dau: i, wau: i, mau: i, page_views: i, page_users: i,
  })),
  periods: [
    { days: 180, from: '2026-06-01', to: '2026-11-28', sources: [] },
    { days: 30, from: '2026-10-29', to: '2026-11-28', sources: [{
      source: 'newsletter', utm_medium: null, utm_campaign: null, sessions: 32, users: 26, page_views: 40,
    }] },
  ],
};

test('sends only the selected period and shares one aggregation across revalidation and concurrent requests', async () => {
  let builds = 0;
  let now = 0;
  const api = createDashboardApi({ build: async () => { builds++; return snapshot; }, clock: () => now });
  const request = (days: number, headers?: HeadersInit) => new Request(`http://test/api/dashboard?days=${days}`, { headers });
  const [month, halfYear] = await Promise.all([api(request(30)), api(request(180))]);
  assert.equal(builds, 1);
  assert.equal(month.status, 200);
  assert.equal(month.headers.get('Cache-Control'), 'private, max-age=60');
  const monthBody = parseSnapshot(await month.json());
  assert.equal(monthBody.daily.length, 30);
  assert.equal(monthBody.periods[0].sources[0].sessions, 32);
  assert.deepEqual(monthBody.availableDays, [180, 30]);
  assert.equal(parseSnapshot(await halfYear.json()).daily.length, 180);
  const tag = month.headers.get('ETag');
  assert.ok(tag);
  assert.notEqual(tag, halfYear.headers.get('ETag'));
  const validator = { 'If-None-Match': `"other", W/${tag}` };
  assert.equal((await api(request(30, validator))).status, 304);
  assert.equal(builds, 1);
  now += 61_000;
  assert.equal((await api(request(30, validator))).status, 304);
  assert.equal(builds, 1);
  now += 3_600_000;
  const renewed = await api(request(30, validator));
  assert.equal(renewed.status, 304);
  assert.equal(builds, 2);
  assert.equal((await api(request(31))).status, 400);
});
