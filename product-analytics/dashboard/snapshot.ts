interface Daily {
  day: string;
  dau: number;
  wau: number;
  mau: number;
  page_views: number;
  page_users: number;
}

interface TrafficSource {
  source: string;
  utm_medium: string | null;
  utm_campaign: string | null;
  sessions: number;
  users: number;
  page_views: number;
}

export interface Period {
  days: number;
  from: string;
  to: string;
  sources: TrafficSource[];
  dailySources?: { day: string; sessionsBySource: number[]; otherSessions: number }[];
}

export interface Snapshot {
  app: string;
  from: string;
  to: string;
  timeZone: string;
  observedUntil: string;
  knownAt: string;
  latestReceivedAt: string | null;
  daily: Daily[];
  periods: Period[];
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON オブジェクトが必要です。');
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('文字列の項目が不足しています。');
  return value;
}

function count(value: unknown): number {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('集計値の形式が正しくありません。');
  return value;
}

function date(value: unknown) {
  const day = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('日付の形式が正しくありません。');
  return day;
}

function sources(value: unknown): TrafficSource[] {
  if (!Array.isArray(value)) throw new Error('流入元の集計が見つかりません。');
  return value.map((item) => {
    const row = object(item);
    return { source: text(row.source), utm_medium: row.utm_medium === null ? null : text(row.utm_medium),
      utm_campaign: row.utm_campaign === null ? null : text(row.utm_campaign),
      sessions: count(row.sessions), users: count(row.users), page_views: count(row.page_views) };
  });
}

export function parseSnapshot(value: unknown): Snapshot {
  const data = object(value);
  if (data.version !== 1 || !Array.isArray(data.daily)) throw new Error('対応する集計ファイルを選択してください。');

  const timeZone = text(data.timeZone);
  new Intl.DateTimeFormat('ja', { timeZone });
  if (!Number.isFinite(Date.parse(text(data.knownAt)))) throw new Error('最終集計の日時が正しくありません。');

  const daily = data.daily.map((item) => {
    const row = object(item);
    return { day: date(row.day), dau: count(row.dau), wau: count(row.wau), mau: count(row.mau),
      page_views: count(row.page_views), page_users: count(row.page_users) };
  });
  const from = date(data.from);
  const to = date(data.to);
  const periods = Array.isArray(data.periods) && data.periods.length > 0
    ? data.periods.map((item) => {
      const period = object(item);
      const traffic = sources(period.sources);
      const dailySources = Array.isArray(period.dailySources) ? period.dailySources.map((item) => {
        const row = object(item);
        if (!Array.isArray(row.sessionsBySource) || row.sessionsBySource.length !== traffic.length) {
          throw new Error('日別の流入元とセッション数が対応していません。');
        }
        return { day: date(row.day), sessionsBySource: row.sessionsBySource.map(count), otherSessions: count(row.otherSessions) };
      }) : undefined;
      return { days: count(period.days), from: date(period.from), to: date(period.to), sources: traffic, dailySources };
    })
    : [{ days: daily.length, from, to, sources: sources(data.sources) }];

  const latestReceivedAt = typeof data.latestReceivedAt === 'string' && Number.isFinite(Date.parse(data.latestReceivedAt))
    ? data.latestReceivedAt : null;
  return { app: text(data.app), from, to, timeZone, observedUntil: text(data.observedUntil),
    knownAt: text(data.knownAt), latestReceivedAt, daily, periods };
}
