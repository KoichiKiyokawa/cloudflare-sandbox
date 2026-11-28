export const rawPrefix = 'raw/v1/';
export const parquetPrefix = 'parquet/v1/';
export const manifestFile = 'manifest.json';

const rawFilePattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.ndjson\.gz$/;
const parquetFilePattern = /^[0-9a-f]{64}\.parquet$/;
const partitionPattern = /^(\d{4}-\d{2}-\d{2})\/([a-z][a-z0-9-]{0,62})\//;
export const eventColumns = ['app_id', 'event_id', 'occurred_at', 'received_at', 'source', 'payload_json'] as const;

export interface Chunk {
  file: string;
  raw: string[];
}

export interface Manifest {
  chunks: Chunk[];
  pending?: Chunk;
}

export function rawObjectPath(key: string) {
  if (!key.startsWith(rawPrefix)) return;
  const relative = key.slice(rawPrefix.length);
  const partition = partitionPattern.exec(relative);
  if (!partition) return;
  const file = relative.slice(partition[0].length);
  if (!rawFilePattern.test(file)) return;
  return { partition: partition[0], file };
}

export function parseManifest(contents: string): Manifest {
  const value: unknown = JSON.parse(contents);
  function isChunk(item: unknown): item is Chunk {
    return typeof item === 'object' && item !== null
      && 'file' in item && typeof item.file === 'string' && parquetFilePattern.test(item.file)
      && 'raw' in item && Array.isArray(item.raw) && item.raw.length > 0
      && item.raw.every((file: unknown) => typeof file === 'string' && rawFilePattern.test(file));
  }
  if (typeof value !== 'object' || value === null || !('chunks' in value) || !Array.isArray(value.chunks)) {
    throw new Error('Invalid Parquet manifest');
  }
  const chunks: unknown[] = value.chunks;
  if (!chunks.every(isChunk)) throw new Error('Invalid Parquet manifest chunk');
  const pending: unknown = 'pending' in value ? value.pending : undefined;
  if (pending !== undefined && !isChunk(pending)) throw new Error('Invalid pending Parquet chunk');
  const all = pending ? [...chunks, pending] : chunks;
  const raw = new Set<string>();
  const files = new Set<string>();
  for (const chunk of all) {
    if (files.has(chunk.file)) throw new Error('Duplicate Parquet chunk');
    files.add(chunk.file);
    for (const file of chunk.raw) {
      if (raw.has(file)) throw new Error('Overlapping Parquet chunks');
      raw.add(file);
    }
  }
  return { chunks, pending };
}
