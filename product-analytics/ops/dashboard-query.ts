import { dashboardSnapshot, openAnalysis, rollingReportDates } from '../analysis/database.ts';
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
  const calendar = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const options = { app, timeZone, ...times, ...rollingReportDates(times.observedUntil, days, calendar) };
  const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
  const db = await openAnalysis([source], options, false, signal);
  try {
    const snapshot = await dashboardSnapshot(db, options, true);
    signal?.throwIfAborted();
    if (maxIngestLagHours !== undefined && (!snapshot.latestReceivedAt
      || Date.parse(times.knownAt) - Date.parse(snapshot.latestReceivedAt) > maxIngestLagHours * 3_600_000)) {
      throw new Error('Latest eligible receipt exceeds the allowed age');
    }
    return JSON.stringify(snapshot);
  } finally {
    db.close();
  }
}
