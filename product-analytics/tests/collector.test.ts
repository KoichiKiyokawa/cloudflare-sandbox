import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeBatch, snowplowPayloadSchema } from '../collector/protocol.ts';

const packet = {
  aid: 'demo',
  e: 'pv',
  eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  dtm: '1795737600000',
  url: 'https://demo.example/?utm_source=mail',
};

test('accepts an official page event, preserves the raw data and arrival time', () => {
  const [row] = decodeBatch({ schema: snowplowPayloadSchema, data: [packet] },
    'demo', 'browser', '2026-11-27T01:00:00.000Z');
  assert.deepEqual(row, {
    app_id: 'demo',
    event_id: packet.eid,
    occurred_at: '2026-11-27T00:00:00.000Z',
    received_at: '2026-11-27T01:00:00.000Z',
    source: 'browser',
    payload_json: JSON.stringify(packet),
  });
});

test('rejects mismatched projects, unknown schemas, malformed event IDs and invalid custom properties', () => {
  for (const broken of [
    { ...packet, aid: 'another-app' },
    { ...packet, eid: 'invalid' },
    { ...packet, e: 'ue', ue_pr: '{}' },
    { ...packet, e: 'ue', ue_pr: JSON.stringify({
      schema: 'iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0',
      data: { schema: 'iglu:com.example.demo/purchase_completed/jsonschema/1-0-0', data: { amount: -1 } },
    }) },
  ]) {
    assert.throws(() => decodeBatch({ schema: snowplowPayloadSchema, data: [packet, broken] },
      'demo', 'browser', '2026-11-27T01:00:00.000Z'));
  }
});

test('accepts purchases from an authenticated server source only', () => {
  const purchase = {
    ...packet, e: 'ue', uid: 'sample-account',
    ue_pr: JSON.stringify({
      schema: 'iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0',
      data: { schema: 'iglu:com.example.demo/purchase_completed/jsonschema/1-0-0', data: { plan: 'plus', amount: 10 } },
    }),
  };
  const body = { schema: snowplowPayloadSchema, data: [purchase] };
  assert.throws(() => decodeBatch(body, 'demo', 'browser', '2026-11-27T01:00:00.000Z'), /requires the server endpoint/);
  assert.equal(decodeBatch(body, 'demo', 'server', '2026-11-27T01:00:00.000Z')[0].source, 'server');
});
