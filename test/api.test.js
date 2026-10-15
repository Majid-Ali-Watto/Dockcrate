import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { HttpError, apiRoute, getMeta, guard, handleBrowse, handleGenerate } from '../src/api.js';

const scratch = (prefix) => mkdtempSync(join(tmpdir(), prefix));
/** A project folder to add the files to. */
const node = () => scratch('dockcrate-api-');
const code = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
};

test('meta describes stacks, targets and the option vocabularies', () => {
  const meta = getMeta();
  const react = meta.stacks.find((s) => s.id === 'react');
  assert.deepEqual(react.tools, ['npm', 'yarn', 'pnpm']);
  assert.equal(react.backend, false);
  assert.equal(react.usesBuildArgs, true);
  assert.equal(meta.stacks.find((s) => s.id === 'fastapi').port, 8000);
  assert.deepEqual(meta.stacks.find((s) => s.id === 'java').ciSteps, ['test', 'build']);
  assert.equal(meta.stacks.find((s) => s.id === 'dotnet').usesName, true);
  assert.deepEqual(meta.kinds, ['dockerfile', 'dockerignore', 'compose', 'ci', 'deploy', 'repo']);
  assert.deepEqual(meta.extras, ['dependabot', 'devcontainer', 'makefile', 'editorconfig']);
  assert.deepEqual(meta.pipeline.registry, ['builtin', 'dockerhub', 'quay', 'custom', 'gar', 'ecr', 'acr']);
  assert.deepEqual(meta.registries.find((r) => r.id === 'quay'), { id: 'quay', label: 'Quay.io', serverLogin: true });
  assert.equal(meta.registries.find((r) => r.id === 'ecr').serverLogin, false);
  assert.equal(meta.targets.find((t) => t.id === 'ssh').serverLogin, true);
  assert.ok(meta.targets.some((t) => t.id === 'cloudrun' && t.oidc && t.deploys && !t.files));
  assert.ok(meta.targets.some((t) => t.id === 'kubernetes' && t.files));
  assert.deepEqual(meta.pipeline.deployOn, ['branch', 'tag', 'manual']);
  assert.ok(meta.dbs.includes('rabbitmq'));
  assert.equal(meta.cwd, process.env.DOCKCRATE_CWD ?? process.cwd());
});

test('preview generates without writing; blank form fields are ignored', () => {
  const dir = node();
  const data = handleGenerate({ dir, stack: 'node', ci: 'github', port: '', runtime: '', buildDir: '', db: [], healthcheck: '', packages: '', env: '' });
  assert.equal(data.stack, 'node');
  assert.ok(data.files.some((f) => f.path === 'Dockerfile'));
  assert.equal(existsSync(join(dir, 'Dockerfile')), false);
  assert.deepEqual(data.ci.available, ['lint', 'test', 'build', 'audit']);
});

test('files carry their current on-disk content (null when absent)', () => {
  const dir = node();
  writeFileSync(join(dir, 'Dockerfile'), 'FROM scratch\n');
  const { files } = handleGenerate({ dir, stack: 'node' });
  assert.equal(files.find((f) => f.path === 'Dockerfile').existing, 'FROM scratch\n');
  assert.equal(files.find((f) => f.path === 'docker-compose.yml').existing, null);
});

test('write creates files, then skips them unless forced', () => {
  const dir = node();
  assert.ok(handleGenerate({ dir, stack: 'node', write: true }).written.every((w) => w.status === 'written'));
  assert.ok(existsSync(join(dir, 'Dockerfile')));
  assert.ok(handleGenerate({ dir, stack: 'node', write: true }).written.every((w) => w.status === 'skipped'));
  assert.ok(handleGenerate({ dir, stack: 'node', write: true, force: true }).written.every((w) => w.status === 'written'));
});

test('browse lists subfolders, hiding dotfolders and node_modules', () => {
  const root = scratch('dockcrate-browse-');
  for (const d of ['zeta', 'app', '.hidden', 'node_modules']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'file.txt'), '');
  const data = handleBrowse({ dir: root });
  assert.equal(data.dir, root);
  assert.equal(data.parent, dirname(root));
  assert.deepEqual(data.entries, [{ name: 'app' }, { name: 'zeta' }]);
  assert.equal(code(() => handleBrowse({ dir: join(root, 'file.txt') })), 400);
  assert.ok(handleBrowse({}).dir);
});

test('preview needs no folder; write needs one and creates it', () => {
  const data = handleGenerate({ stack: 'fastapi', tool: 'uv', name: '', build: true, include: ['dockerfile', 'compose'] });
  assert.deepEqual(data.files.map((f) => f.path), ['Dockerfile', 'docker-compose.yml']);
  assert.ok(data.files.every((f) => f.existing === null));
  assert.match(data.files[0].content, /uv sync/);

  assert.equal(code(() => handleGenerate({ stack: 'fastapi', write: true })), 400);
  const target = join(scratch('dockcrate-new-'), 'brand', 'new');
  assert.ok(handleGenerate({ stack: 'node', dir: target, write: true }).written.every((w) => w.status === 'written'));
  assert.ok(existsSync(join(target, 'Dockerfile')));

  const dir = node();
  writeFileSync(join(dir, 'package.json'), '{}');
  assert.equal(code(() => handleGenerate({ stack: 'node', dir: join(dir, 'package.json') })), 400);
  assert.equal(code(() => handleGenerate({ dir: target })), 400);
  assert.equal(code(() => handleGenerate({ stack: 'node', include: [] })), 400);
});

test('user errors are 400s with a message', () => {
  const dir = node();
  assert.equal(code(() => handleGenerate({ dir })), 400, 'a stack is needed');
  assert.equal(code(() => handleGenerate({ dir, stack: 'node', db: ['mysql', 'mariadb'] })), 400);
  assert.equal(code(() => handleGenerate({ dir, stack: 'cobol' })), 400);
  assert.throws(() => handleGenerate({ dir, stack: 'node', env: ['NOPE'] }), (e) => e instanceof HttpError && /use NAME=value/.test(e.message));
});


test('deploy and pipeline options reach the generator (strings are split, empty tags mean none)', () => {
  const data = handleGenerate({
    stack: 'node', ci: 'github', deploy: 'cloudrun', deployOn: 'manual', environment: 'staging',
    branches: 'main, release/*', tags: '', pullRequests: false, manual: false, schedule: '',
    concurrency: 'queue', permissions: ['id-token-write'], testVersions: '20, 22', testOs: [], platforms: [],
    include: ['ci', 'deploy'],
  });
  const ci = data.files.find((f) => f.kind === 'ci').content;
  assert.match(ci, /branches: \["main","release\/\*"\]/);
  assert.doesNotMatch(ci, /\n {4}tags:|\n {2}pull_request:/);
  assert.match(ci, /version: \["20","22"\]/);
  assert.match(ci, /environment: staging/);
  assert.match(ci, /workload_identity_provider/);
  assert.ok(data.notes.some((n) => /GCP_WORKLOAD_IDENTITY_PROVIDER/.test(n)));
  assert.equal(code(() => handleGenerate({ stack: 'node', deploy: 'ssh', schedule: 'nonsense' })), 400);
});

test('CI steps, services, scan and container options reach the generator', () => {
  const data = handleGenerate({
    stack: 'node', include: ['dockerfile', 'ci'],
    ciSteps: ['lint', 'test'], ciServices: ['postgres'], scan: true,
    healthcheck: '/health', packages: 'curl, tini', env: 'LOG_LEVEL=info\nTZ=UTC', buildArgs: 'API_URL=http://x',
  });
  const ci = data.files.find((f) => f.kind === 'ci').content;
  const df = data.files.find((f) => f.kind === 'dockerfile').content;
  assert.match(ci, /run: npm run lint\n\s+- run: npm test\n/);
  assert.doesNotMatch(ci, /npm run build/);
  assert.match(ci, /services:\n {6}postgres:/);
  assert.match(ci, /trivy-action/);
  assert.match(df, /HEALTHCHECK/);
  assert.match(df, /apk add --no-cache curl tini/);
  assert.match(df, /ENV LOG_LEVEL="info"\nENV TZ="UTC"/);
  assert.match(df, /ARG API_URL=http:\/\/x/);
  assert.deepEqual(data.ci.selected, ['lint', 'test']);
  const none = handleGenerate({ stack: 'node', ciSteps: [] });
  assert.deepEqual(none.ci.selected, []);
});

test('supply-chain options, registry and extra files reach the generator', () => {
  const data = handleGenerate({
    stack: 'go', registry: 'dockerhub', lintDockerfile: true, sbom: true, sign: true, codeScan: true,
    extras: ['dependabot', 'makefile'],
  });
  const paths = data.files.map((f) => f.path);
  assert.ok(paths.includes('.github/workflows/codeql.yml'));
  assert.ok(paths.includes('.github/dependabot.yml'));
  assert.ok(paths.includes('Makefile'));
  const ci = data.files.find((f) => f.path === '.github/workflows/ci.yml').content;
  assert.match(ci, /DOCKERHUB_TOKEN/);
  assert.match(ci, /hadolint/);
  assert.match(ci, /cosign sign/);
  assert.match(ci, /provenance/);
  assert.equal(code(() => handleGenerate({ stack: 'go', extras: ['nope'] })), 400);
});

test('guard: only localhost hosts and same-origin requests', () => {
  guard(new Headers({ host: 'localhost:4173' }));
  guard(new Headers({ host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' }));
  assert.equal(code(() => guard(new Headers({ host: 'evil.example' }))), 403);
  assert.equal(code(() => guard(new Headers({ host: 'localhost:4173', origin: 'https://evil.example' }))), 403);
  assert.equal(code(() => guard(new Headers())), 403);
});

const call = (handler, { headers = {}, body = '{}' } = {}) =>
  apiRoute(handler)(new Request('http://localhost:4173/api/x', { method: 'POST', headers: { host: 'localhost:4173', 'content-type': 'application/json', ...headers }, body }));

test('apiRoute: JSON in, JSON out, statuses for the failure modes', async () => {
  const ok = await call((b) => ({ echoed: b.x }), { body: '{"x":1}' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { echoed: 1 });
  assert.equal((await call(() => ({}), { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(() => ({}), { body: '{not json' })).status, 400);
  assert.equal((await call(() => ({}), { body: JSON.stringify({ pad: 'x'.repeat(600 * 1024) }) })).status, 413);
  const boom = await call(() => {
    throw new Error('secret internals');
  });
  assert.equal(boom.status, 500);
  assert.equal((await boom.json()).error, 'internal error');
  const bad = await call(() => {
    throw new HttpError(400, 'nope');
  });
  assert.deepEqual(await bad.json(), { error: 'nope' });
});

test('apiRoute refuses foreign origins before running the handler', async () => {
  let ran = false;
  const res = await call(() => {
    ran = true;
    return {};
  }, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal(ran, false);
});

test('written files are exactly the previewed ones', () => {
  const dir = node();
  const preview = handleGenerate({ dir, stack: 'node', ciSteps: ['build'] });
  handleGenerate({ dir, stack: 'node', ciSteps: ['build'], write: true });
  for (const f of preview.files) assert.equal(readFileSync(join(dir, f.path), 'utf8'), f.content);
});

// ---- hosted mode (Vercel): nothing may touch the server's disk
const hosted = async (fn) => {
  process.env.DOCKCRATE_HOSTED = '1';
  try {
    return await fn();
  } finally {
    delete process.env.DOCKCRATE_HOSTED;
  }
};

test('hosted: meta exposes no server paths and says it is hosted', () =>
  hosted(() => {
    const meta = getMeta();
    assert.equal(meta.hosted, true);
    assert.equal(meta.cwd, '');
    assert.equal(meta.home, '');
  }));

test('hosted: any Host is accepted, a foreign Origin is still refused', () =>
  hosted(() => {
    guard(new Headers({ host: 'dockcrate.vercel.app' }));
    guard(new Headers({ host: 'dockcrate.vercel.app', origin: 'https://dockcrate.vercel.app' }));
    assert.equal(code(() => guard(new Headers({ host: 'dockcrate.vercel.app', origin: 'https://evil.example' }))), 403);
  }));

test('hosted: browsing and writing are refused; files generate without a folder', () =>
  hosted(() => {
    assert.equal(code(() => handleBrowse({ dir: '/' })), 404);
    assert.equal(code(() => handleGenerate({ stack: 'node', dir: '/tmp', write: true })), 400);
    const target = join(scratch('dockcrate-hosted-'), 'never');
    const data = handleGenerate({ stack: 'node', dir: target });
    assert.equal(data.dir, null);
    assert.ok(data.files.some((f) => f.path === 'Dockerfile' && f.existing === null));
    assert.equal(existsSync(target), false);
  }));

test('local mode is unchanged when the hosted flag is off', () => {
  assert.equal(getMeta().hosted, false);
  assert.equal(code(() => guard(new Headers({ host: 'dockcrate.vercel.app' }))), 403);
});

const fullstack = () => ({ services: [{ name: 'api', dir: 'api', stack: 'django' }, { name: 'web', dir: 'web', stack: 'vue' }] });

test('services and environments reach the generator; the result lists the services', () => {
  const auto = handleGenerate(fullstack());
  assert.equal(auto.multi, true);
  assert.deepEqual(auto.services.map((s) => [s.name, s.stack, s.port]), [['api', 'django', 8000], ['web', 'vue', 8080]]);
  const edited = handleGenerate({
    envs: 'dev, prod',
    services: [{ name: 'api', dir: 'api', stack: 'django', port: '9000', db: ['postgres'] }, { name: 'site', dir: 'web', stack: 'vue', port: '' }],
  });
  assert.deepEqual(edited.services.map((s) => [s.name, s.port, s.db]), [['api', 9000, ['postgres']], ['site', 8080, []]]);
  assert.ok(edited.files.some((f) => f.path === 'docker-compose.dev.yml') && edited.files.some((f) => f.path === 'web/Dockerfile.dev'));
});

test('service errors are 400s with a message', () => {
  assert.equal(code(() => handleGenerate({ services: [{ dir: 'api' }] })), 400, 'a service needs a stack');
  assert.equal(code(() => handleGenerate({ services: ['api'] })), 400);
  assert.equal(code(() => handleGenerate({ services: [{ dir: '../etc', stack: 'node' }] })), 400);
  assert.equal(code(() => handleGenerate({ ...fullstack(), port: '9000' })), 400);
  assert.equal(code(() => handleGenerate({ ...fullstack(), envs: 'Prod' })), 400);
});

test('hosted: a new project with several services and environments generates without touching a disk', () =>
  hosted(() => {
    const data = handleGenerate({
        name: 'shop',
      envs: ['dev', 'prod'],
      services: [{ name: 'api', dir: 'api', stack: 'django' }, { name: 'web', dir: 'web', stack: 'react' }],
    });
    assert.equal(data.dir, null);
    assert.ok(data.files.some((f) => f.path === 'api/Dockerfile.dev') && data.files.some((f) => f.path === 'docker-compose.prod.yml'));
    assert.ok(data.files.every((f) => f.existing === null));
    // Writing into a folder of the server is refused, whatever the service list says.
    assert.equal(code(() => handleGenerate({ dir: '/tmp', write: true, services: [{ dir: 'x', stack: 'node' }] })), 400);
  }));

test('deployTo, changedOnly, sharedPaths and dbPerService reach the generator', () => {
  const data = handleGenerate({
    ...fullstack(),
    deploy: 'ssh',
    deployTo: [{ name: 'qa', on: 'branch', match: 'develop' }, { name: 'production', on: 'tag', match: '' }],
    changedOnly: true,
    sharedPaths: 'libs/**, package.json',
    dbPerService: true,
    db: ['postgres'],
  });
  const ci = data.files.find((f) => f.path === '.github/workflows/ci.yml').content;
  assert.match(ci, /deploy-qa:/);
  assert.match(ci, /deploy-production:/);
  assert.match(ci, /changes:/);
  assert.match(ci, /libs\/\.\*\$/);
  assert.ok(data.files.some((f) => f.path === 'db/postgres/init.sql'));
  assert.equal(code(() => handleGenerate({ ...fullstack(), deploy: 'ssh', deployTo: ['qa'] })), 400);
  assert.equal(code(() => handleGenerate({ ...fullstack(), deploy: 'ssh', deployTo: [{ name: 'qa', on: 'nightly' }] })), 400);
  assert.equal(code(() => handleGenerate({ ...fullstack(), changedOnly: true, sharedPaths: 'a b c' })), 400);
});
