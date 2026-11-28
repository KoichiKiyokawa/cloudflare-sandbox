import { serveDashboardRequest, type DashboardEnv } from './worker.ts';

export default {
  fetch(request: Request, env: DashboardEnv) {
    if (new URL(request.url).hostname !== '127.0.0.1') return new Response(null, { status: 403 });
    return serveDashboardRequest(request, env, true);
  },
} satisfies ExportedHandler<DashboardEnv>;
