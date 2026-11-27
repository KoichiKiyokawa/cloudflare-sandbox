import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { createDashboardApi } from '../dashboard/http-cache.ts';
import { dashboardSnapshot, openAnalysis } from './database.ts';

async function buildDemoSnapshot() {
  const source = fileURLToPath(new URL('../local-data/preview/events.parquet', import.meta.url));
  const options = {
    app: 'demo', timeZone: 'Asia/Tokyo', from: '2026-05-31', to: '2026-11-27',
    observedUntil: '2026-11-26T15:00:00Z', knownAt: '2026-11-27T02:00:00Z',
  };
  const db = await openAnalysis([source], options);
  try {
    return await dashboardSnapshot(db, options);
  } finally {
    db.close();
  }
}

export function dashboardDev(build = buildDemoSnapshot): Plugin {
  const api = createDashboardApi({ build });
  return {
    name: 'analytics-dashboard-http',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/api/dashboard') return next();

        const validator = req.headers['if-none-match'];
        const headers = typeof validator === 'string' ? { 'If-None-Match': validator } : undefined;
        const request = new Request(url, { method: req.method, headers });
        void api(request).then(async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        }).catch(next);
      });
    },
  };
}
