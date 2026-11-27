import { identitySchema, projects, sharedEvents } from '../events/projects.ts';

export const snowplowPayloadSchema = 'iglu:com.snowplowanalytics.snowplow/payload_data/jsonschema/1-0-4';
const unstructSchema = 'iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const maxFutureSkewMs = 5 * 60_000;

type EventSource = 'browser' | 'server';
export interface StoredEvent {
  app_id: string;
  event_id: string;
  occurred_at: string;
  received_at: string;
  source: EventSource;
  payload_json: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseNestedJson(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    throw new Error('invalid nested JSON');
  }
}

export function decodeBatch(payload: unknown, appId: string, source: EventSource, receivedAt: string): StoredEvent[] {
  const project = projects.get(appId);
  if (!project) throw new Error('unknown project');
  if (!isObject(payload) || payload.schema !== snowplowPayloadSchema || !Array.isArray(payload.data)
    || payload.data.length === 0 || payload.data.length > 100) {
    throw new Error('expected a Snowplow TP2 batch with 1–100 events');
  }

  const packets: unknown[] = payload.data;
  const receivedMs = Date.parse(receivedAt);
  return packets.map((packet, index) => {
    if (!isObject(packet) || packet.aid !== appId || typeof packet.eid !== 'string' || !uuid.test(packet.eid)) {
      throw new Error(`event ${index + 1}: invalid app or event ID`);
    }
    const timestamp = packet.ttm ?? packet.dtm;
    const occurredMs = typeof timestamp === 'string' && /^\d{1,14}$/.test(timestamp) ? Number(timestamp) : NaN;
    if (!Number.isFinite(occurredMs) || occurredMs > receivedMs + maxFutureSkewMs) {
      throw new Error(`event ${index + 1}: invalid occurrence timestamp`);
    }
    for (const key of ['uid', 'duid', 'sid']) {
      const id = packet[key];
      if (id !== undefined && (typeof id !== 'string' || id.length === 0 || id.length > 256)) {
        throw new Error(`event ${index + 1}: invalid ${key}`);
      }
    }
    if (packet.e === 'ue') {
      if (typeof packet.ue_pr !== 'string') throw new Error('expected an unencoded self-describing event');
      const event = parseNestedJson(packet.ue_pr);
      if (!isObject(event) || event.schema !== unstructSchema || !isObject(event.data) || typeof event.data.schema !== 'string') {
        throw new Error('invalid self-describing event');
      }
      const validator = sharedEvents.get(event.data.schema) ?? project.events.get(event.data.schema);
      if (!validator?.validate(event.data.data).valid) throw new Error('unknown schema or invalid event properties');
      if (event.data.schema === identitySchema && (source !== 'server' || !packet.uid)) {
        throw new Error('identity_linked requires server authentication and uid');
      }
    } else if (packet.e !== 'pv' || typeof packet.url !== 'string') {
      throw new Error('expected a page view or a self-describing event');
    }

    return {
      app_id: appId,
      event_id: packet.eid.toLowerCase(),
      occurred_at: new Date(occurredMs).toISOString(),
      received_at: receivedAt,
      source,
      payload_json: JSON.stringify(packet),
    };
  });
}
