import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { generate } from '../src/generate.js';
import { LANDING, SAMPLE_DIR } from '../lib/landing.js';

test('every guide page has its own slug, title and description', () => {
  for (const key of ['slug', 'title', 'description', 'h1']) {
    const values = LANDING.map((page) => page[key]);
    assert.equal(new Set(values).size, values.length, `${key} must be unique`);
  }
  for (const page of LANDING) {
    assert.match(page.slug, /^[a-z0-9-]+$/);
    assert.ok(page.description.length >= 70 && page.description.length <= 160, `${page.slug}: description length ${page.description.length}`);
    assert.ok(page.title.length <= 60, `${page.slug}: title length ${page.title.length}`);
  }
});

test('every sample is a file the generator really produces', () => {
  for (const page of LANDING) {
    const file = generate(SAMPLE_DIR, page.sample.opts).files.find((f) => f.path === page.sample.file);
    assert.ok(file?.content.trim(), `${page.slug}: no ${page.sample.file} in the output`);
  }
});

test('every guide page has a route folder and every route folder a page', () => {
  const root = new URL('../app/', import.meta.url);
  for (const { slug } of LANDING) {
    assert.ok(existsSync(new URL(`${slug}/page.jsx`, root)), `app/${slug}/page.jsx is missing`);
    assert.match(readFileSync(new URL(`${slug}/page.jsx`, root), 'utf8'), new RegExp(`landingMetadata\\('${slug}'\\)[\\s\\S]*<Landing slug="${slug}" />`));
  }
});

test('the landing page counts match what the generator offers', async () => {
  const { getMeta } = await import('../src/api.js');
  const { STACKS, PROVIDERS, TARGETS, FEATURES } = await import('../lib/home.js');
  const meta = getMeta();
  assert.equal(STACKS.length, meta.stacks.length);
  assert.equal(PROVIDERS.length, meta.providers.length);
  assert.equal(TARGETS.length, meta.targets.length);
  for (const { slug } of FEATURES.filter((f) => f.slug)) assert.ok(LANDING.some((p) => p.slug === slug), `feature links to unknown guide ${slug}`);
});

test('the editor lives at /generator and / is the landing page', () => {
  const app = new URL('../app/', import.meta.url);
  assert.ok(existsSync(new URL('generator/page.jsx', app)));
  assert.ok(existsSync(new URL('generator/loading.jsx', app)), 'the editor skeleton must not wrap the landing page');
  assert.ok(!existsSync(new URL('loading.jsx', app)));
  assert.match(readFileSync(new URL('page.jsx', app), 'utf8'), /<Home \/>/);
});
