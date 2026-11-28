export const cacheRemainingHeader = 'X-Analytics-Cache-Remaining-Ms';
export const dashboardPeriods = [7, 14, 30, 180] as const;
export type DashboardPeriod = typeof dashboardPeriods[number];

export function dashboardReportPath(period: DashboardPeriod) {
  return `/api/dashboard/${period}`;
}

export function dashboardReportPeriod(path: string | undefined) {
  return dashboardPeriods.find((period) => path === dashboardReportPath(period));
}

export function dashboardQueryEndpoint(value: string | undefined, local = false) {
  if (!value) return;
  try {
    const url = new URL(value);
    const secure = url.protocol === 'https:';
    const loopback = local && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if ((secure || loopback) && url.pathname === '/'
      && !url.username && !url.password && !url.search && !url.hash) return url;
  } catch {
    return;
  }
}
