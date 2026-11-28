import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker from '../dashboard/access-worker.ts';

const issuer = 'https://analytics-example.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const url = 'https://analytics.example.test';

test('protects HTML and the dashboard API with the configured issuer, audience and signing keys', async (t) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const key = { ...await exportJWK(publicKey), kid: 'access-test', alg: 'RS256' };
  const assetPaths: string[] = [];
  const env = {
    ACCESS_TEAM: issuer,
    ACCESS_AUDIENCE: audience,
    ASSETS: {
      async fetch(request: Request) {
        const path = new URL(request.url).pathname;
        assetPaths.push(path);
        return new Response('authorized asset');
      },
    },
  };
  const assertToken = (aud = audience, exp: number | string = '5m', iss = issuer) =>
    new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'access-test' })
      .setIssuer(iss).setAudience(aud).setExpirationTime(exp).sign(privateKey);
  const request = (path: string, token?: string) => new Request(url + path, {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : undefined,
  });
  const keys = t.mock.method(globalThis, 'fetch', async (resource: URL) => {
    assert.equal(String(resource), issuer + '/cdn-cgi/access/certs');
    return Response.json({ keys: [key] });
  });

  for (const path of ['/', '/api/dashboard/30', '/assets/app.js']) {
    assert.equal((await worker.fetch(request(path), env)).status, 403);
  }
  assert.equal(keys.mock.callCount(), 0);
  assert.equal((await worker.fetch(request('/api/dashboard/30', await assertToken()), {
    ...env, ACCESS_TEAM: undefined,
  })).status, 403);
  for (const token of [
    'not-a-token',
    await assertToken('b'.repeat(64)),
    await assertToken(audience, 1),
    await assertToken(audience, '5m', 'https://unrelated.cloudflareaccess.com'),
    await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'access-test' })
      .setIssuer(issuer).setAudience(audience).sign(privateKey),
  ]) {
    assert.equal((await worker.fetch(request('/api/dashboard/30', token), env)).status, 403);
  }
  assert.deepEqual(assetPaths, []);
  for (const path of ['/', '/api/dashboard/30', '/assets/app.js']) {
    const response = await worker.fetch(request(path, await assertToken()), env);
    assert.equal(await response.text(), 'authorized asset');
  }
  assert.deepEqual(assetPaths, ['/', '/api/dashboard/30', '/assets/app.js']);
  assert.equal(keys.mock.callCount(), 1);
});
