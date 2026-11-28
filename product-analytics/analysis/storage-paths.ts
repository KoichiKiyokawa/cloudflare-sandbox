import type { DuckDBConnection } from '@duckdb/node-api';
import { manifestFile, parquetPrefix, parseManifest, rawObjectPath, rawPrefix } from '../storage/layout.ts';

export function isStorageRoot(source: string) {
  if (source.startsWith('r2://')) return /^r2:\/\/[a-z0-9][a-z0-9-]{1,62}\/?$/.test(source);
  return source.endsWith('/') && !source.includes('://');
}

export async function storagePaths(connection: DuckDBConnection, source: string, app: string, signal?: AbortSignal) {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(app)) throw new Error('Invalid project for the event storage root');
  const root = source.endsWith('/') ? source : source + '/';

  async function glob(pattern: string) {
    signal?.throwIfAborted();
    const result = await connection.runAndReadAll('SELECT file FROM glob(?)', [root + pattern]);
    try {
      return result.getRowObjectsJson().map(({ file }) => {
        if (typeof file !== 'string' || !file.startsWith(root)) throw new Error('Unexpected event storage path');
        return file;
      });
    } finally {
      result.closeSync();
    }
  }

  const files = await glob(parquetPrefix + '*/' + app + '/' + manifestFile);
  const parquet: string[] = [];
  const covered = new Set<string>();
  for (const filename of files) {
    signal?.throwIfAborted();
    const result = await connection.runAndReadAll('SELECT content FROM read_text(?)', [filename]);
    try {
      const content = result.getRowObjectsJson()[0]?.content;
      if (typeof content !== 'string') throw new Error('Unreadable Parquet manifest');
      const manifest = parseManifest(content);
      const directory = filename.slice(0, -manifestFile.length);
      const partition = directory.slice(root.length + parquetPrefix.length);
      for (const chunk of manifest.chunks) {
        parquet.push(directory + chunk.file);
        for (const file of chunk.raw) covered.add(rawPrefix + partition + file);
      }
    } finally {
      result.closeSync();
    }
  }

  const raw = await glob(rawPrefix + '*/' + app + '/*.ndjson.gz');
  return [...parquet, ...raw.filter((path) => {
    const key = path.slice(root.length);
    return !covered.has(key) && rawObjectPath(key) !== undefined;
  })];
}
