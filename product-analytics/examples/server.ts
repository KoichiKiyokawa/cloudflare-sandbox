import { buildSelfDescribingEvent, newTracker } from '@snowplow/node-tracker';
import { setTimeout as delay } from 'node:timers/promises';

interface ServerEvent {
  id: string;
  occurredAt: Date;
  schema: string;
  data: Record<string, unknown>;
}

export async function sendServerEvents(config: {
  appId: string;
  collectorOrigin: string;
  token: string;
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
}, events: ServerEvent[]) {
  if (events.length < 1 || events.length > 100) throw new Error('Send 1–100 events per invocation');
  for (const event of events) {
    if (Buffer.byteLength(JSON.stringify(event.data)) > 12_000) throw new Error('Event properties exceed 12,000 bytes');
  }
  let acknowledged = 0;
  let failure: string | undefined;
  const tracker = newTracker({
    namespace: 'server', appId: config.appId, encodeBase64: false,
  }, {
    endpoint: config.collectorOrigin,
    postPath: `/v1/server/${config.appId}`,
    customHeaders: { Authorization: `Bearer ${config.token}` },
    bufferSize: 101,
    maxPostBytes: 40_000,
    onRequestSuccess: (sent) => { acknowledged += sent.length; },
    onRequestFailure: (_details, response) => { failure = response ? String(response.status) : 'network'; },
  });
  if (config.userId) tracker.setUserId(config.userId);
  if (config.anonymousId) tracker.setDomainUserId(config.anonymousId);
  if (config.sessionId) tracker.setSessionId(config.sessionId);
  for (const event of events) {
    tracker.addPayloadPair('eid', event.id);
    const payload = tracker.track(buildSelfDescribingEvent({ event: { schema: event.schema, data: event.data } }),
      null, { type: 'ttm', value: event.occurredAt.getTime() });
    if (payload?.eid !== event.id) throw new Error('Snowplow did not preserve the caller event ID');
  }
  await tracker.flush();
  // Tracker callbacks are dispatched with setTimeout(0) after each HTTP result.
  await delay(0);
  if (acknowledged !== events.length) {
    throw new Error(`Collector acknowledged ${acknowledged}/${events.length} events (status: ${failure ?? 'unknown'})`);
  }
}
