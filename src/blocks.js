// Every generated file is a list of named blocks. A block is the unit the user can edit, switch off, or add to,
// so no generated line is out of reach. Producers that know their structure emit blocks with stable semantic ids
// (`test.setup-node`); everything else is split into paragraphs (`splitBlocks`).
import { lines } from './fsutil.js';

/** `parts` go through lines(); `gap` puts a blank line before the block (the first block never gets one). */
export const block = (id, title, parts, gap = true) => ({ id, title, gap, text: lines(parts).replace(/\n$/, '') });

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'block';
const clip = (text) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

/**
 * Blocks for a file whose producer did not build them: Dockerfiles split per stage, .dockerignore and
 * .env.example per line, JSON as one block, anything else per paragraph.
 */
export function splitBlocks(path, content) {
  const text = content.replace(/\n+$/, '');
  if (path.endsWith('.json')) return [{ id: 'file', title: path, gap: false, text }];
  if (path === '.dockerignore' || path === '.env.example' || path === '.editorconfig') {
    return text.split('\n').map((line, i) => ({ id: `line-${i}-${slug(line)}`, title: clip(line) || '(blank)', gap: false, text: line }));
  }
  const seen = new Map();
  return text.split(/\n{2,}/).map((paragraph, i) => {
    let id;
    let title = clip(paragraph.split('\n').find((l) => l.trim() && !l.startsWith('# syntax')) ?? paragraph);
    if (/(^|\/)Dockerfile$/.test(path)) {
      const from = paragraph.match(/^FROM\s+\S+(?:\s+AS\s+(\S+))?/im);
      if (from) {
        id = `stage:${from[1] ?? seen.size + 1}`;
        title = `Stage ${from[1] ?? seen.size + 1}: ${clip(paragraph.match(/^FROM\s+(\S+)/im)[1])}`;
      }
    }
    id ??= `block-${i}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return { id: n > 1 ? `${id}-${n}` : id, title, gap: i > 0, text: paragraph };
  });
}

/**
 * Applies the user's edits for one file:
 *   { disabled?, blocks: { [id]: { text?, disabled?, from? } }, add: [{ id, after?, title?, text, disabled? }] }
 * Returns the content plus every block with its status: `edited`, `disabled`, `custom` (added by the user) and
 * `stale` (the generated text changed since the user edited it). `unknown` lists edited ids that matched nothing.
 */
export function assemble(blocks, edit = {}) {
  const overrides = edit.blocks ?? {};
  const known = new Set(blocks.map((b) => b.id));
  // A block added after a step stays glued to it; one added after a job or section gets its own blank line.
  const added = (edit.add ?? []).map((a) => ({ title: a.title || 'Custom block', ...a, gap: a.gap ?? (blocks.find((b) => b.id === a.after)?.gap ?? true), text: String(a.text ?? '').replace(/\n+$/, ''), custom: true, disabled: Boolean(a.disabled) }));
  const placeAt = (anchor) => added.filter((a) => (a.after ?? '') === anchor);
  const orphans = added.filter((a) => a.after && !known.has(a.after));
  const out = [...placeAt('')];
  for (const b of blocks) {
    const o = overrides[b.id];
    const text = typeof o?.text === 'string' ? o.text.replace(/\n+$/, '') : b.text;
    out.push({ ...b, base: b.text, text, edited: text !== b.text, stale: typeof o?.from === 'string' && o.from !== b.text, disabled: Boolean(o?.disabled), custom: false });
    out.push(...placeAt(b.id));
  }
  out.push(...orphans);
  let first = true;
  const content =
    out
      .filter((b) => !b.disabled && b.text !== '')
      .map((b) => {
        const gap = b.gap && !first ? '\n' : '';
        first = false;
        return gap + b.text;
      })
      .join('\n') + '\n';
  return { content: edit.disabled ? null : content, blocks: out, unknown: Object.keys(overrides).filter((id) => !known.has(id)) };
}
