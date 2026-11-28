import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { cacheRemainingHeader } from '../dashboard/query-endpoint.ts';
import { parseSnapshot } from '../dashboard/snapshot.ts';
import dashboard from '../dashboard/worker.ts';
import { createQueryServer } from '../ops/query-server.ts';
import { fixture } from './fixture.ts';

test('Access gates the fixed DuckDB query and concurrent requests share a one-hour cache', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dashboard-query-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'events.ndjson');
  await writeFile(source, fixture.map((row) => JSON.stringify(row)).join('\n'));
  const before = Date.parse('2026-01-05T00:00:00.000Z');
  let now = before;
  const token = 'integration-test-token-32-characters';
  const server = createQueryServer({ app: 'demo', source, token }, () => now);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const local = `http://127.0.0.1:${address.port}`;
  const nativeFetch = fetch;
  assert.equal((await nativeFetch(local + '/api/dashboard/30')).status, 401);
  const direct = { headers: { Authorization: `Bearer ${token}` } };
  for (const path of ['/api/query', '/api/dashboard/31', '/api/dashboard/030', '/api/dashboard/30?sql=SELECT%201']) {
    assert.equal((await nativeFetch(local + path, direct)).status, 404);
  }

  const issuer = 'https://query-runtime-test.cloudflareaccess.com';
  const upstream = 'https://query-runtime-test.example/';
  const audience = 'b'.repeat(64);
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const key = { ...await exportJWK(publicKey), kid: 'query-test', alg: 'RS256' };
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'query-test' })
    .setIssuer(issuer).setAudience(audience).setExpirationTime('5m').sign(privateKey);
  const config = {
    ACCESS_TEAM: issuer, ACCESS_AUDIENCE: audience, ANALYTICS_QUERY_URL: upstream, ANALYTICS_QUERY_TOKEN: token,
    ASSETS: { fetch: async () => new Response('dashboard template') },
  };
  let forwarded = 0;
  let redirect = false;
  t.mock.method(globalThis, 'fetch', (url: URL, options: RequestInit) => {
    if (String(url) === issuer + '/cdn-cgi/access/certs') return Promise.resolve(Response.json({ keys: [key] }));
    const endpoint = new URL(String(url));
    assert.equal(endpoint.origin + '/', upstream);
    assert.ok(['/api/dashboard/30', '/api/dashboard/7'].includes(endpoint.pathname));
    assert.equal(endpoint.search, '');
    assert.equal(options.redirect, 'manual');
    assert.deepEqual(Object.fromEntries(new Headers(options.headers)), {
      accept: 'application/json', authorization: `Bearer ${token}`,
    });
    forwarded++;
    if (redirect) return Promise.resolve(Response.redirect('https://elsewhere.example/'));
    return nativeFetch(new URL(endpoint.pathname, local), options);
  });
  const request = (path: string, authorize = true, method = 'GET') => dashboard.fetch(new Request(
    new URL(path, 'https://dashboard.example.test'), {
      method, headers: authorize ? { 'Cf-Access-Jwt-Assertion': jwt, 'Cookie': 'browser-only=1' } : undefined,
    },
  ), config);
  const executions = t.mock.method(console, 'info', () => {});
  assert.equal((await request('/api/dashboard/30', false)).status, 403);
  assert.equal((await request('/api/dashboard/30?sql=SELECT%201')).status, 400);
  assert.equal((await request('/api/dashboard/30', true, 'POST')).status, 405);
  for (const path of ['/snapshot.json', '/api/query', '/api/dashboard/31', '/api/dashboard/030']) {
    assert.equal((await request(path)).status, 404);
  }
  assert.equal((await request('/api/dashboard/30?from=2025-01-01')).status, 400);
  assert.equal(forwarded, 0);

  const snapshots = await Promise.all(Array.from({ length: 4 }, async () => {
    const response = await request('/api/dashboard/30');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get(cacheRemainingHeader), '3600000');
    return parseSnapshot(await response.json());
  }));
  assert.equal(executions.mock.callCount(), 1);
  assert.deepEqual(snapshots[0].daily.at(-3), {
    day: '2026-01-02', dau: 2, wau: 2, mau: 2, page_views: 3, page_users: 2,
  });
  assert.ok(snapshots.every((snapshot) => snapshot.knownAt === new Date(before).toISOString()));

  now = before + 3_599_999;
  const almostExpired = await request('/api/dashboard/30', true, 'HEAD');
  assert.equal(almostExpired.headers.get(cacheRemainingHeader), '1');
  assert.equal(await almostExpired.text(), '');
  assert.equal(executions.mock.callCount(), 1);
  now += 1;
  assert.equal(parseSnapshot(await (await request('/api/dashboard/30')).json()).knownAt, new Date(now).toISOString());
  assert.equal(executions.mock.callCount(), 2);
  const lastWeek = parseSnapshot(await (await request('/api/dashboard/7')).json());
  assert.equal(lastWeek.daily.length, 7);
  assert.deepEqual(lastWeek.periods.map((period) => period.days), [7]);
  assert.equal(executions.mock.callCount(), 3);
  assert.equal(parseSnapshot(await (await request('/api/dashboard/30')).json()).daily.length, 30);
  assert.equal(executions.mock.callCount(), 3);
  redirect = true;
  const response = await request('/api/dashboard/30');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Location'), null);
});
