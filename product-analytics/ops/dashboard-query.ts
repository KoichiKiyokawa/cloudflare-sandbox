import { dashboardReport, openAnalysis, rollingReportDates } from '../analysis/database.ts';
import type { DashboardPeriod } from '../dashboard/query-endpoint.ts';

export interface DashboardQuery {
  app: string;
  source: string;
  timeZone?: string;
  maxIngestLagHours?: number;
  timeoutMs?: number;
}

export async function runDashboardQuery(query: DashboardQuery, days: DashboardPeriod, times: { knownAt: string; observedUntil: string }) {
  const { app, source, timeZone = 'Asia/Tokyo', maxIngestLagHours, timeoutMs } = query;
  const options = { app, timeZone, ...times, ...rollingReportDates(times.observedUntil, days, timeZone) };
  const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
  const db = await openAnalysis([source], options, signal);
  try {
    const result = await dashboardReport(db, options);
    signal?.throwIfAborted();
    if (maxIngestLagHours !== undefined && (!result.latestReceivedAt
      || Date.parse(times.knownAt) - Date.parse(result.latestReceivedAt) > maxIngestLagHours * 3_600_000)) {
      throw new Error('Latest eligible receipt exceeds the allowed age');
    }
    return JSON.stringify(result);
  } finally {
    db.close();
  }
}
