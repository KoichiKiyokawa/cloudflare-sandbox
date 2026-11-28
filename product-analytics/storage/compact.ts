import { parquetWriteBuffer } from 'hyparquet-writer';
import { eventColumns, manifestFile, parquetPrefix, parseManifest, rawObjectPath, rawPrefix,
  type Chunk, type Manifest } from './layout.ts';

const pageSize = 1000;
const limitPerObject = 1024 * 1024;
// Leave most of the Worker's 128 MiB for UTF-16 strings and Parquet encoding buffers.
const chunkBytes = 8 * 1024 * 1024;

interface Bucket {
  get(key: string): Promise<Pick<R2ObjectBody, 'body' | 'etag' | 'text'> | null>;
  head(key: string): Promise<Pick<R2Object, 'etag'> | null>;
  list(options: Pick<R2ListOptions, 'prefix' | 'limit' | 'startAfter'>): Promise<{
    objects: ReadonlyArray<Pick<R2Object, 'key'>>;
    truncated: boolean;
  }>;
  put(key: string, value: ArrayBuffer | string, options: {
    onlyIf: Pick<R2Conditional, 'etagMatches' | 'etagDoesNotMatch'>;
    httpMetadata?: Pick<R2HTTPMetadata, 'contentType'>;
  }): Promise<Pick<R2Object, 'etag'> | null>;
}
const makeColumns = () => eventColumns.map((name) => ({ name, type: 'STRING' as const, data: new Array<string>() }));

async function readRaw(bucket: Bucket, key: string) {
  const object = await bucket.get(key);
  if (!object) throw new Error(`Missing original object: ${key}`);
  const stream = object.body.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limitPerObject) throw new Error(`Original object exceeds the decoded size limit: ${key}`);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const lines = text.trimEnd().split('\n');
  const rows = lines.map((line) => {
    const row: unknown = JSON.parse(line);
    if (typeof row !== 'object' || row === null) throw new Error(`Invalid original row: ${key}`);
    return eventColumns.map((column) => {
      const value: unknown = Reflect.get(row, column);
      if (typeof value !== 'string') throw new Error(`Missing ${column} in original object: ${key}`);
      return value;
    });
  });
  return { bytes, rows };
}

async function reserveName(raw: string[]): Promise<Chunk> {
  const data = new TextEncoder().encode(raw.join('\n'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { raw, file: hash + '.parquet' };
}

async function compactPartition(bucket: Bucket, partition: string, candidates: string[]) {
  const prefix = parquetPrefix + partition;
  const key = prefix + manifestFile;
  const object = await bucket.get(key);
  let etag = object?.etag;
  let manifest: Manifest = object ? parseManifest(await object.text()) : { chunks: [] };

  async function save(next: Manifest) {
    const object = await bucket.put(key, JSON.stringify(next), {
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json' },
    });
    if (!object) throw new Error(`Concurrent Parquet manifest update: ${key}`);
    manifest = next;
    etag = object.etag;
  }

  function append(columnData: ReturnType<typeof makeColumns>, rows: string[][]) {
    for (const row of rows) {
      for (const [index, column] of columnData.entries()) column.data.push(row[index]);
    }
  }

  async function finish(chunk: Chunk, prepared?: ReturnType<typeof makeColumns>) {
    const parquetKey = prefix + chunk.file;
    if (prepared || !await bucket.head(parquetKey)) {
      const columnData = prepared ?? makeColumns();
      if (!prepared) {
        for (const file of chunk.raw) {
          append(columnData, (await readRaw(bucket, rawPrefix + partition + file)).rows);
        }
      }
      await bucket.put(parquetKey, parquetWriteBuffer({ columnData }), {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/vnd.apache.parquet' },
      });
    }
    await save({ chunks: [...manifest.chunks, chunk] });
  }

  const covered = new Set(manifest.chunks.flatMap((chunk) => chunk.raw));
  let written = 0;
  if (manifest.pending) {
    const pending = manifest.pending;
    await finish(pending);
    for (const file of pending.raw) covered.add(file);
    written += pending.raw.length;
  }

  let raw: string[] = [];
  let columns = makeColumns();
  let bytes = 0;
  async function flush() {
    const chunk = await reserveName(raw);
    await save({ chunks: manifest.chunks, pending: chunk });
    await finish(chunk, columns);
    written += chunk.raw.length;
    raw = [];
    columns = makeColumns();
    bytes = 0;
  }
  for (const file of candidates) {
    if (covered.has(file)) continue;
    const batch = await readRaw(bucket, rawPrefix + partition + file);
    if (bytes + batch.bytes > chunkBytes) await flush();
    append(columns, batch.rows);
    bytes += batch.bytes;
    raw.push(file);
  }
  if (raw.length) await flush();
  return written;
}

export async function compactRawPage(bucket: Bucket, prefix = rawPrefix, scan = 'history', before?: string) {
  const cursorKey = parquetPrefix + '_scan-' + scan + '.json';
  const cursor = await bucket.get(cursorKey);
  const saved = cursor ? await cursor.text() : '';
  if (saved !== '' && !saved.startsWith(rawPrefix)) throw new Error('Invalid R2 compaction cursor');
  const after = saved.startsWith(prefix) ? saved : '';

  const page = await bucket.list({ prefix, limit: pageSize, ...(after ? { startAfter: after } : {}) });
  const partitions = new Map<string, string[]>();
  let last = after;
  let scanComplete = !page.truncated;
  for (const object of page.objects) {
    if (before && object.key >= before) {
      scanComplete = true;
      break;
    }
    last = object.key;
    const path = rawObjectPath(object.key);
    if (!path) continue;
    const files = partitions.get(path.partition) ?? [];
    files.push(path.file);
    partitions.set(path.partition, files);
  }
  if (!scanComplete && last === after) throw new Error('R2 compaction list did not advance');

  let written = 0;
  for (const [partition, files] of partitions) written += await compactPartition(bucket, partition, files);

  const next = scanComplete ? '' : last;
  if (next !== saved) {
    await bucket.put(cursorKey, next, {
      onlyIf: cursor ? { etagMatches: cursor.etag } : { etagDoesNotMatch: '*' },
    });
  }
  return { scanned: page.objects.length, written, scanComplete };
}
