import { createHash } from 'node:crypto';
import { parseSnapshot, type Snapshot } from './snapshot.ts';

const snapshotLifetime = 60 * 60 * 1000;
const browserLifetime = 60;
const ranges = new Set([7, 14, 30, 180]);

function matchesTag(header: string | null, tag: string) {
  return header?.trim() === '*' || (header?.match(/(?:W\/)?"[^"\r\n]*"/g) ?? [])
    .some((candidate) => candidate.replace(/^W\//, '') === tag);
}

export function createDashboardApi({ build, clock = Date.now }: {
  build: () => Promise<unknown>;
  clock?: () => number;
}) {
  let cached: { snapshot: Snapshot; validUntil: number } | undefined;
  let building: Promise<void> | undefined;
  let retryAt = 0;

  return async (request: Request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    const value = new URL(request.url).searchParams.get('days') ?? '30';
    const days = Number(value);
    if (!ranges.has(days) || String(days) !== value) return Response.json({ error: '期間が不正です。' }, { status: 400 });

    if ((!cached || cached.validUntil <= clock()) && clock() >= retryAt) {
      building ??= build().then((snapshot) => {
        cached = { snapshot: parseSnapshot(snapshot), validUntil: clock() + snapshotLifetime };
      }).catch(() => {
        retryAt = clock() + 30_000;
      }).finally(() => {
        building = undefined;
      });
      await building;
    }
    if (!cached) {
      const seconds = Math.max(1, Math.ceil((retryAt - clock()) / 1000));
      return Response.json({ error: '集計を取得できませんでした。' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(seconds) } });
    }

    const { snapshot, validUntil } = cached;
    const period = snapshot.periods.find((item) => item.days === days);
    if (!period) return Response.json({ error: 'この期間の集計がありません。' }, { status: 404 });

    const body = JSON.stringify({
      version: 1, app: snapshot.app, timeZone: snapshot.timeZone, from: period.from, to: period.to,
      observedUntil: snapshot.observedUntil, knownAt: snapshot.knownAt, periods: [period],
      availableDays: snapshot.periods.map((item) => item.days).filter((count) => ranges.has(count)),
      daily: snapshot.daily.filter(({ day }) => day >= period.from && day < period.to),
    });
    const tag = '"' + createHash('sha256').update(body).digest('base64url') + '"';
    const maxAge = Math.min(browserLifetime, Math.max(0, Math.floor((validUntil - clock()) / 1000)));
    const headers = new Headers({ 'Cache-Control': `private, max-age=${maxAge}`, ETag: tag });
    if (matchesTag(request.headers.get('If-None-Match'), tag)) return new Response(null, { status: 304, headers });

    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(body, { headers });
  };
}
