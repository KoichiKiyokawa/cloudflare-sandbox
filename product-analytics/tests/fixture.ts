import type { StoredEvent } from '../collector/protocol.ts';
import type { ReportOptions } from '../analysis/database.ts';

const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const chris = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export const reportOptions: ReportOptions = {
  app: 'demo', from: '2026-01-02', to: '2026-01-05', timeZone: 'Asia/Tokyo',
  observedUntil: '2026-01-04T15:00:00Z', knownAt: '2026-01-05T00:00:00Z',
  steps: ['page_view', 'pricing_opened', 'purchase_completed'], windowSeconds: 3600,
  propertyPath: '$.plan', experiment: 'layout', conversion: 'purchase_completed',
};

function row(n: number, time: string, name: string, anonymousId: string, extra: Record<string, unknown> = {},
  properties: Record<string, unknown> = {},
  options: { receivedAt?: string; source?: 'browser' | 'server'; app?: string } = {}): StoredEvent {
  const eventId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const app = options.app ?? 'demo';
  const packet = {
    eid: eventId, aid: app, e: name === 'page_view' ? 'pv' : 'ue',
    duid: anonymousId, sid: `session-${anonymousId[0]}`, ...extra,
    ...(name === 'page_view' ? {} : { ue_pr: JSON.stringify({
      schema: 'iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0',
      data: {
        schema: `iglu:${name === 'identity_linked' || name.startsWith('experiment_') ? 'com.product_analytics' : 'com.example.demo'}/${name}/jsonschema/1-0-0`,
        data: properties,
      },
    }) }),
  };
  return {
    app_id: app, event_id: eventId, occurred_at: new Date(time).toISOString(),
    received_at: new Date(options.receivedAt ?? time).toISOString(),
    source: options.source ?? 'browser', payload_json: JSON.stringify(packet),
  };
}

export const fixture = [
  row(1, '2026-01-01T15:01:00Z', 'page_view', alice, {
    url: 'https://example.test/?utm_source=mail%20%26%20news&utm_medium=email', refr: 'https://other.test',
  }),
  row(2, '2026-01-01T15:02:00Z', 'page_view', alice, { url: 'https://example.test/price' }),
  row(3, '2026-01-01T15:03:00Z', 'page_view', bob, { url: 'https://example.test/' }),
  row(4, '2026-01-01T15:04:00Z', 'experiment_assigned', alice, {}, { experiment_id: 'layout', variant: 'control' }),
  row(5, '2026-01-01T15:05:00Z', 'pricing_opened', alice, {}, { plan: 'plus' }),
  row(6, '2026-01-01T15:06:00Z', 'experiment_exposed', alice, {}, { experiment_id: 'layout', variant: 'control' }),
  row(7, '2026-01-01T15:07:00Z', 'identity_linked', alice, { uid: 'alice' }, { anonymous_id: alice }, { source: 'server' }),
  row(8, '2026-01-01T15:08:00Z', 'purchase_completed', alice, { uid: 'alice' }, { plan: 'plus', amount: 10 }, { source: 'server' }),
  row(9, '2026-01-01T15:09:00Z', 'experiment_assigned', bob, {}, { experiment_id: 'layout', variant: 'test' }),
  row(10, '2026-01-01T15:10:00Z', 'experiment_exposed', bob, {}, { experiment_id: 'layout', variant: 'test' }),
  row(11, '2026-01-01T15:11:00Z', 'experiment_assigned', chris, {}, { experiment_id: 'layout', variant: 'test' }),
  row(12, '2026-01-01T15:02:00Z', 'purchase_completed', bob, {}, { plan: 'free', amount: 0 }),
  row(13, '2026-01-01T16:04:00Z', 'pricing_opened', bob, {}, { plan: 'free' }),
  row(14, '2026-01-02T15:10:00Z', 'page_view', alice, { sid: 'next-session', url: 'https://example.test/return' }, {},
    { receivedAt: '2026-01-04T00:00:00Z' }),
  row(15, '2026-01-03T15:10:00Z', 'page_view', bob, { sid: 'late-session', url: 'https://example.test/late' }, {},
    { receivedAt: '2026-01-06T00:00:00Z' }),
  row(1, '2026-01-01T15:01:00Z', 'page_view', alice, { url: 'https://duplicate.test/' }, {},
    { receivedAt: '2026-01-02T00:00:00Z' }),
  row(1, '2026-01-01T15:01:00Z', 'page_view', alice, { url: 'https://another.test/' }, {}, { app: 'another-app' }),
];
