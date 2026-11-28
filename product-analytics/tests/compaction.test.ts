import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { openAnalysis, query } from '../analysis/database.ts';
import { compactRawPage } from '../storage/compact.ts';
import { fixture, reportOptions } from './fixture.ts';

test('DuckDB reads each original exactly once before, during and after publication', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'analytics-compaction-'));
  const model = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: 'compaction', modules: true, script: 'export default { fetch() { return new Response(); } };',
      r2Buckets: { EVENTS: 'compaction' },
    }],
  }));
  t.after(async () => {
    await model.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  const bucket = await model.getR2Bucket('EVENTS');
  const store: Parameters<typeof compactRawPage>[0] = {
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        etag: object.etag,
        text: () => object.text(),
        get body() {
          const reader = object.body.getReader();
          return new ReadableStream<Uint8Array>({
            async pull(controller) {
              const result = await reader.read();
              if (result.done) controller.close();
              else controller.enqueue(result.value);
            },
            cancel: (reason) => reader.cancel(reason),
          });
        },
      };
    },
    head: (key) => bucket.head(key),
    list: (options) => bucket.list(options),
    put: (key, value, options) => bucket.put(key, value, options),
  };
  async function writeRaw(id: string, row: typeof fixture[number]) {
    const key = `raw/v1/${row.received_at.slice(0, 10)}/${row.app_id}/00000000-0000-4000-8000-${id.padStart(12, '0')}.ndjson.gz`;
    await bucket.put(key, gzipSync(JSON.stringify(row) + '\n'));
  }

  async function mirror() {
    for (const entry of (await bucket.list()).objects) {
      const object = await bucket.get(entry.key);
      assert.ok(object);
      const file = join(directory, entry.key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(await object.arrayBuffer()));
    }
  }

  async function rows(db: Awaited<ReturnType<typeof openAnalysis>>) {
    return query(db, 'SELECT * FROM stored_events ORDER BY event_id, payload_json');
  }

  async function assertCurrentRead(expected: typeof fixture) {
    await mirror();
    const db = await openAnalysis([directory + '/'], reportOptions);
    try {
      assert.deepEqual(await rows(db), expected);
    } finally {
      db.close();
    }
  }

  const [first, second, late] = fixture;
  await writeRaw('2', first);
  await writeRaw('3', second);
  await mirror();
  const existing = await openAnalysis([directory + '/'], reportOptions);
  t.after(() => existing.close());
  assert.deepEqual(await rows(existing), [first, second]);

  let inspectedDuringUpload = false;
  const failAfterUpload: typeof store = {
    ...store,
    async put(key, value, options) {
      const object = await store.put(key, value, options);
      if (key.endsWith('.parquet')) {
        await assertCurrentRead([first, second]);
        assert.equal((await bucket.list({ prefix: 'parquet/v1/' })).objects.filter((entry) => entry.key.endsWith('.parquet')).length, 1);
        inspectedDuringUpload = true;
        throw new Error('simulated interruption after uploading Parquet');
      }
      return object;
    },
  };
  await assert.rejects(compactRawPage(failAfterUpload), /simulated interruption/);
  assert.ok(inspectedDuringUpload);

  const recovery = await compactRawPage(store);
  assert.deepEqual(recovery, { scanned: 2, written: 2, scanComplete: true });
  await assertCurrentRead([first, second]);
  assert.deepEqual(await rows(existing), [first, second]);

  // This key sorts before the originals already converted, and belongs to the same UTC day.
  await writeRaw('1', late);
  await assertCurrentRead([first, second, late]);
  const overlapping = await Promise.allSettled([compactRawPage(store), compactRawPage(store)]);
  let written = 0;
  for (const result of overlapping) {
    if (result.status === 'fulfilled') written += result.value.written;
    else assert.match(String(result.reason), /Concurrent Parquet manifest update/);
  }
  assert.equal(written, 1);
  assert.equal((await compactRawPage(store)).written, 0);
  await assertCurrentRead([first, second, late]);
  assert.deepEqual(await rows(existing), [first, second]);
  assert.equal((await bucket.list({ prefix: 'raw/v1/' })).objects.length, 3);
  assert.equal((await bucket.list({ prefix: 'parquet/v1/' })).objects.filter((entry) => entry.key.endsWith('.parquet')).length, 2);
});
