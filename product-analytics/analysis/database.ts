import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

export const reports = ['active', 'funnel', 'retention', 'history', 'sessions', 'acquisition', 'segment', 'experiment'] as const;
export type ReportName = typeof reports[number];
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

const columns = {
  app_id: 'VARCHAR', event_id: 'VARCHAR', occurred_at: 'VARCHAR',
  received_at: 'VARCHAR', source: 'VARCHAR', payload_json: 'VARCHAR',
};
const columnNames = Object.keys(columns).join(', ');
const jsonColumns = '{' + Object.entries(columns).map(([name, type]) => `${name}: '${type}'`).join(', ') + '}';
const sqlFile = (name: string) => readFile(new URL(`./sql/${name}.sql`, import.meta.url), 'utf8');
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const pathList = (paths: string[]) => '[' + paths.map(literal).join(', ') + ']';

async function openStorage(paths: string[]) {
  if (!paths.length) throw new Error('Specify --source with a Parquet or NDJSON path');
  const remote = paths.some((path) => path.startsWith('r2://'));
  const other = paths.find((path) => /^[a-z]+:\/\//i.test(path) && !path.startsWith('r2://'));
  if (other) throw new Error('Use a local path or r2://');
  const parquet = paths.filter((path) => path.toLowerCase().endsWith('.parquet'));
  const ndjson = paths.filter((path) => /\.ndjson(?:\.gz)?$/i.test(path));
  if (parquet.length + ndjson.length !== paths.length) throw new Error('Sources must end in .parquet, .ndjson or .ndjson.gz');

  const instance = await DuckDBInstance.create(':memory:');
  let connection: DuckDBConnection | undefined;
  try {
    connection = await instance.connect();
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
    const sources = [];
    if (parquet.length) sources.push(`SELECT ${columnNames} FROM read_parquet(${pathList(parquet)}, union_by_name=true, hive_partitioning=false)`);
    if (ndjson.length) sources.push(`SELECT ${columnNames} FROM read_ndjson(${pathList(ndjson)}, columns=${jsonColumns})`);
    await connection.run(`CREATE TEMP VIEW stored_events AS ${sources.join(' UNION ALL ')}`);
    const connected = connection;
    return {
      connection: connected,
      close() {
        connected.closeSync();
        instance.closeSync();
      },
    };
  } catch (error) {
    connection?.closeSync();
    instance.closeSync();
    throw error;
  }
}

export async function openAnalysis(paths: string[], options: ReportOptions) {
  const db = await openStorage(paths);
  try {
    await db.connection.run(`CREATE TEMP TABLE report_params AS SELECT
      ?::VARCHAR AS app_id, ?::DATE AS start_date, ?::DATE AS end_date,
      ?::VARCHAR AS time_zone, ?::TIMESTAMPTZ AS observed_until, ?::TIMESTAMPTZ AS known_at,
      ?::JSON::VARCHAR[] AS steps, ?::DOUBLE AS window_seconds, ?::VARCHAR AS user_filter,
      ?::VARCHAR AS event_filter, ?::VARCHAR AS property_path, ?::VARCHAR AS experiment, ?::VARCHAR AS conversion`, [
      options.app, options.from, options.to, options.timeZone, options.observedUntil, options.knownAt,
      JSON.stringify(options.steps ?? []), options.windowSeconds ?? 86400, options.user ?? null,
      options.event ?? null, options.propertyPath ?? '$', options.experiment ?? null, options.conversion ?? null,
    ]);
    await db.connection.run(await sqlFile('base'));
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

type AnalysisDatabase = Awaited<ReturnType<typeof openAnalysis>>;

export async function query(db: AnalysisDatabase, sql: string, values?: string[]) {
  const result = await db.connection.runAndReadAll(sql, values);
  try {
    return result.getRowObjectsJson();
  } finally {
    result.closeSync();
  }
}

export async function report(db: AnalysisDatabase, name: ReportName) {
  return query(db, await sqlFile(name));
}

export async function dashboardSnapshot(db: AnalysisDatabase, options: ReportOptions) {
  const daily = await report(db, 'active');
  const lastDay = daily.at(-1)?.day;
  const periods = [];
  if (typeof lastDay === 'string') {
    const to = new Date(Date.parse(lastDay) + 86_400_000).toISOString().slice(0, 10);
    const lengths = [daily.length, ...[180, 30, 14, 7].filter((days) => days < daily.length)];
    for (const days of lengths) {
      const from = daily.at(-days)?.day;
      if (typeof from !== 'string') throw new Error('Missing snapshot period start');
      const sources = await query(db, `SELECT * FROM acquisition_between(?::DATE, ?::DATE)
        ORDER BY sessions DESC, source, utm_medium, utm_campaign LIMIT 8`, [from, to]);
      periods.push({ days, from, to, sources });
    }
  }
  const { app, from, to, timeZone, observedUntil, knownAt } = options;
  return { version: 1, app, from, to, timeZone, observedUntil, knownAt, daily, sources: periods[0]?.sources ?? [], periods };
}

export async function pack(paths: string[], destination: string) {
  if (!destination.toLowerCase().endsWith('.parquet')) throw new Error('--output must be a local .parquet file');
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
