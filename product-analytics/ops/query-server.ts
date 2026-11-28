import { timingSafeEqual, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cacheRemainingHeader, dashboardReportPeriod, type DashboardPeriod } from '../dashboard/query-endpoint.ts';
import { runDashboardQuery, type DashboardQuery } from './dashboard-query.ts';

const cacheLifetimeMs = 60 * 60_000;
const digest = (value: string) => createHash('sha256').update(value).digest();
const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json; charset=utf-8' };

export function createQueryServer(query: DashboardQuery & { token: string; cache?: boolean }, now = Date.now) {
  const expectedToken = digest(`Bearer ${query.token}`);
  type Result = { body: string; expiresAt: number };
  const cached = new Map<DashboardPeriod, Result>();
  const pending = new Map<DashboardPeriod, Promise<Result>>();

  function report(period: DashboardPeriod) {
    const startedAt = now();
    const saved = cached.get(period);
    if (saved && startedAt < saved.expiresAt) return Promise.resolve(saved);
    const running = pending.get(period);
    if (query.cache !== false && running) return running;
    const cutoff = new Date(startedAt).toISOString();
    const started = performance.now();
    const task = runDashboardQuery(query, period, { knownAt: cutoff, observedUntil: cutoff }).then((body) => {
      console.info(JSON.stringify({ event: 'dashboard_query', app: query.app, duration_ms: Math.round(performance.now() - started) }));
      const result = { body, expiresAt: startedAt + cacheLifetimeMs };
      if (query.cache !== false) cached.set(period, result);
      return result;
    }).catch((error: unknown) => {
      console.warn(JSON.stringify({ event: 'dashboard_query_failed', app: query.app }));
      throw error;
    }).finally(() => { pending.delete(period); });
    if (query.cache !== false) pending.set(period, task);
    return task;
  }

  return createServer(async (request, response) => {
    const period = dashboardReportPeriod(request.url);
    if (period === undefined) {
      response.writeHead(404, headers).end();
      return;
    }
    const authorization = request.headers.authorization;
    if (!authorization || !timingSafeEqual(expectedToken, digest(authorization))) {
      response.writeHead(401, headers).end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const result = await report(period);
      const cacheHeader = query.cache === false ? {} : { [cacheRemainingHeader]: String(Math.max(0, result.expiresAt - now())) };
      response.writeHead(200, { ...headers, ...cacheHeader })
        .end(request.method === 'HEAD' ? undefined : result.body);
    } catch {
      response.writeHead(503, headers).end();
    }
  });
}

if (import.meta.main) {
  const app = process.env.ANALYTICS_APP;
  const source = process.env.ANALYTICS_SOURCE;
  const token = process.env.ANALYTICS_QUERY_TOKEN;
  const timeZone = process.env.ANALYTICS_TIME_ZONE ?? 'Asia/Tokyo';
  const lag = process.env.ANALYTICS_MAX_INGEST_LAG_HOURS;
  const maxIngestLagHours = lag === undefined ? undefined : Number(lag);
  const timeout = process.env.ANALYTICS_QUERY_TIMEOUT_MS;
  const timeoutMs = timeout === undefined ? undefined : Number(timeout);
  if (!app || !/^[a-z][a-z0-9-]{0,62}$/.test(app) || !source || !token || token.length < 32) {
    throw new Error('Set ANALYTICS_APP, ANALYTICS_SOURCE and ANALYTICS_QUERY_TOKEN (at least 32 characters)');
  }
  if (maxIngestLagHours !== undefined && (!Number.isFinite(maxIngestLagHours) || maxIngestLagHours <= 0)) {
    throw new Error('ANALYTICS_MAX_INGEST_LAG_HOURS must be a positive number');
  }
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)) {
    throw new Error('ANALYTICS_QUERY_TIMEOUT_MS must be a positive 32-bit integer');
  }
  new Intl.DateTimeFormat('en', { timeZone });
  const server = createQueryServer({ app, source, token, timeZone, maxIngestLagHours, timeoutMs,
    cache: process.env.ANALYTICS_DEV !== '1' });
  server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address === 'object') console.info(`Listening on port ${address.port}`);
  });
}
