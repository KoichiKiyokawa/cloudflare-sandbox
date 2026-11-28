import accessWorker from './access-worker.ts';
import { cacheRemainingHeader, dashboardQueryEndpoint, dashboardReportPath, dashboardReportPeriod } from './query-endpoint.ts';

export interface DashboardEnv {
  ACCESS_TEAM: string;
  ACCESS_AUDIENCE: string;
  ASSETS: Pick<Fetcher, 'fetch'>;
  ANALYTICS_QUERY_URL: string;
  ANALYTICS_QUERY_TOKEN?: string;
}

export async function serveDashboardRequest(authorized: Request, env: Omit<DashboardEnv, 'ACCESS_TEAM' | 'ACCESS_AUDIENCE'>, local = false) {
  const url = new URL(authorized.url);
  const period = dashboardReportPeriod(url.pathname);
  if (period === undefined) {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/snapshot.json') {
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    }
    return env.ASSETS.fetch(authorized);
  }
  const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' };
  if (authorized.method !== 'GET' && authorized.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  }
  if (url.search) return new Response(null, { status: 400, headers });
  const endpoint = dashboardQueryEndpoint(env.ANALYTICS_QUERY_URL, local);
  const token = env.ANALYTICS_QUERY_TOKEN;
  if (!endpoint || !token || token.length < 32) return new Response(null, { status: 503, headers });
  try {
    const result = await fetch(new URL(dashboardReportPath(period), endpoint), {
      method: authorized.method, redirect: 'manual', signal: authorized.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (result.ok && result.headers.get('Content-Type')?.startsWith('application/json')) {
      const responseHeaders = new Headers(headers);
      const remaining = result.headers.get(cacheRemainingHeader);
      if (remaining !== null) responseHeaders.set(cacheRemainingHeader, remaining);
      return new Response(result.body, { status: 200, headers: responseHeaders });
    }
    await result.body?.cancel();
  } catch {
    // Query failures stay behind the authenticated endpoint.
  }
  return new Response(null, { status: 503, headers });
}

export default {
  async fetch(request: Request, env: DashboardEnv) {
    return accessWorker.fetch(request, {
      ACCESS_TEAM: env.ACCESS_TEAM,
      ACCESS_AUDIENCE: env.ACCESS_AUDIENCE,
      ASSETS: { fetch: (authorized: Request) => serveDashboardRequest(authorized, env) },
    });
  },
} satisfies ExportedHandler<DashboardEnv>;
