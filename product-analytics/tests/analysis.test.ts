import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dashboardSnapshot, openAnalysis, report } from '../analysis/database.ts';
import { fixture, reportOptions } from './fixture.ts';

test('identity, timezone, late delivery, ordered funnels, retention and exposure share definitions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'product-analytics-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'events.ndjson');
  await writeFile(source, fixture.map((row) => JSON.stringify(row)).join('\n'));
  const db = await openAnalysis([source], reportOptions);
  t.after(() => db.close());
  const users = await report(db, 'active');
  assert.deepEqual(users[0], { day: '2026-01-02', dau: '2', wau: '2', mau: '2', page_views: '3', page_users: '2' });
  const funnel = await report(db, 'funnel');
  assert.deepEqual(funnel.map((row) => row.users), ['2', '1', '1']);
  const retention = await report(db, 'retention');
  assert.deepEqual(retention.filter((row) => row.cohort_day === '2026-01-02')
    .map(({ day_offset, users, eligible }) => [day_offset, users, eligible]),
  [[1, '1', true], [2, '0', true], [7, null, false], [30, null, false]]);
  const experiments = await report(db, 'experiment');
  assert.deepEqual(experiments.map(({ variant, assigned_users, exposed_users, converted_users, multi_variant_users }) =>
    [variant, assigned_users, exposed_users, converted_users, multi_variant_users]), [
    ['control', '1', '1', '1', '0'],
    ['test', '2', '1', '0', '0'],
  ]);
  const history = await report(db, 'history');
  assert.ok(history.filter((row) => row.event_name === 'purchase_completed').every((row) => row.source === 'server'));
  assert.ok(history.some((row) => row.event_name === 'page_view' && row.user_key === 'u:alice'));
  const sessions = await report(db, 'sessions');
  assert.ok(sessions.some((row) => row.utm_source === 'mail & news'));
  assert.ok((await report(db, 'acquisition')).some((row) => row.source === 'mail & news'));
  assert.ok((await report(db, 'segment')).some((row) => row.segment === '"plus"'));
  assert.ok(history.every((row) => row.url !== 'https://another.test/' && row.url !== 'https://duplicate.test/'));
});

test('delayed events revise an eligible cohort, and partial dates stay ineligible', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'product-analytics-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'events.ndjson');
  await writeFile(source, fixture.map((row) => JSON.stringify(row)).join('\n'));

  const revised = await openAnalysis([source], { ...reportOptions, knownAt: '2026-01-06T00:00:00Z' });
  t.after(() => revised.close());
  const rr2 = (await report(revised, 'retention')).find((row) => row.cohort_day === '2026-01-02' && row.day_offset === 2);
  assert.deepEqual(rr2, { cohort_day: '2026-01-02', day_offset: 2, cohort_users: '2', eligible: true, users: '1', rate: 0.5 });

  const partial = await openAnalysis([source], { ...reportOptions, observedUntil: '2026-01-02T16:00:00Z' });
  t.after(() => partial.close());
  const rr1 = (await report(partial, 'retention')).find((row) => row.cohort_day === '2026-01-02' && row.day_offset === 1);
  assert.deepEqual(rr1, { cohort_day: '2026-01-02', day_offset: 1, cohort_users: '2', eligible: false, users: null, rate: null });
  assert.deepEqual((await report(partial, 'active')).map((row) => row.day), ['2026-01-02']);
});

test('conflicting authorized links do not merge separate accounts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'product-analytics-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'events.ndjson');
  const existing = fixture.find((row) => row.source === 'server' && row.payload_json.includes('identity_linked'));
  assert.ok(existing);
  const newUser = {
    ...existing,
    event_id: '00000000-0000-4000-8000-000000000099',
    payload_json: JSON.stringify({ ...JSON.parse(existing.payload_json), uid: 'second-account' }),
  };
  await writeFile(source, [...fixture, newUser].map((row) => JSON.stringify(row)).join('\n'));
  const db = await openAnalysis([source], reportOptions);
  t.after(() => db.close());
  const history = await report(db, 'history');
  for (const name of ['u:alice', 'u:second-account', 'a:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']) {
    assert.ok(history.some((row) => row.user_key === name));
  }
  const landing = history.find((row) => row.url === 'https://example.test/?utm_source=mail%20%26%20news&utm_medium=email');
  assert.equal(landing?.user_key, 'a:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

test('dashboard acquisition counts unique users independently for each selectable period', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'product-analytics-dashboard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'events.ndjson');
  const landing = fixture[0];
  const earlierSession = {
    ...landing,
    event_id: '00000000-0000-4000-8000-000000000099',
    occurred_at: '2025-12-20T03:00:00.000Z',
    received_at: '2025-12-20T03:05:00.000Z',
    payload_json: JSON.stringify({ ...JSON.parse(landing.payload_json), sid: 'earlier-session' }),
  };
  await writeFile(source, [...fixture, earlierSession].map((row) => JSON.stringify(row)).join('\n'));
  const options = { ...reportOptions, from: '2025-12-15' };
  const db = await openAnalysis([source], options);
  t.after(() => db.close());

  const snapshot = await dashboardSnapshot(db, options);
  assert.deepEqual(snapshot.periods.map(({ days, from, to }) => [days, from, to]), [
    [21, '2025-12-15', '2026-01-05'], [14, '2025-12-22', '2026-01-05'], [7, '2025-12-29', '2026-01-05'],
  ]);
  assert.deepEqual(snapshot.periods.map(({ sources }) => {
    const mail = sources.find(({ source }) => source === 'mail & news');
    return [mail?.sessions, mail?.users];
  }), [['2', '1'], ['1', '1'], ['1', '1']]);
});

test('daily acquisition counts each session, including sources outside the top eight', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'product-analytics-acquisition-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'events.ndjson');
  const landing = fixture[0];
  const records = Array.from({ length: 9 }, (_, index) => ({
    ...landing,
    event_id: `source-${index}`,
    payload_json: JSON.stringify({
      ...JSON.parse(landing.payload_json), sid: `session-${index}`, url: `https://example.test/?utm_source=source-${index}`,
    }),
  }));
  await writeFile(source, records.map((row) => JSON.stringify(row)).join('\n'));
  const db = await openAnalysis([source], reportOptions);
  t.after(() => db.close());
  const [period] = (await dashboardSnapshot(db, reportOptions)).periods;
  assert.deepEqual(period.sources.map((row) => row.source), records.slice(0, 8).map((row) => row.event_id));
  assert.deepEqual(period.dailySources, [
    { day: '2026-01-02', sessionsBySource: Array(8).fill('1'), otherSessions: '1' },
    { day: '2026-01-03', sessionsBySource: Array(8).fill('0'), otherSessions: '0' },
    { day: '2026-01-04', sessionsBySource: Array(8).fill('0'), otherSessions: '0' },
  ]);
});

test('funnel uses the Snowplow session event index when timestamps are equal', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'product-analytics-session-index-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'events.ndjson');
  const landing = fixture[0];
  const pricing = fixture[4];
  const events = [landing, pricing].map((row, index) => ({
    ...row,
    event_id: index === 0 ? '00000000-0000-4000-8000-000000000100' : row.event_id,
    occurred_at: landing.occurred_at,
    received_at: landing.received_at,
    payload_json: JSON.stringify({
      ...JSON.parse(row.payload_json),
      co: JSON.stringify({
        schema: 'iglu:com.snowplowanalytics.snowplow/contexts/jsonschema/1-0-0',
        data: [
          { schema: 'iglu:com.example.demo/other_context/jsonschema/1-0-0', data: { eventIndex: 0 } },
          {
            schema: 'iglu:com.snowplowanalytics.snowplow/client_session/jsonschema/1-0-2',
            data: { eventIndex: index + 1 },
          },
        ],
      }),
    }),
  }));
  await writeFile(source, events.map((event) => JSON.stringify(event)).join('\n'));

  const db = await openAnalysis([source], { ...reportOptions, steps: ['page_view', 'pricing_opened'] });
  t.after(() => db.close());
  assert.deepEqual((await report(db, 'history')).map((row) => row.event_name), ['page_view', 'pricing_opened']);
  assert.deepEqual((await report(db, 'funnel')).map((row) => row.users), ['1', '1']);
});
