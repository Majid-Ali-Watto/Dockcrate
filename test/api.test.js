import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, apiRoute, getMeta, guard, handleGenerate } from '../src/api.js';

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
  assert.equal('cwd' in meta || 'home' in meta, false, 'no server path reaches the browser');
});

test('blank form fields are ignored', () => {
  const data = handleGenerate({ stack: 'node', ci: 'github', port: '', runtime: '', buildDir: '', db: [], healthcheck: '', packages: '', env: '' });
  assert.equal(data.stack, 'node');
  assert.ok(data.files.some((f) => f.path === 'Dockerfile'));
  assert.deepEqual(data.ci.available, ['lint', 'test', 'build', 'audit']);
});

test('a preview needs only the options', () => {
  const data = handleGenerate({ stack: 'fastapi', tool: 'uv', name: '', build: true, include: ['dockerfile', 'compose'] });
  assert.deepEqual(data.files.map((f) => f.path), ['Dockerfile', 'docker-compose.yml']);
  assert.match(data.files[0].content, /uv sync/);
  assert.equal(code(() => handleGenerate({ stack: 'node', include: [] })), 400);
});

test('user errors are 400s with a message', () => {
  assert.equal(code(() => handleGenerate({})), 400, 'a stack is needed');
  assert.equal(code(() => handleGenerate({ stack: 'node', db: ['mysql', 'mariadb'] })), 400);
  assert.equal(code(() => handleGenerate({ stack: 'cobol' })), 400);
  assert.throws(() => handleGenerate({ stack: 'node', env: ['NOPE'] }), (e) => e instanceof HttpError && /use NAME=value/.test(e.message));
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

// ---- hosted mode (Vercel)
const hosted = async (fn) => {
  process.env.DOCKCRATE_HOSTED = '1';
  try {
    return await fn();
  } finally {
    delete process.env.DOCKCRATE_HOSTED;
  }
};

test('hosted: meta says it is hosted', () => hosted(() => assert.equal(getMeta().hosted, true)));

test('hosted: any Host is accepted, a foreign Origin is still refused', () =>
  hosted(() => {
    guard(new Headers({ host: 'dockcrate.vercel.app' }));
    guard(new Headers({ host: 'dockcrate.vercel.app', origin: 'https://dockcrate.vercel.app' }));
    assert.equal(code(() => guard(new Headers({ host: 'dockcrate.vercel.app', origin: 'https://evil.example' }))), 403);
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

test('hosted: a new project with several services and environments generates', () =>
  hosted(() => {
    const data = handleGenerate({
        name: 'shop',
      envs: ['dev', 'prod'],
      services: [{ name: 'api', dir: 'api', stack: 'django' }, { name: 'web', dir: 'web', stack: 'react' }],
    });
    assert.ok(data.files.some((f) => f.path === 'api/Dockerfile.dev') && data.files.some((f) => f.path === 'docker-compose.prod.yml'));
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

test('each service can set its own runtime version and package manager', () => {
  const r = handleGenerate({
    include: ['dockerfile'],
    services: [
      { name: 'api', dir: 'api', stack: 'fastapi', runtime: '3.11', tool: 'poetry' },
      { name: 'web', dir: 'web', stack: 'node', runtime: '20', tool: 'pnpm' },
      { name: 'site', dir: 'site', stack: 'node', runtime: '', tool: '' },
    ],
  });
  const dockerfile = (path) => r.files.find((f) => f.path === path).content;
  assert.match(dockerfile('api/Dockerfile'), /FROM python:3\.11-slim[\s\S]*poetry/);
  assert.match(dockerfile('web/Dockerfile'), /FROM node:20-alpine[\s\S]*pnpm-lock\.yaml/);
  assert.match(dockerfile('site/Dockerfile'), /FROM node:24-alpine/);
});
