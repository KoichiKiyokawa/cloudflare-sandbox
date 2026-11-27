import { parseArgs } from 'node:util';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { dashboardSnapshot, openAnalysis, pack, query, report, reports, type ReportOptions } from './database.ts';

const help = `Usage
  pnpm run analytics <${reports.join('|')}|query|snapshot> --source PATH --app APP --from YYYY-MM-DD --to YYYY-MM-DD
  pnpm run analytics pack --source PATH --output FILE.parquet

Options
  --source may be repeated. Quote globs. Paths can be local or r2://bucket/key.
  --tz Asia/Tokyo                 Report calendar (default Asia/Tokyo)
  --observed-until ISO_TIMESTAMP   Exclusive event-time cutoff (default now)
  --known-at ISO_TIMESTAMP          Inclusive arrival-time cutoff (default now)
  funnel: --step NAME (2–10 times), --window-seconds NUMBER (default 86400)
  history: --user u:ACCOUNT or a:ANONYMOUS_ID
  segment: --property JSON_PATH [--event NAME]
  experiment: --experiment ID --conversion NAME
  query: --sql-file PATH
  snapshot: [--last-days 180 | --from YYYY-MM-DD --to YYYY-MM-DD] [--output FILE.json]
`;

function requireDate(value: string | undefined, flag: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`Invalid or missing ${flag}`);
  return value;
}

function requireTimestamp(value: string | undefined, fallback: string, flag: string) {
  if (value === undefined) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new Error(`${flag} needs an ISO timestamp with offset`);
  requireDate(value.slice(0, 10), flag);
  return new Date(value).toISOString();
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      source: { type: 'string', multiple: true },
      app: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      tz: { type: 'string' },
      'observed-until': { type: 'string' },
      'known-at': { type: 'string' },
      step: { type: 'string', multiple: true },
      'window-seconds': { type: 'string' },
      user: { type: 'string' },
      event: { type: 'string' },
      property: { type: 'string' },
      experiment: { type: 'string' },
      conversion: { type: 'string' },
      'sql-file': { type: 'string' },
      output: { type: 'string' },
      'last-days': { type: 'string' },
    },
  });
  const [command] = positionals;
  if (values.help || !command) {
    process.stdout.write(help);
    return;
  }
  if (positionals.length !== 1) throw new Error('Use one subcommand');
  const paths = values.source ?? [];
  if (command === 'pack') {
    if (!values.output) throw new Error('pack requires --output');
    await pack(paths, values.output);
    return;
  }

  const reportName = reports.find((name) => name === command);
  if (!reportName && command !== 'query' && command !== 'snapshot') throw new Error(`Unknown report: ${command}`);
  const app = values.app;
  if (!app || !/^[a-z][a-z0-9-]{0,62}$/.test(app)) throw new Error('Use --app with a registered project ID');
  const timeZone = values.tz ?? 'Asia/Tokyo';
  let dateFormat: Intl.DateTimeFormat;
  try {
    dateFormat = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    throw new Error('--tz needs a valid IANA time zone');
  }
  const now = new Date().toISOString();
  const observedUntil = requireTimestamp(values['observed-until'], now, '--observed-until');
  const knownAt = requireTimestamp(values['known-at'], now, '--known-at');
  let from: string;
  let to: string;
  if (values['last-days'] !== undefined) {
    const days = Number(values['last-days']);
    if (command !== 'snapshot' || values.from || values.to || !Number.isInteger(days) || days < 1 || days > 366) {
      throw new Error('--last-days is for snapshot, between 1 and 366 days, without --from or --to');
    }
    const parts = new Map(dateFormat.formatToParts(new Date(observedUntil)).map((part) => [part.type, part.value]));
    to = `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
    from = new Date(Date.parse(to) - days * 86_400_000).toISOString().slice(0, 10);
  } else {
    from = requireDate(values.from, '--from');
    to = requireDate(values.to, '--to');
  }
  if (from >= to) throw new Error('--to must be later than --from');
  const steps = values.step;
  const windowSeconds = Number(values['window-seconds'] ?? 86400);
  if (command === 'funnel' && (!steps || steps.length < 2 || steps.length > 10 || steps.some((step) => !step)
    || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 366 * 86400)) {
    throw new Error('funnel requires 2–10 --step options and a window from 1 second to 366 days');
  }
  if (command === 'segment' && !values.property?.startsWith('$')) throw new Error('segment requires --property with a DuckDB JSON path');
  if (command === 'experiment' && (!values.experiment || !values.conversion)) {
    throw new Error('experiment requires --experiment and --conversion');
  }
  const options: ReportOptions = {
    app, from, to, timeZone, observedUntil, knownAt, steps, windowSeconds,
    user: values.user, event: values.event, propertyPath: values.property,
    experiment: values.experiment, conversion: values.conversion,
  };
  const sql = values['sql-file'];
  if (command === 'query' && !sql) throw new Error('query requires --sql-file');

  const db = await openAnalysis(paths, options);
  try {
    const result = reportName ? await report(db, reportName)
      : sql && command === 'query' ? await query(db, await readFile(sql, 'utf8'))
      : await dashboardSnapshot(db, options);
    const json = JSON.stringify(result, null, 2) + '\n';
    if (values.output) {
      await mkdir(dirname(values.output), { recursive: true });
      const temporary = `${values.output}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, json);
        await rename(temporary, values.output);
      } finally {
        await rm(temporary, { force: true });
      }
    } else {
      process.stdout.write(json);
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Analysis failed');
  process.exitCode = 1;
});
