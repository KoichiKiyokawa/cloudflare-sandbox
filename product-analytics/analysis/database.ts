import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { serverOnlyEventNames } from '../events/projects.ts';
import { eventColumns } from '../storage/layout.ts';
import { isStorageRoot, storagePaths } from './storage-paths.ts';

export type ReportName = 'active' | 'funnel' | 'retention' | 'history' | 'sessions' | 'acquisition' | 'segment' | 'experiment';
export interface ReportOptions {
  app: string;
  from: string;
  to: string;
  timeZone: string;
  observedUntil: string;
  knownAt: string;
  steps?: string[];
  windowSeconds?: number;
  user?: string;
  event?: string;
  propertyPath?: string;
  experiment?: string;
  conversion?: string;
}

const columnNames = eventColumns.join(', ');
const jsonColumns = '{' + eventColumns.map((name) => `${name}: 'VARCHAR'`).join(', ') + '}';
const sqlFile = (name: string) => readFile(new URL(`./sql/${name}.sql`, import.meta.url), 'utf8');
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const pathList = (paths: string[]) => '[' + paths.map(literal).join(', ') + ']';

export function rollingReportDates(observedUntil: string, days: number, timeZone: string) {
  const calendar = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = new Map(calendar.formatToParts(new Date(observedUntil)).map((part) => [part.type, part.value]));
  const to = `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
  const from = new Date(Date.parse(to) - days * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

async function openStorage(paths: string[], signal?: AbortSignal, app?: string) {
  signal?.throwIfAborted();
  if (!paths.length) throw new Error('Specify a Parquet or NDJSON path');
  const remote = paths.some((path) => path.startsWith('r2://'));
  const other = paths.find((path) => /^[a-z]+:\/\//i.test(path) && !path.startsWith('r2://'));
  if (other) throw new Error('Use a local path or r2://');
  const root = app !== undefined && paths.length === 1 && isStorageRoot(paths[0]) ? paths[0] : undefined;
  if (!root && !paths.every((path) => /\.(?:parquet|ndjson(?:\.gz)?)$/i.test(path))) {
    throw new Error('Specify event files or a single managed storage root');
  }

  const runtime: Record<string, string> = {};
  const { ANALYTICS_DUCKDB_THREADS, ANALYTICS_DUCKDB_MEMORY, ANALYTICS_DUCKDB_TEMP, ANALYTICS_DUCKDB_TEMP_LIMIT } = process.env;
  if (ANALYTICS_DUCKDB_THREADS) runtime.threads = ANALYTICS_DUCKDB_THREADS;
  if (ANALYTICS_DUCKDB_MEMORY) runtime.memory_limit = ANALYTICS_DUCKDB_MEMORY;
  if (ANALYTICS_DUCKDB_TEMP) runtime.temp_directory = ANALYTICS_DUCKDB_TEMP;
  if (ANALYTICS_DUCKDB_TEMP_LIMIT) runtime.max_temp_directory_size = ANALYTICS_DUCKDB_TEMP_LIMIT;
  const instance = await DuckDBInstance.create(':memory:', runtime);
  let connection: DuckDBConnection | undefined;
  const interrupt = () => connection?.interrupt();
  try {
    connection = await instance.connect();
    signal?.addEventListener('abort', interrupt, { once: true });
    signal?.throwIfAborted();
    await connection.run("SET TimeZone = 'UTC'");
    if (remote) {
      const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
      if (!R2_ACCOUNT_ID || !/^[0-9a-f]{32}$/i.test(R2_ACCOUNT_ID) || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
        throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
      }
      await connection.run('INSTALL httpfs; LOAD httpfs;');
      try {
        await connection.run(`CREATE TEMPORARY SECRET analytics_r2 (
          TYPE r2, ACCOUNT_ID ${literal(R2_ACCOUNT_ID)},
          KEY_ID ${literal(R2_ACCESS_KEY_ID)}, SECRET ${literal(R2_SECRET_ACCESS_KEY)}
        )`);
      } catch {
        throw new Error('Could not configure the DuckDB R2 secret');
      }
    }
    const selected = root && app !== undefined ? await storagePaths(connection, root, app, signal) : paths;
    const parquet = selected.filter((path) => path.toLowerCase().endsWith('.parquet'));
    const ndjson = selected.filter((path) => /\.ndjson(?:\.gz)?$/i.test(path));
    const sources = [];
    if (parquet.length) sources.push(`SELECT ${columnNames} FROM read_parquet(${pathList(parquet)}, union_by_name=true, hive_partitioning=false)`);
    if (ndjson.length) sources.push(`SELECT ${columnNames} FROM read_ndjson(${pathList(ndjson)}, columns=${jsonColumns})`);
    if (!sources.length) sources.push(`SELECT ${eventColumns.map((name) => `NULL::VARCHAR AS ${name}`).join(', ')} WHERE false`);
    signal?.throwIfAborted();
    await connection.run(`CREATE TEMP VIEW stored_events AS ${sources.join(' UNION ALL ')}`);
    const connected = connection;
    return {
      connection: connected,
      signal,
      close() {
        signal?.removeEventListener('abort', interrupt);
        connected.closeSync();
        instance.closeSync();
      },
    };
  } catch (error) {
    signal?.removeEventListener('abort', interrupt);
    connection?.closeSync();
    instance.closeSync();
    throw error;
  }
}

export async function openAnalysis(paths: string[], options: ReportOptions, signal?: AbortSignal) {
  const db = await openStorage(paths, signal, options.app);
  try {
    signal?.throwIfAborted();
    await db.connection.run(`CREATE TEMP TABLE report_params AS SELECT
      ?::VARCHAR AS app_id, ?::DATE AS start_date, ?::DATE AS end_date,
      ?::VARCHAR AS time_zone, ?::TIMESTAMPTZ AS observed_until, ?::TIMESTAMPTZ AS known_at,
      ?::JSON::VARCHAR[] AS steps, ?::DOUBLE AS window_seconds, ?::VARCHAR AS user_filter,
      ?::VARCHAR AS event_filter, ?::VARCHAR AS property_path, ?::VARCHAR AS experiment, ?::VARCHAR AS conversion,
      ?::JSON::VARCHAR[] AS server_only_events`, [
      options.app, options.from, options.to, options.timeZone, options.observedUntil, options.knownAt,
      JSON.stringify(options.steps ?? []), options.windowSeconds ?? 86400, options.user ?? null,
      options.event ?? null, options.propertyPath ?? '$', options.experiment ?? null, options.conversion ?? null,
      JSON.stringify(serverOnlyEventNames(options.app)),
    ]);
    const snowplow = await sqlFile('snowplow');
    signal?.throwIfAborted();
    await db.connection.run(snowplow);
    const base = await sqlFile('base');
    signal?.throwIfAborted();
    await db.connection.run(base);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

type AnalysisDatabase = Awaited<ReturnType<typeof openAnalysis>>;

export async function query(db: AnalysisDatabase, sql: string) {
  db.signal?.throwIfAborted();
  const result = await db.connection.runAndReadAll(sql);
  try {
    return result.getRowObjectsJson();
  } finally {
    result.closeSync();
  }
}

export async function report(db: AnalysisDatabase, name: ReportName) {
  return query(db, await sqlFile(name));
}

export async function dashboardReport(db: AnalysisDatabase, options: ReportOptions) {
  const daily = await report(db, 'active');
  const firstDay = daily[0]?.day;
  const lastDay = daily.at(-1)?.day;
  const periods = [];
  if (typeof firstDay === 'string' && typeof lastDay === 'string') {
    const to = new Date(Date.parse(lastDay) + 86_400_000).toISOString().slice(0, 10);
    const days = daily.length;
    const rows = await query(db, await sqlFile('dashboard-acquisition'));
    const sources = rows.filter((item) => item.day === null)
      .map(({ source, utm_medium, utm_campaign, sessions, users, page_views }) => ({ source, utm_medium, utm_campaign, sessions, users, page_views }));
    const dailySources = daily.map(({ day }) => ({
      day, sessionsBySource: sources.map(() => '0'), otherSessions: '0',
    }));
    const dailySourceByDay = new Map(dailySources.map((row) => [row.day, row]));
    for (const row of rows) {
      if (row.day === null) continue;
      const point = dailySourceByDay.get(row.day);
      if (!point) throw new Error('Acquisition day outside the selected period');
      if (row.source_rank === null) point.otherSessions = String(row.sessions);
      else point.sessionsBySource[Number(row.source_rank) - 1] = String(row.sessions);
    }
    periods.push({ days, from: firstDay, to, sources, dailySources });
  }
  const [receipt] = await query(db, `
    SELECT strftime(max(received_at), '%Y-%m-%dT%H:%M:%S.%gZ') AS latest FROM visible_events
  `);
  const latestReceivedAt = typeof receipt?.latest === 'string' ? receipt.latest : null;
  const { app, from, to, timeZone, observedUntil, knownAt } = options;
  return { version: 1, app, from, to, timeZone, observedUntil, knownAt, latestReceivedAt, daily,
    sources: periods[0]?.sources ?? [], periods };
}

export async function pack(paths: string[], destination: string) {
  if (!destination.toLowerCase().endsWith('.parquet')) throw new Error('The destination must be a local .parquet file');
  const output = resolve(destination);
  const temp = `${output}.${randomUUID()}.tmp`;
  await mkdir(dirname(output), { recursive: true });
  const db = await openStorage(paths);
  try {
    await db.connection.run(`COPY (SELECT ${columnNames} FROM stored_events ORDER BY app_id, occurred_at, event_id)
      TO ${literal(temp)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000)`);
    await rename(temp, output);
  } finally {
    db.close();
    await rm(temp, { force: true });
  }
}
