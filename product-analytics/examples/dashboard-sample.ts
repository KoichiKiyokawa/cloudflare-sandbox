import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs, promisify } from 'node:util';
import { decodeBatch, snowplowPayloadSchema } from '../collector/protocol.ts';

const { values } = parseArgs({ options: { 'include-late': { type: 'boolean' } } });
const run = promisify(execFile);
const dayMs = 86_400_000;
const last = Date.parse('2026-11-26T02:00:00Z');
const sampleDays = 195;
const first = last - (sampleDays - 1) * dayMs;
const uuid = (id: number) => `00000000-0000-4000-8000-${id.toString(16).padStart(12, '0')}`;
const publications = ['newsletter', 'search', 'community', ''];

function pageView(day: number, index: number, user: number, occurrence: number, url: string) {
  return {
    aid: 'demo',
    e: 'pv',
    eid: uuid(1 + day * 1000 + index),
    duid: uuid(user),
    sid: uuid(100_000 + day * 100 + user),
    dtm: String(occurrence),
    url,
  };
}

const days = Array.from({ length: sampleDays }, (_, day) => {
  const base = first + day * dayMs;
  const pattern = (day + 30) % 45;
  const count = 18 + (pattern * 13) % 19 + Math.floor(pattern / 6) - ([4, 5].includes(pattern % 7) ? 11 : 0);
  const packets = Array.from({ length: count }, (_, index) => {
    const user = (index + pattern * 3) % 75;
    const source = publications[user % publications.length];
    const path = source ? `https://demo.example/?utm_source=${source}` : 'https://demo.example/';
    const landing = pageView(day, index, user, base + index * 2000, path);
    return (user % 3 === 0)
      ? [landing, pageView(day, index + 500, user, base + index * 2000 + 1000, 'https://demo.example/pricing')]
      : [landing];
  }).flat();
  return decodeBatch({ schema: snowplowPayloadSchema, data: packets }, 'demo', 'browser',
    new Date(base + 3_600_000).toISOString());
});

const late = decodeBatch({
  schema: snowplowPayloadSchema,
  data: Array.from({ length: 5 }, (_, index) =>
    pageView(sampleDays - 1, 100 + index, 80 + index, last + index * 2000, 'https://demo.example/?utm_source=community')),
}, 'demo', 'browser', '2026-11-27T01:00:00.000Z');

const raw = 'local-data/preview/events.ndjson';
const parquet = 'local-data/preview/events.parquet';
const output = 'dashboard/public/snapshot.json';
await mkdir('local-data/preview', { recursive: true });
await writeFile(raw, [...days.flat(), ...late].map((event) => JSON.stringify(event)).join('\n') + '\n');
await run(process.execPath, ['analysis/cli.ts', 'pack', '--source', raw, '--output', parquet]);
await run(process.execPath, ['analysis/cli.ts', 'snapshot', '--source', parquet, '--app', 'demo', '--last-days', '180',
  '--tz', 'Asia/Tokyo', '--observed-until', '2026-11-26T15:00:00Z',
  '--known-at', values['include-late'] ? '2026-11-27T02:00:00Z' : '2026-11-27T00:00:00Z',
  '--output', output]);
console.info(`Wrote ${output} (${values['include-late'] ? 'includes 5 late events' : 'before 5 late events arrived'}).`);
