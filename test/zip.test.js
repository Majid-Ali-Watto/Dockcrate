import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../lib/zip.js';

// Read the archive back through its central directory, the way an unzip tool does.
async function entries(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  const out = {};
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    out[name] = new TextDecoder().decode(bytes.subarray(start, start + size));
    at += 46 + nameLength;
  }
  return out;
}

test('zip keeps paths and contents, including non-ASCII text', async () => {
  const files = [
    { path: 'Dockerfile', content: 'FROM node:22\n' },
    { path: '.github/workflows/ci.yml', content: 'name: ci # ✓\n' },
    { path: 'empty.txt', content: '' },
  ];
  assert.deepEqual(await entries(zip(files)), Object.fromEntries(files.map((f) => [f.path, f.content])));
});
