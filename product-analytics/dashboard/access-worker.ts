import { createRemoteJWKSet, jwtVerify } from 'jose';
import { accessSettings } from './access-settings.ts';

interface DashboardEnv {
  ACCESS_TEAM?: string;
  ACCESS_AUDIENCE?: string;
  ASSETS: Pick<Fetcher, 'fetch'>;
}

const keysByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const forbidden = () => new Response('Forbidden', {
  status: 403, headers: { 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request: Request, env: DashboardEnv) {
    const access = accessSettings(env.ACCESS_TEAM, env.ACCESS_AUDIENCE);
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!access || !token) return forbidden();

    let keys = keysByIssuer.get(access.issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', access.issuer), { timeoutDuration: 4000 });
      keysByIssuer.set(access.issuer, keys);
    }

    try {
      await jwtVerify(token, keys, {
        ...access, algorithms: ['RS256'], requiredClaims: ['exp'],
      });
    } catch {
      return forbidden();
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<DashboardEnv>;
