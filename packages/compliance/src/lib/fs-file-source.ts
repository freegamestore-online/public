/**
 * Filesystem-backed FileSource — used by the CLI and CI.
 *
 * Split out of file-source.ts so the node:fs / node:path imports live
 * in a module that only the CLI path pulls in. The Worker path (the
 * VibeCode agent) imports mapFileSource + the checks, which stay
 * node-free, so bundling for Cloudflare Workers never hits node:fs.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { type FileSource, SKIP_DIRS } from './file-source.js';

/**
 * Walks the directory tree once on first list() iteration; uses node:fs
 * for read/readBytes/listDir.
 *
 * Paths containing `..` segments are rejected — every read returns
 * null. Defense in depth: today's checks only pass paths that came
 * from `list()` (which stays inside the root), but a future buggy or
 * malicious check could try `source.read('../etc/passwd')`. We refuse
 * rather than letting `path.join` resolve outside repoDir.
 */
export function fsFileSource(repoDir: string): FileSource {
  return {
    async *list() {
      yield* walk(repoDir, repoDir);
    },
    async read(path) {
      if (hasTraversal(path)) return null;
      try {
        return await readFile(join(repoDir, path), 'utf8');
      } catch {
        return null;
      }
    },
    async readBytes(path) {
      if (hasTraversal(path)) return null;
      try {
        const buf = await readFile(join(repoDir, path));
        return new Uint8Array(buf);
      } catch {
        return null;
      }
    },
    async listDir(dir) {
      if (hasTraversal(dir)) return null;
      try {
        return await readdir(join(repoDir, dir));
      } catch {
        return null;
      }
    },
  };
}

/** True if `path` contains a `..` segment or is absolute. */
function hasTraversal(path: string): boolean {
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return true; // absolute
  return path.split(/[/\\]/).some((seg) => seg === '..');
}

async function* walk(dir: string, root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full, root);
    } else if (entry.isFile()) {
      // Always emit POSIX-style paths so checks can rely on consistent
      // separators across platforms.
      yield relative(root, full).split(sep).join('/');
    }
  }
}
