import type { Crypto as WorkerCrypto } from '@cloudflare/workers-types/index.ts';
import { projects } from '../events/projects.ts';
import { decodeBatch } from './protocol.ts';
import { compactRawPage } from '../storage/compact.ts';
import { rawPrefix } from '../storage/layout.ts';

type CollectorEnv = Pick<Cloudflare.Env, 'SERVER_TOKENS'> & {
  BROWSER_RATE_LIMIT?: RateLimit;
  RAW_EVENTS: R2Bucket;
};

declare const crypto: WorkerCrypto;

const maxBodyBytes = 256 * 1024;

class PayloadTooLarge extends Error {}

async function readBody(body: ReadableStream<Uint8Array> | null): Promise<unknown> {
  if (!body) throw new Error('missing body');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) throw new PayloadTooLarge('batch exceeds 256 KiB');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function isAuthorized(header: string | null, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length < 24 || !header?.startsWith('Bearer ')) return false;
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(token)),
    crypto.subtle.digest('SHA-256', encoder.encode(header.slice(7))),
  ]);
  return crypto.subtle.timingSafeEqual(expected, actual);
}

function getServerToken(tokens: string | undefined, appId: string): unknown {
  try {
    const values: unknown = JSON.parse(tokens ?? '{}');
    return values !== null && typeof values === 'object' && Object.hasOwn(values, appId)
      ? Reflect.get(values, appId)
      : undefined;
  } catch {
    return undefined;
  }
}

export default {
  async scheduled(event, env) {
    const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);
    const today = rawPrefix + utcDate(event.scheduledTime) + '/';
    const yesterday = rawPrefix + utcDate(event.scheduledTime - 86_400_000) + '/';
    for (const [scan, prefix] of [['yesterday', yesterday], ['history', rawPrefix]]) {
      const progress = await compactRawPage(env.RAW_EVENTS, prefix, scan, today);
      console.info({ event: 'parquet_compaction', scan, ...progress });
    }
  },
  async fetch(request, env): Promise<Response> {
    const route = /^\/v1\/(browser|server)\/([a-z][a-z0-9-]{0,62})$/.exec(new URL(request.url).pathname);
    const source = route?.[1];
    const appId = route?.[2];
    if (!appId || (source !== 'browser' && source !== 'server')) return new Response(null, { status: 404 });
    const project = projects.get(appId);
    if (!project) return new Response(null, { status: 404 });

    const cors = new Headers({ Vary: 'Origin' });
    if (source === 'browser') {
      const origin = request.headers.get('Origin');
      if (!origin || !project.origins.includes(origin)) return new Response(null, { status: 403, headers: cors });
      cors.set('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        cors.set('Access-Control-Allow-Methods', 'POST');
        cors.set('Access-Control-Allow-Headers', 'Content-Type');
        cors.set('Access-Control-Max-Age', '86400');
        return new Response(null, { status: 204, headers: cors });
      }
    }
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: cors });
    if (source === 'browser' && env.BROWSER_RATE_LIMIT) {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const { success } = await env.BROWSER_RATE_LIMIT.limit({ key: `ingest:${appId}:${ip}` });
      if (!success) {
        cors.set('Retry-After', '60');
        return new Response(null, { status: 429, headers: cors });
      }
    }
    if (source === 'server' && !await isAuthorized(request.headers.get('Authorization'), getServerToken(env.SERVER_TOKENS, appId))) {
      return new Response(null, { status: 401 });
    }

    const receivedAt = new Date().toISOString();
    let events: ReturnType<typeof decodeBatch>;
    try {
      events = decodeBatch(await readBody(request.body), appId, source, receivedAt);
    } catch (error) {
      const status = error instanceof PayloadTooLarge ? 413 : 400;
      return Response.json({ error: error instanceof Error ? error.message : 'invalid batch' }, { status, headers: cors });
    }

    try {
      const key = `${rawPrefix}${receivedAt.slice(0, 10)}/${appId}/${crypto.randomUUID()}.ndjson.gz`;
      const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
      const compressed = new Blob([lines]).stream().pipeThrough(new CompressionStream('gzip'));
      const bytes = await new Response(compressed).arrayBuffer();
      await env.RAW_EVENTS.put(key, bytes, { httpMetadata: { contentType: 'application/gzip' } });
    } catch (error) {
      console.error({ message: 'event storage failed', appId, source, errorType: error instanceof Error ? error.name : 'unknown' });
      cors.set('Retry-After', '5');
      return new Response(null, { status: 503, headers: cors });
    }
    return new Response(null, { status: 204, headers: cors });
  },
} satisfies ExportedHandler<CollectorEnv>;
