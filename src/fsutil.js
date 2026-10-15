import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', '.venv', 'venv']);

export const has = (dir, file) => existsSync(join(dir, file));

export const read = (dir, file) => (has(dir, file) ? readFileSync(join(dir, file), 'utf8') : '');

export function readJson(dir, file) {
  try {
    return JSON.parse(read(dir, file));
  } catch {
    return null;
  }
}

export const firstInt = (text) => text?.match(/\d+/)?.[0];

/** Relative posix paths of files under `dir` whose name passes `test`, descending at most `depth` levels. */
export function find(dir, test, depth = 2, rel = '') {
  const found = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (depth > 0) found.push(...find(dir, test, depth - 1, path));
    } else if (test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Join lines (nested arrays allowed); false/null/undefined parts are dropped so conditionals stay inline.
 * Anything else that is not a string (a stray `0` from `list.length && ...`, `true`) is a bug: fail loudly.
 */
export const lines = (...parts) =>
  parts
    .flat(Infinity)
    .filter((l) => l !== false && l != null)
    .map((l) => {
      if (typeof l !== 'string') throw new TypeError(`lines(): unexpected ${typeof l} part ${JSON.stringify(l)}`);
      return l;
    })
    .join('\n') + '\n';
