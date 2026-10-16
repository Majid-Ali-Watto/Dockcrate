import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the site image runs in hosted mode (no disk access on a public server)', () => {
  assert.match(read('Dockerfile'), /DOCKCRATE_HOSTED=1/);
});

test('the site image names its public address, so canonical and sitemap URLs never follow the request host', () => {
  assert.match(read('Dockerfile'), /SITE_URL=https:\/\/dockcrate\.vercel\.app(\s|$)/);
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

const lastUser = (dockerfile) => [...dockerfile.matchAll(/^\s*USER\s+(\S+)/gm)].at(-1)?.[1];

test('the site image and the Dockerfile.vercel the workflow deploys both end as a user other than root', () => {
  assert.equal(lastUser(read('Dockerfile')), 'node');
  const wf = read('.github/workflows/deploy.yml');
  const vercelfile = wf.slice(wf.indexOf('Dockerfile.vercel" <<DOCKERFILE'), wf.indexOf('\n          DOCKERFILE\n'));
  assert.ok(vercelfile.length > 0, 'the workflow writes Dockerfile.vercel');
  const user = lastUser(vercelfile);
  assert.ok(user && !/^(root|0)(:|$)/.test(user), `final user is ${user}`);
  // port 80 without root: the node binary gets the capability instead
  assert.match(vercelfile, /setcap 'cap_net_bind_service=\+ep'/);
  assert.match(vercelfile, /ENV PORT=80/);
});

test('the Vercel token is only reachable from production-environment jobs, in the steps that use it', () => {
  const wf = read('.github/workflows/deploy.yml');
  const job = (name) => wf.slice(wf.indexOf(`\n  ${name}:`) + 1).split(/\n {2}(?=[\w-]+:\n)/)[0];
  for (const name of ['deploy-production', 'prune-old-images']) {
    const text = job(name);
    assert.match(text, /\n {4}environment: production\b/, `${name} runs in the production environment`);
    assert.doesNotMatch(text, /\n {4}env:\n(?: {6}.*\n)*? {6}VERCEL_TOKEN:/, `${name} has no job-level VERCEL_TOKEN`);
  }
  for (const name of ['test-and-build', 'build-and-push-image']) assert.doesNotMatch(job(name), /VERCEL_TOKEN/);
});

test('the Vercel CLI is installed from a lockfile without install scripts, never with npx', () => {
  const wf = read('.github/workflows/deploy.yml');
  assert.doesNotMatch(wf, /\bnpx\b[^\n]*vercel/);
  assert.match(wf, /npm ci --prefix \.github\/vercel --ignore-scripts/);
  const pkg = JSON.parse(read('.github/vercel/package.json'));
  assert.match(pkg.dependencies.vercel, /^\d+\.\d+\.\d+$/, 'an exact version');
  const lock = JSON.parse(read('.github/vercel/package-lock.json'));
  assert.equal(lock.packages['node_modules/vercel'].version, pkg.dependencies.vercel);
  assert.ok(lock.packages['node_modules/vercel'].integrity);
});

test('no checkout in the deploy workflow leaves the GitHub token in .git/config', () => {
  const wf = read('.github/workflows/deploy.yml');
  const checkouts = wf.split('uses: actions/checkout@').slice(1);
  assert.ok(checkouts.length > 0);
  for (const c of checkouts) assert.match(c.split('\n      - ')[0], /persist-credentials: false/);
});
