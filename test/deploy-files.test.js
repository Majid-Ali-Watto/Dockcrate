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

test('old images are pruned only after a deploy, keeping two, and never without the current one among them', () => {
  const wf = read('.github/workflows/deploy.yml');
  const prune = wf.slice(wf.indexOf('\n  prune-old-images:'));
  assert.match(prune, /needs: deploy-production\b/);
  assert.match(prune, /KEEP: 2\b/);
  // the guard that stops a surprise from deleting the image that was just deployed
  assert.match(prune, /any\(\.tag == \$sha\)/);
  assert.ok(prune.indexOf('any(.tag == $sha)') < prune.indexOf('vcr image rm'));
});
