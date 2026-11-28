import { writeFile } from 'node:fs/promises';
import { accessSettings } from './access-settings.ts';
import { dashboardQueryEndpoint } from './query-endpoint.ts';

const [host, app] = process.argv.slice(2);
if (!host || !/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,}$/i.test(host)) {
  throw new Error('Specify a dashboard hostname, for example analytics.example.com');
}
if (!app || !/^[a-z][a-z0-9-]{0,34}$/.test(app)) throw new Error('Specify the project ID (up to 35 characters for deployment)');
const access = accessSettings(process.env.ANALYTICS_ACCESS_TEAM, process.env.ANALYTICS_ACCESS_AUDIENCE);
if (!access) throw new Error('Set ANALYTICS_ACCESS_TEAM to the Access team URL and ANALYTICS_ACCESS_AUDIENCE to the application AUD');

const endpoint = dashboardQueryEndpoint(process.env.ANALYTICS_QUERY_URL);
if (!endpoint || endpoint.hostname === host.toLowerCase()) {
  throw new Error('Set ANALYTICS_QUERY_URL to the HTTPS origin of the separate query server, without a path');
}

await writeFile(new URL('../wrangler.dashboard.generated.json', import.meta.url), JSON.stringify({
  name: `product-analytics-dashboard-${app}`,
  main: 'dashboard/worker.ts',
  compatibility_date: '2026-11-27',
  workers_dev: false,
  preview_urls: false,
  vars: {
    ACCESS_TEAM: access.issuer, ACCESS_AUDIENCE: access.audience,
    ANALYTICS_QUERY_URL: endpoint.href,
  },
  observability: { logs: { enabled: true, invocation_logs: false } },
  assets: { directory: './dist', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'none' },
  routes: [{ pattern: host.toLowerCase(), custom_domain: true }],
}, null, 2) + '\n');
