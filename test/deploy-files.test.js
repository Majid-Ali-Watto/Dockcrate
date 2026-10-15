import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the site image runs in hosted mode (no disk access on a public server)', () => {
  assert.match(read('Dockerfile'), /DOCKCRATE_HOSTED=1/);
});

test('Vercel Git deployments are off: the workflow is the only deployer', () => {
  assert.equal(JSON.parse(read('vercel.json')).git.deploymentEnabled, false);
});

test('every action in the deploy workflow is pinned to a commit', () => {
  const uses = [...read('.github/workflows/deploy.yml').matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, u);
});
