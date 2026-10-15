import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generate as run, parseDeploySpec, parseServiceSpec, stackIds } from '../src/generate.js';

// A project is described by its services: nothing is read from disk.
const svc = (name, stack, extra = {}) => ({ name, dir: name, stack, ...extra });
const generate = (spec, opts = {}) => run(null, { ...spec, ...opts });

/** A temporary folder with files, for the tests that need a real one (an existing compose file, a git repository). */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dockcrate-svc-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const file = (result, path) => result.files.find((f) => f.path === path)?.content;
const paths = (result) => result.files.map((f) => f.path);

// A project with a Vue front end and two Django services, shared compose file and shared CI.
const fullstack = () => ({ services: [svc('api', 'django'), svc('billing', 'django'), svc('web', 'vue')] });

test('several services: one Dockerfile per service folder', () => {
  const r = generate(fullstack());
  assert.equal(r.multi, true);
  assert.deepEqual(r.services.map((s) => [s.name, s.dir, s.stack]), [['api', 'api', 'django'], ['billing', 'billing', 'django'], ['web', 'web', 'vue']]);
  for (const dir of ['api', 'billing', 'web']) {
    assert.ok(file(r, `${dir}/Dockerfile`), `${dir}/Dockerfile`);
    assert.ok(file(r, `${dir}/.dockerignore`));
  }
  assert.ok(file(r, 'web/nginx.conf'), 'static site files live in the service folder');
  assert.equal(file(r, 'Dockerfile'), undefined, 'nothing is generated at the root');
  assert.match(file(r, 'web/Dockerfile'), /COPY nginx.conf/);
});

test('one compose file builds every service, shares databases and avoids host port clashes', () => {
  const r = generate(fullstack(), { db: ['postgres'] });
  const compose = file(r, 'docker-compose.yml');
  assert.match(compose, /^ {2}api:\n(?: {4}.*\n)*? {4}build: \.\/api/m);
  assert.match(compose, /build: \.\/billing/);
  assert.match(compose, /build: \.\/web/);
  assert.match(compose, /- "8000:8000"/);
  assert.match(compose, /- "8001:8000"/, 'the second Django service is published on the next free host port');
  assert.match(compose, /- "8080:8080"/);
  assert.equal(compose.match(/^ {2}postgres:/gm).length, 1, 'one shared database');
  assert.equal(compose.match(/DATABASE_URL/g).length, 2, 'only the backends get the URL, not the static site');
  assert.ok(r.notes.some((n) => n.includes('billing') && n.includes('8001')));
  assert.ok(r.notes.some((n) => n.includes('http://api:8000')));
});

test('GitHub: one test matrix over services that run the same steps, one job for the rest, one image matrix', () => {
  const r = generate(fullstack(), { ciSteps: ['test'], pinActions: false });
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /^ {2}test-django:/m);
  assert.match(ci, /service: \["api","billing"\]/);
  assert.match(ci, /include: \[\{"service":"api","dir":"api"\},\{"service":"billing","dir":"billing"\}\]/);
  assert.match(ci, /working-directory: \$\{\{ matrix.dir \}\}/);
  assert.match(ci, /cache-dependency-path: "\$\{\{ matrix.dir \}\}\/requirements.txt"/);
  assert.match(ci, /^ {2}test-web:/m);
  assert.match(ci, /cache-dependency-path: "web\/package-lock.json"/);
  assert.match(ci, /working-directory: web\n/);
  assert.match(ci, /needs: \[test-django, test-web\]/);
  assert.match(ci, /context: "\$\{\{ matrix.dir \}\}"/);
  assert.match(ci, /IMAGE_NAME: "ghcr.io\/\$\{\{ github.repository \}\}\/\$\{\{ matrix.service \}\}"/);
  assert.doesNotMatch(ci, /outputs:/, 'a matrix job has no single image output');
});

test('services whose steps differ do not share a test job', () => {
  const ci = file(generate({ services: [svc('api', 'django'), svc('billing', 'django', { tool: 'uv' })] }, { ciSteps: ['test'] }), '.github/workflows/ci.yml');
  assert.match(ci, /^ {2}test-api:/m);
  assert.match(ci, /^ {2}test-billing:/m);
  assert.doesNotMatch(ci, /test-django/);
});

test('the deploy job works out every image name and passes one compose image variable per service', () => {
  const ci = file(generate(fullstack(), { deploy: 'ssh', pinActions: false }), '.github/workflows/ci.yml');
  assert.match(ci, /IMAGE_NAME_API: "ghcr.io\/\$\{\{ github.repository \}\}\/api"/);
  assert.match(ci, /echo "IMAGE_BILLING=\$name:sha-\$GITHUB_SHA" >> "\$GITHUB_ENV"/);
  assert.match(ci, /API_IMAGE=\$IMAGE_API BILLING_IMAGE=\$IMAGE_BILLING WEB_IMAGE=\$IMAGE_WEB docker compose pull/);
  assert.match(file(generate(fullstack(), { deploy: 'ssh' }), 'docker-compose.yml'), /image: "\$\{API_IMAGE:-.*-api:local\}"/);
});

test('five microservices share one pipeline and one deployment', () => {
  const names = ['auth', 'orders', 'catalog', 'payments', 'gateway'];
  const r = generate({ services: names.map((n) => svc(n, 'node', { dir: `services/${n}` })) }, { deploy: 'kubernetes', name: 'shop' });
  assert.deepEqual(r.services.map((s) => s.name), names);
  assert.equal(r.files.filter((f) => f.path.endsWith('/Dockerfile')).length, 5);
  assert.equal(r.files.filter((f) => f.kind === 'ci').length, 1);
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /^ {2}test-node:/m, 'identical Node services share a matrix job');
  assert.match(ci, /^ {2}image:/m);
  assert.equal(ci.match(/^ {2}deploy:/gm).length, 1, 'one deployment');
  for (const n of names) {
    assert.match(file(r, `k8s/${n}/deployment.yaml`), new RegExp(`name: shop-${n}$`, 'm'));
    assert.ok(file(r, `k8s/${n}/service.yaml`));
    assert.match(ci, new RegExp(`kubectl rollout status -n "\\$NS" deployment/.*-${n} `));
  }
  assert.match(file(r, 'docker-compose.yml'), /services\/auth/);
});

test('every script based provider gets a job per service and one deploy', () => {
  const dir = fullstack();
  const jobs = {
    gitlab: ['test-api:', 'test-web:', 'build-image-api:', 'build-image-web:', 'IMAGE_REPO: "$CI_REGISTRY_IMAGE/api"'],
    jenkins: ["stage('Test api')", "stage('Image web')", 'cd api && '],
    bitbucket: ['&test-api', '&image-step-billing', '(cd web && npm ci)'],
    azure: ['job: test_billing', 'job: image_web', 'dependsOn: [image_api, image_billing, image_web]'],
    circleci: ['test-web:', 'image-api:', 'requires: ["image-api","image-billing","image-web"]'],
  };
  for (const [ci, needles] of Object.entries(jobs)) {
    const r = generate(dir, { ci, deploy: 'ssh', ciSteps: ['test'] });
    const text = r.files.find((f) => f.kind === 'ci').content;
    for (const needle of needles) assert.ok(text.includes(needle), `${ci}: ${needle}\n${text}`);
    assert.match(text, /API_IMAGE=\$IMAGE_API/, `${ci} deploys every image`);
  }
});

test('script providers build each service from its own folder and image repository', () => {
  const text = file(generate(fullstack(), { ci: 'gitlab', registry: 'dockerhub' }), '.gitlab-ci.yml');
  assert.match(text, /IMAGE_REPO: "\$DOCKERHUB_USERNAME\/fullstack-api"|IMAGE_REPO: "\$DOCKERHUB_USERNAME\/[\w-]+-api"/);
  assert.match(text, /docker build -t "\$IMAGE_REPO:\$CI_COMMIT_SHA".* api$/m);
  assert.match(text, /docker build .* web$/m);
});

test('deploy targets know about every service', () => {
  const dir = fullstack();
  const cloudrun = generate(dir, { deploy: 'cloudrun' }).files.find((f) => f.kind === 'ci').content;
  assert.match(cloudrun, /gcloud run deploy "\$CLOUD_RUN_SERVICE-api" --image "\$IMAGE_API"/);
  assert.match(cloudrun, /--port 8080/);

  const ecs = generate(dir, { deploy: 'ecs' });
  assert.ok(file(ecs, 'ecs/api/task-definition.json') && file(ecs, 'ecs/web/task-definition.json'));
  assert.match(file(ecs, '.github/workflows/ci.yml'), /--service "\$ECS_SERVICE-billing"/);

  const azure = generate(dir, { deploy: 'azure' }).files.find((f) => f.kind === 'ci').content;
  assert.match(azure, /--name "\$AZURE_WEBAPP_NAME-web"/);

  const fly = generate(dir, { deploy: 'fly' });
  assert.match(file(fly, 'api/fly.toml'), /app = "[\w-]+-api"/);
  assert.match(file(fly, '.github/workflows/ci.yml'), /\(cd billing && flyctl deploy --remote-only\)/);
  assert.ok(fly.notes.some((n) => n.startsWith('Fly.io: each service')));
});

test('a single service in a subfolder keeps the classic names but builds from its folder', () => {
  const r = generate({ services: [svc('backend', 'django')] }, { deploy: 'ssh', pinActions: false });
  assert.equal(r.multi, true);
  assert.ok(file(r, 'backend/Dockerfile'));
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /^ {2}test:/m);
  assert.match(ci, /context: "backend"/);
  assert.match(ci, /IMAGE: "\$\{\{ needs.image.outputs.image \}\}"/);
  assert.match(file(r, 'docker-compose.yml'), /^ {2}backend:/m);
});

test('services have their own port, databases and options', () => {
  const r = generate(null, {
    db: ['redis'],
    services: [
      svc('api', 'django', { port: 9000, db: ['postgres'], healthcheck: '/health' }),
      svc('ledger', 'django', { dir: 'billing', db: ['mysql'], packages: ['curl'] }),
      parseServiceSpec('web=web:vue@3000'),
    ],
  });
  assert.deepEqual(r.services.map((s) => [s.name, s.port, s.db]), [['api', 9000, ['postgres']], ['ledger', 8000, ['mysql']], ['web', 3000, []]]);
  const compose = file(r, 'docker-compose.yml');
  assert.match(compose, /^ {2}ledger:/m);
  assert.match(compose, /postgres:\/\/app/);
  assert.match(compose, /mysql:\/\/app/, 'each service has its own database, even two SQL kinds');
  assert.doesNotMatch(compose, /redis/, 'a service-level list replaces the global one');
  assert.match(file(r, 'api/Dockerfile'), /HEALTHCHECK.*9000\/health/);
  assert.match(file(r, 'billing/Dockerfile'), /FROM python:[\d.]+-slim AS runtime[\s\S]*apt-get install -y --no-install-recommends curl/);
  assert.doesNotMatch(file(r, 'api/Dockerfile'), /curl/);
});

test('service specs: name=dir:stack@port', () => {
  assert.deepEqual(parseServiceSpec('api=./api:django@8000'), { name: 'api', dir: './api', stack: 'django', port: 8000 });
  assert.deepEqual(parseServiceSpec('web:vue'), { dir: 'web', stack: 'vue' });
  assert.deepEqual(parseServiceSpec('svc/users:go'), { dir: 'svc/users', stack: 'go' });
  assert.throws(() => parseServiceSpec('web'), /invalid service/);
  assert.throws(() => parseServiceSpec('API=a:go'), /invalid service/);
});

test('invalid services and options that only fit one service are rejected', () => {
  const full = fullstack();
  assert.throws(() => generate(null, { services: [svc('a', 'django', { dir: 'x' }), svc('b', 'django', { dir: 'x' })] }), /both point at x/);
  assert.throws(() => generate(null, { services: [svc('a', 'django'), svc('a', 'vue', { dir: 'other' })] }), /two services are called "a"/);
  assert.throws(() => generate(null, { services: [svc('a', 'django', { dir: '../x' })] }), /invalid service folder/);
  assert.throws(() => generate(null, { services: [svc('Bad Name', 'django', { dir: 'ok' })] }), /invalid service name/);
  assert.throws(() => generate(null, { services: [{ name: 'a', dir: 'a', stack: 'django', color: 'red' }] }), /unknown option "color"/);
  assert.throws(() => generate(null, { services: [svc('a', 'django', { runtime: '3.12; rm' })] }), /invalid runtime/);
  assert.throws(() => generate(null, { services: [{ name: 'a', dir: 'a' }] }), /service a: choose a stack/);
  assert.throws(() => generate(null, { services: [svc('a', 'cobol')] }), /unknown stack/);
  assert.throws(() => generate(full, { stack: 'django' }), /single project/);
  assert.throws(() => generate(full, { port: 9000 }), /--port applies to one service/);
  assert.throws(() => generate(full, { testVersions: ['3.12'] }), /per service/);
  assert.throws(() => generate(null, { services: [svc('a', 'django', { ciSteps: ['build'] })] }), /build CI step is not available for django/);
  assert.throws(() => generate(null, { services: Array.from({ length: 33 }, (_, i) => svc(`s${i}`, 'node')) }), /at most 32/);
});

test('a CI step list for the whole project is trimmed per service and says so', () => {
  const r = generate(fullstack(), { ciSteps: ['lint', 'build'] });
  assert.ok(r.notes.some((n) => n.startsWith('api:') && n.includes('build CI step is not available for django')));
  assert.deepEqual(r.services.find((s) => s.name === 'web').ci.selected, ['lint', 'build']);
  assert.deepEqual(r.services.find((s) => s.name === 'api').ci.selected, ['lint']);
});

test('test versions per service: one matrix each; the same stack may share a global list', () => {
  const dir = fullstack();
  const r = generate(dir, {
    services: [
      svc('api', 'django', { testVersions: ['3.12', '3.13'] }),
      svc('billing', 'django', { testVersions: ['3.12', '3.13'] }),
      svc('web', 'vue', { testVersions: ['20', '22'] }),
    ],
    ciSteps: ['test'],
  });
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /version: \["3.12","3.13"\]/);
  assert.match(ci, /version: \["20","22"\]/);
  const same = generate({ services: [svc('a', 'django'), svc('b', 'django')] }, { testVersions: ['3.12'], ciSteps: ['test'] });
  assert.match(file(same, '.github/workflows/ci.yml'), /version: \["3.12"\]/);
  const gitlab = file(generate(dir, { ci: 'gitlab', services: [svc('api', 'django', { testVersions: ['3.12', '3.13'] }), svc('web', 'vue')], ciSteps: ['test'] }), '.gitlab-ci.yml');
  assert.match(gitlab, /test-api:[\s\S]*VERSION: \["3.12","3.13"\][\s\S]*test-web:/);
});

test('new multi-service project: each service starts from its stack, no folder is read', () => {
  const r = generate(null, {

    name: 'shop',
    services: [
      { name: 'api', stack: 'django', project: 'shop' },
      { name: 'web', stack: 'react' },
      { name: 'worker', dir: 'workers/queue', stack: 'go' },
    ],
  });
  assert.deepEqual(paths(r).filter((p) => p.endsWith('Dockerfile')), ['api/Dockerfile', 'web/Dockerfile', 'workers/queue/Dockerfile']);
  assert.match(file(r, 'api/Dockerfile'), /shop\.wsgi:application/);
  assert.ok(r.notes.some((n) => n.startsWith('api: These files assume')));
  assert.throws(() => generate(null, { services: [{ name: 'x' }] }), /choose a stack/);
});

test('environments: a compose override per environment, layered over the base file', () => {
  const r = generate(fullstack(), { db: ['postgres'], envs: ['dev', 'qa', 'prod'] });
  assert.ok(file(r, 'docker-compose.dev.yml') && file(r, 'docker-compose.qa.yml') && file(r, 'docker-compose.prod.yml'));
  const prod = file(r, 'docker-compose.prod.yml');
  assert.match(prod, /restart: always/);
  assert.match(prod, /path: \.env\.prod\n {8}required: false/);
  assert.match(prod, /max-size: "10m"/);
  assert.doesNotMatch(prod, /ports:|volumes:/);
  assert.match(file(r, 'docker-compose.qa.yml'), /\.env\.qa/);
  assert.ok(r.notes.some((n) => n.includes('docker compose -f docker-compose.yml -f docker-compose.prod.yml up')));
});

test('dev environment: Dockerfile.dev per service, source mounted, databases published', () => {
  const r = generate(fullstack(), { db: ['postgres'], envs: ['dev', 'prod'] });
  for (const dir of ['api', 'billing', 'web']) assert.ok(file(r, `${dir}/Dockerfile.dev`), `${dir}/Dockerfile.dev`);
  assert.equal(file(r, 'Dockerfile.prod'), undefined, 'only dev gets its own Dockerfile; other environments use the main one');
  const dev = file(r, 'docker-compose.dev.yml');
  assert.match(dev, /dockerfile: Dockerfile.dev/);
  assert.match(dev, /- \.\/api:\/app/);
  assert.match(dev, /- \/app\/node_modules/);
  assert.match(dev, /postgres:\n {4}ports:\n {6}- "5432:5432"/);
  assert.match(file(r, 'api/Dockerfile.dev'), /"runserver","0\.0\.0\.0:8000"/);
  assert.match(file(r, 'web/Dockerfile.dev'), /"npm","run","dev","--","--host","0\.0\.0\.0","--port","8080"/);
  assert.match(file(r, 'api/.dockerignore'), /^Dockerfile\.\*$/m);
});

test('environments work for a single project too, and the file stays editable block by block', () => {
  const r = generate(null, { stack: 'node', envs: ['dev', 'staging'] });
  assert.match(file(r, 'Dockerfile.dev'), /CMD \["npm","start"\]/);
  assert.match(file(r, 'docker-compose.dev.yml'), /^ {2}app:\n {4}build:\n {6}dockerfile: Dockerfile.dev/m);
  assert.ok(file(r, 'docker-compose.staging.yml'));
  const devfile = r.files.find((f) => f.path === 'Dockerfile.dev');
  assert.ok(devfile.blocks.some((b) => b.id.startsWith('block-') || b.id.startsWith('stage:')), 'split into blocks like any Dockerfile');
  const edited = generate(null, { stack: 'node', envs: ['dev'], edits: { 'Dockerfile.dev': { blocks: { 'stage:1': { text: 'FROM node:20' } } } } });
  assert.match(file(edited, 'Dockerfile.dev'), /^FROM node:20/m);
});

test('existing compose file names are kept for the overrides', () => {
  const dir = project({ 'compose.yaml': 'services: {}\n' });
  const r = run(dir, { stack: 'node', envs: ['prod'] });
  assert.ok(file(r, 'compose.prod.yaml'));
  assert.match(r.notes.join('\n'), /-f compose.yaml -f compose.prod.yaml/);
});

test('the ssh deploy layers the compose override of the pipeline environment', () => {
  const r = generate(fullstack(), { deploy: 'ssh', envs: ['dev', 'prod'], pinActions: false });
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /scp docker-compose\.prod\.yml/);
  assert.match(ci, /docker compose -f docker-compose\.yml -f docker-compose\.prod\.yml pull/);
  const staging = generate(fullstack(), { deploy: 'ssh', envs: ['staging'], environment: 'staging' });
  assert.match(file(staging, '.github/workflows/ci.yml'), /docker-compose\.staging\.yml/);
  const none = generate(fullstack(), { deploy: 'ssh', envs: ['qa'] });
  assert.doesNotMatch(file(none, '.github/workflows/ci.yml'), /docker-compose\.qa\.yml/, 'only the environment the pipeline deploys is used');
  assert.throws(() => generate(fullstack(), { envs: ['Prod'] }), /invalid environment/);
  assert.throws(() => generate(fullstack(), { envs: ['dev', 'dev'] }), /listed twice/);
});

test('every stack has a development Dockerfile that binds the stack port', () => {
  for (const id of stackIds()) {
    const r = generate(null, { stack: id, envs: ['dev'] });
    const dev = file(r, 'Dockerfile.dev');
    assert.ok(dev && /^FROM /m.test(dev), `${id} has a Dockerfile.dev`);
    assert.match(dev, /EXPOSE \d+/);
    assert.ok(file(r, 'docker-compose.dev.yml'), id);
  }
  const watched = file(generate(null, { stack: 'go', envs: ['dev'] }), 'docker-compose.dev.yml');
  assert.match(watched, /action: sync\+restart/);
  assert.doesNotMatch(watched, /volumes:/);
});

test('CodeQL covers every language of a multi-stack project', () => {
  const r = generate(fullstack(), { codeScan: true });
  const codeql = file(r, '.github/workflows/codeql.yml');
  assert.match(codeql, /\{"language":"python","build-mode":"none"\},\{"language":"javascript-typescript","build-mode":"none"\}/);
  assert.match(codeql, /languages: "\$\{\{ matrix.language \}\}"/);
  const dotnetOnly = generate({ services: [svc('a', 'django')] }, { codeScan: true });
  assert.match(file(dotnetOnly, '.github/workflows/codeql.yml'), /languages: "python"/);
});

test('hadolint lints every Dockerfile; dependabot and the Makefile know every service', () => {
  const r = generate(fullstack(), { lintDockerfile: true, extras: ['dependabot', 'makefile'], envs: ['dev'], pinActions: false });
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /"dockerfile":"api\/Dockerfile"/);
  assert.match(ci, /dockerfile: "\$\{\{ matrix.dockerfile \}\}"/);
  const bot = file(r, '.github/dependabot.yml');
  assert.match(bot, /package-ecosystem: pip\n {4}directory: "\/api"/);
  assert.match(bot, /package-ecosystem: npm\n {4}directory: "\/web"/);
  assert.match(bot, /package-ecosystem: github-actions\n {4}directory: "\/"/);
  const make = file(r, 'Makefile');
  assert.match(make, /docker build -t \$\(IMAGE\)-api api/);
  assert.match(make, /up-dev:\n\tdocker compose -f docker-compose.yml -f docker-compose.dev.yml up --build\n/);
  assert.ok(generate(fullstack(), { extras: ['devcontainer'] }).notes.some((n) => n.includes('dev container targets one stack')));
});

test('include still filters file groups across services', () => {
  const r = generate(fullstack(), { include: ['dockerfile'], envs: ['dev'] });
  assert.ok(r.files.every((f) => f.kind === 'dockerfile'));
  assert.ok(paths(r).includes('api/Dockerfile.dev'));
  assert.ok(!paths(r).includes('docker-compose.yml'));
});

// ---------------------------------------------------------------------------------- several deploy environments

const envs = [
  { name: 'qa', on: 'branch', match: 'develop' },
  { name: 'staging', on: 'branch' },
  { name: 'production', on: 'tag', match: 'v*' },
  { name: 'hotfix', on: 'manual' },
  { name: 'canary', on: 'manual' },
];

test('deployTo: one job per environment, each in its own CI environment with its own rule', () => {
  const r = generate(fullstack(), { deploy: 'ssh', deployTo: envs, branches: ['main', 'develop'], manual: true, pinActions: false });
  const ci = file(r, '.github/workflows/ci.yml');
  const job = (id) => ci.match(new RegExp(`^ {2}${id}:\\n[\\s\\S]*?(?=^ {2}\\S|$(?![\\s\\S]))`, 'm'))[0];
  assert.match(job('deploy-qa'), /if: "github.ref == 'refs\/heads\/develop'"/);
  assert.match(job('deploy-qa'), /environment: qa\n/);
  assert.match(job('deploy-qa'), /group: deploy-qa/);
  assert.match(job('deploy-staging'), /github.event.repository.default_branch/);
  assert.match(job('deploy-production'), /if: "startsWith\(github.ref, 'refs\/tags\/v'\)"/);
  assert.match(job('deploy-hotfix'), /github.event_name == 'workflow_dispatch' && inputs.environment == 'hotfix'/);
  assert.match(ci, /workflow_dispatch:\n {4}inputs:\n {6}environment:[\s\S]*options: \["hotfix","canary"\]/);
  assert.ok(r.notes.some((n) => n.startsWith('Deployments (qa, staging, production, hotfix, canary) run the same script')));
  assert.equal(ci.match(/^ {2}deploy-/gm).length, 5);
});

test('each deployment layers the compose override of its own environment', () => {
  const r = generate(fullstack(), { deploy: 'ssh', envs: ['qa', 'prod'], deployTo: envs.slice(0, 3), branches: ['main', 'develop'] });
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /deploy-qa:[\s\S]*docker compose -f docker-compose\.yml -f docker-compose\.qa\.yml pull[\s\S]*deploy-staging:/);
  assert.match(ci, /deploy-production:[\s\S]*docker-compose\.prod\.yml pull/);
  const staging = ci.match(/deploy-staging:[\s\S]*?(?=deploy-production:)/)[0];
  assert.doesNotMatch(staging, /-f docker-compose\.(qa|prod)/, 'staging has no override of its own');
  assert.ok(r.notes.some((n) => n.includes('ssh deploy to qa uses docker-compose.qa.yml')));
});

test('deployTo on every script provider', () => {
  const dir = fullstack();
  const base = { deploy: 'ssh', deployTo: envs.slice(0, 4), branches: ['main', 'develop'], manual: true };
  const gitlab = file(generate(dir, { ...base, ci: 'gitlab' }), '.gitlab-ci.yml');
  assert.match(gitlab, /^deploy-qa:[\s\S]*environment: qa\n {2}resource_group: qa[\s\S]*- if: \$CI_COMMIT_BRANCH == "develop"/m);
  assert.match(gitlab, /^deploy-production:[\s\S]*- if: \$CI_COMMIT_TAG =~ \/\^v\.\*\/|- if: \$CI_COMMIT_TAG =~ \/\^v\.\*\$\//m);
  assert.match(gitlab, /^deploy-hotfix:[\s\S]*when: manual/m);
  const jenkins = file(generate(dir, { ...base, ci: 'jenkins' }), 'Jenkinsfile');
  assert.match(jenkins, /stage\('Deploy qa'\)[\s\S]*when \{ beforeAgent true; branch 'develop' \}/);
  assert.match(jenkins, /stage\('Deploy production'\)[\s\S]*tag pattern: 'v\*', comparator: 'GLOB'/);
  assert.match(jenkins, /stage\('Deploy hotfix'\)[\s\S]*input \{ message 'Deploy to hotfix\?' \}/);
  const bitbucket = file(generate(dir, { ...base, ci: 'bitbucket' }), 'bitbucket-pipelines.yml');
  assert.match(bitbucket, /"develop":\n[\s\S]*?step: \*deploy-step-qa/, 'a branch pipeline for the environment branch exists even when it is not a push trigger');
  assert.doesNotMatch(bitbucket.match(/"main":\n[\s\S]*?(?="develop":)/)[0], /deploy-step-qa/, 'and the qa deploy is only in it');
  assert.match(bitbucket, /tags:\n {4}"v\*":[\s\S]*step: \*deploy-step-production/);
  assert.match(bitbucket, /deployment: hotfix\n {8}trigger: manual/);
  const azure = file(generate(dir, { ...base, ci: 'azure' }), 'azure-pipelines.yml');
  assert.match(azure, /deployment: deploy_qa[\s\S]*eq\(variables\['Build.SourceBranch'\], 'refs\/heads\/develop'\)/);
  assert.match(azure, /deployment: deploy_production[\s\S]*startsWith\(variables\['Build.SourceBranch'\], 'refs\/tags\/v'\)/);
  const circle = file(generate(dir, { ...base, ci: 'circleci' }), '.circleci/config.yml');
  assert.match(circle, /- deploy-qa:\n {10}requires:[\s\S]*only: \["\/\^develop\$\/"\]/);
  assert.match(circle, /- hold-deploy-hotfix:\n {10}type: approval/);
  assert.match(circle, /- deploy-production:[\s\S]*tags:\n {14}only: \["\/\^v\.\*\/"\]/);
});

test('deployTo is validated, and replaces the single deploy rule', () => {
  const dir = fullstack();
  const base = { deploy: 'ssh' };
  assert.throws(() => generate(dir, { ...base, deployTo: [{ name: 'qa', on: 'branch' }], deployOn: 'tag' }), /--deploy-to lists the environments itself/);
  assert.throws(() => generate(dir, { ...base, deployTo: [{ name: 'qa', on: 'branch' }], environment: 'x' }), /--deploy-to lists the environments itself/);
  assert.throws(() => generate(dir, { ...base, deployTo: [{ name: 'qa', on: 'nightly' }] }), /invalid deploy-on/);
  assert.throws(() => generate(dir, { ...base, deployTo: [{ name: 'bad name', on: 'branch' }] }), /invalid environment/);
  assert.throws(() => generate(dir, { ...base, deployTo: [{ name: 'qa', on: 'manual', match: 'x' }] }), /no branch or tag to match/);
  assert.throws(() => generate(dir, { ...base, deployTo: [{ name: 'qa', on: 'branch', match: 'a*b' }] }), /must be a name or a prefix ending in \*/);
  assert.throws(() => generate(dir, { ...base, deployTo: [{ name: 'qa', on: 'branch' }, { name: 'qa', on: 'tag' }] }), /listed twice/);
  assert.deepEqual(parseDeploySpec('qa=branch:develop'), { name: 'qa', on: 'branch', match: 'develop' });
  assert.deepEqual(parseDeploySpec('production=tag'), { name: 'production', on: 'tag' });
  assert.throws(() => parseDeploySpec('qa'), /invalid deployment/);
});

test('an environment that can never run is reported', () => {
  const r = generate(fullstack(), { deploy: 'ssh', deployTo: [{ name: 'qa', on: 'branch', match: 'develop' }, { name: 'prod', on: 'tag', match: 'release-*' }] });
  assert.ok(r.notes.some((n) => n.startsWith('qa: Deploying from develop, which is not one of the pushed branches')));
  assert.ok(r.notes.some((n) => n.startsWith('prod: Deploying tags release-*, which the tag triggers (v*) do not cover')));
  const ok = generate(fullstack(), { deploy: 'ssh', branches: ['main', 'release/*'], deployTo: [{ name: 'r', on: 'branch', match: 'release/*' }] });
  assert.ok(!ok.notes.some((n) => n.includes('not one of the pushed branches')));
});

test('a single environment is the classic deploy job, byte for byte', () => {
  const dir = fullstack();
  assert.equal(
    file(generate(dir, { deploy: 'ssh', environment: 'staging', deployOn: 'tag' }), '.github/workflows/ci.yml'),
    file(generate(dir, { deploy: 'ssh', deployTo: [{ name: 'staging', on: 'tag' }] }), '.github/workflows/ci.yml'),
  );
});

// --------------------------------------------------------------------------------------- only what changed

const changed = { changedOnly: true, sharedPaths: ['libs/**', 'package.json'], deploy: 'ssh', lintDockerfile: true, ciSteps: ['test'], pinActions: false };

test('GitHub: a changes job feeds dynamic matrices; unchanged services are skipped', () => {
  const r = generate(fullstack(), changed);
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /^ {2}changes:\n {4}runs-on: ubuntu-latest\n {4}outputs:\n {6}any:[\s\S]*test-django:[\s\S]*lint:[\s\S]*images:/m);
  assert.match(ci, /fetch-depth: "0"/);
  assert.match(ci, /if hit api; then list0=.*'"api"'; fi/);
  assert.match(ci, /\^\\\.github\/workflows\/ci\\\.yml\$\|\^libs\/\.\*\$\|\^package\\\.json\$/, 'the workflow file and the shared paths rebuild everything');
  assert.match(ci, /test-django:\n {4}needs: changes\n {4}if: "needs\.changes\.outputs\.test-django != '\[\]'"/);
  assert.match(ci, /dir: \$\{\{ fromJSON\(needs\.changes\.outputs\.test-django\) \}\}/);
  assert.match(ci, /test-web:\n {4}needs: changes\n {4}if: "contains\(needs\.changes\.outputs\.changed, ',all,'\) \|\| contains\(needs\.changes\.outputs\.changed, ',web,'\)"/);
  assert.match(ci, /include: \$\{\{ fromJSON\(needs\.changes\.outputs\.lint\) \}\}/);
  assert.match(ci, /needs: \[changes, test-django, test-web, lint-dockerfile\]\n {4}if: "!cancelled\(\) && !failure\(\) && needs\.changes\.outputs\.images != '\[\]'"/);
  assert.match(ci, /include: \$\{\{ fromJSON\(needs\.changes\.outputs\.images\) \}\}/);
  assert.match(ci, /deploy:\n {4}needs: \[changes, image\]\n {4}if: "\(github.ref == .*\) && !cancelled\(\) && !failure\(\) && needs\.changes\.outputs\.any == 'true'"/);
  assert.match(ci, /DEPLOY_SERVICES: "\$\{\{ needs\.changes\.outputs\.changed \}\}"/);
  assert.match(ci, /docker compose pull \$SERVICES/);
  assert.ok(r.notes.some((n) => n.includes('Only the services whose folder changed')));
  const plain = file(generate(fullstack(), { ...changed, changedOnly: false }), '.github/workflows/ci.yml');
  assert.doesNotMatch(plain, /changes/, 'off by default: the pipeline is unchanged');
});

test('build args reach each service of the image matrix through the matrix, not through the script text', () => {
  const r = generate(null, { services: [svc('api', 'node', { buildArgs: 'SENTRY=1' }), svc('worker', 'node'), svc('web', 'vue', { buildArgs: ['VITE_API=x'] })], pinActions: false });
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /\{"service":"api","dir":"api","args":"SENTRY"\},\{"service":"worker","dir":"worker","args":""\},\{"service":"web","dir":"web","args":"VITE_API"\}/);
  assert.match(ci, /for n in \$ARG_NAMES; do printf '%s=%s\\n' "\$n" "\$\{!n\}"; done/);
  assert.match(ci, /ARG_NAMES: "\$\{\{ matrix.args \}\}"\n {10}SENTRY: "\$\{\{ vars.SENTRY \}\}"\n {10}VITE_API: "\$\{\{ vars.VITE_API \}\}"/);
  assert.match(ci, /build-args: "\$\{\{ steps.args.outputs.value \}\}"/);
  assert.doesNotMatch(ci, /build_args/);
});

test('the other providers guard each service and deploy only what changed', () => {
  const dir = fullstack();
  const guard = (id) => `case "$CHANGED" in *,all,*|*,${id},*) ;; *) echo "${id} is unchanged: nothing to do"; exit 0;; esac`;
  const gitlab = file(generate(dir, { ...changed, ci: 'gitlab' }), '.gitlab-ci.yml');
  assert.match(gitlab, /^changes:\n {2}stage: \.pre\n {2}image: alpine:3\n {2}variables:\n {4}GIT_DEPTH: "0"/m);
  assert.match(gitlab, /dotenv: changed\.env/);
  assert.ok(gitlab.includes(`- ${JSON.stringify(guard('api'))}`.replace(/\\\\/g, '\\')) || gitlab.includes(guard('api').replace(/"/g, '\\"')), 'test job guard');
  assert.match(gitlab, /build-image-api:[\s\S]*before_script:\n {4}- "case[\s\S]*docker login|before_script:\n {4}- "case/);
  assert.match(gitlab, /^deploy:[\s\S]*needs: \[changes, build-image-api/m);
  assert.match(gitlab, /DEPLOY_SERVICES: "\$CHANGED"/);

  const jenkins = file(generate(dir, { ...changed, ci: 'jenkins' }), 'Jenkinsfile');
  assert.match(jenkins, /stage\('Changes'\)[\s\S]*env\.CHANGED = sh\(returnStdout: true/);
  assert.match(jenkins, /stage\('Test api'\) \{\n {6}when \{ beforeAgent true; expression \{ env\.CHANGED\.contains\(',all,'\) \|\| env\.CHANGED\.contains\(',api,'\) \} \}/);
  assert.match(jenkins, /stage\('Image web'\)[\s\S]*allOf \{ not \{ changeRequest\(\) \}; expression/);
  assert.match(jenkins, /stage\('Deploy'\)[\s\S]*expression \{ env\.CHANGED != ',' \}/);
  assert.match(jenkins, /DEPLOY_SERVICES=\$CHANGED/);

  const bitbucket = file(generate(dir, { ...changed, ci: 'bitbucket', manual: true }), 'bitbucket-pipelines.yml');
  assert.match(bitbucket, /- step: &changes\n {8}name: Detect changed services\n {8}clone:\n {10}depth: full/);
  assert.match(bitbucket, /artifacts:\n {10}- changed\.env/);
  assert.match(bitbucket, /\. \.\/changed\.env\n {12}case "\$CHANGED" in \*,all,\*\|\*,api,\*\)/);
  assert.match(bitbucket, /manual:\n(?: {6}- variables:\n(?: {12}.*\n)+)? {6}- step: \*changes-all/, 'a manual pipeline does everything');
  assert.match(bitbucket, /pull-requests:\n {4}'\*\*':\n {6}- step: \*changes/);

  const azure = file(generate(dir, { ...changed, ci: 'azure' }), 'azure-pipelines.yml');
  assert.match(azure, /- job: changes[\s\S]*fetchDepth: 0[\s\S]*##vso\[task.setvariable variable=changed;isOutput=true\]\$CHANGED[\s\S]*name: detect/);
  assert.match(azure, /- job: test_web\n {4}displayName: Test web\n {4}dependsOn: changes\n {4}condition: and\(succeeded\(\), or\(contains\(dependencies\.changes\.outputs\['detect\.changed'\], ',all,'\)/);
  assert.match(azure, /condition: and\(not\(or\(failed\(\), canceled\(\)\)\), ne\(variables\['Build.Reason'\], 'PullRequest'\), or\(contains/);
  assert.match(azure, /changed: \$\[ dependencies\.changes\.outputs\['detect\.changed'\] \]/);
  assert.match(azure, /DEPLOY_SERVICES=\$\(changed\)/);

  const circle = file(generate(dir, { ...changed, ci: 'circleci', schedule: ['0 3 * * *'] }), '.circleci/config.yml');
  assert.match(circle, /^ {2}changes:\n {4}parameters:\n {6}all:\n {8}type: boolean/m);
  assert.match(circle, /persist_to_workspace:\n {10}root: \/tmp\/ws/);
  assert.match(circle, /attach_workspace:\n {10}at: \/tmp\/ws/);
  assert.match(circle, /circleci-agent step halt/);
  assert.match(circle, /- test-api:\n {10}requires: \["changes"\]/);
  assert.match(circle, /scheduled:[\s\S]*- changes:\n {10}all: true/, 'a scheduled run does everything');
});

test('deploy targets only touch the services that changed', () => {
  const dir = fullstack();
  const head = 'if [ "${DEPLOY_SERVICES:-,all,}" = "," ]; then echo "No service changed: nothing to deploy"; exit 0; fi';
  for (const deploy of ['kubernetes', 'ecs', 'azure', 'cloudrun', 'fly']) {
    const ci = generate(dir, { ...changed, deploy }).files.find((f) => f.kind === 'ci' && f.path.endsWith('ci.yml')).content;
    assert.ok(ci.includes(head), `${deploy} stops when nothing changed`);
    assert.match(ci, /deploy_it\(\) \{ case "\$\{DEPLOY_SERVICES:-,all,\}" in \*,all,\*\|\*,"\$1",\*\) return 0;; \*\) return 1;; esac; \}/);
    assert.match(ci, /if deploy_it api; then/);
    assert.match(ci, /if deploy_it web; then/);
  }
  const ssh = file(generate(dir, changed), '.github/workflows/ci.yml');
  assert.match(ssh, /SERVICES=""\n {10}case "\$\{DEPLOY_SERVICES:-,all,\}" in \*,all,\*\) ;; \*\) SERVICES=\$\(printf '%s' "\$DEPLOY_SERVICES" \| tr ',' ' '\) ;; esac/);
  const plain = file(generate(dir, { deploy: 'kubernetes', pinActions: false }), '.github/workflows/ci.yml');
  assert.doesNotMatch(plain, /deploy_it|DEPLOY_SERVICES/);
});

test('changed-only is ignored for one service, and shared paths are validated', () => {
  const r = generate({ services: [svc('backend', 'django')] }, { changedOnly: true });
  assert.ok(r.notes.some((n) => n.includes('ignored: there is a single service')));
  assert.doesNotMatch(file(r, '.github/workflows/ci.yml'), /changes/);
  assert.throws(() => generate(fullstack(), { changedOnly: true, sharedPaths: ['a b'] }), /invalid shared path/);
});

test('the change detection shell tells the services apart in a real repository', async () => {
  const { spawnSync } = await import('node:child_process');
  const { changedLines } = await import('../src/providers/common.js');
  const apps = [{ id: 'api', dir: 'api' }, { id: 'web', dir: 'web' }, { id: 'app', dir: '.' }];
  const repo = project({ 'api/a.py': '1', 'web/w.js': '1', 'libs/l.py': '1', 'README.md': '1', '.github/workflows/ci.yml': '1' });
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  assert.equal(git('init', '-q').status, 0);
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  const touch = (path) => {
    writeFileSync(join(repo, path), String(Math.random()));
    git('add', '.');
    git('commit', '-q', '-m', path);
  };
  const run = (setup, p = { apps, sharedPaths: ['libs/**'] }) =>
    spawnSync('sh', ['-c', [...changedLines(p, { ciPath: '.github/workflows/ci.yml', setup }), 'echo "$CHANGED"'].join('\n')], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const since = [`BASE=${base}`];
  touch('api/a.py');
  assert.equal(run(since), ',api,');
  touch('web/w.js');
  assert.equal(run(since), ',api,web,');
  touch('README.md');
  assert.equal(run(since), ',api,web,app,', 'a root file belongs to the root service');
  assert.equal(run(since, { apps: apps.slice(0, 2), sharedPaths: [] }), ',api,web,');
  assert.equal(run(['BASE=$(git rev-parse HEAD^)']), ',app,');
  touch('libs/l.py');
  assert.equal(run(['BASE=$(git rev-parse HEAD^)']), ',all,', 'a shared path rebuilds everything');
  touch('.github/workflows/ci.yml');
  assert.equal(run(['BASE=$(git rev-parse HEAD^)']), ',all,', 'so does the pipeline file');
  assert.equal(run(['ALL=1', ...since]), ',all,', 'tags, schedules and manual runs');
  assert.equal(run([]), ',all,', 'no base commit: do everything');
  assert.equal(run(['BASE=0000000000000000000000000000000000000000']), ',all,', 'a commit this clone does not have: do everything');
  touch('docs.txt');
  assert.equal(run(['BASE=$(git rev-parse HEAD^)'], { apps: apps.slice(0, 2), sharedPaths: [] }), ',', 'nothing of any service changed');
});

// -------------------------------------------------------------------------------------- a database per service

test('database per service: URLs, init scripts and redis numbers', () => {
  const dir = fullstack();
  const shared = file(generate(dir, { db: ['postgres'] }), 'docker-compose.yml');
  assert.equal(shared.match(/@postgres:5432\/app"/g).length, 2, 'off by default: one shared database');
  const r = generate(dir, { db: ['postgres', 'redis'], dbPerService: true });
  const compose = file(r, 'docker-compose.yml');
  assert.match(compose, /DATABASE_URL: "postgres:\/\/app:\$\{DB_PASSWORD:-app\}@postgres:5432\/api"/);
  assert.match(compose, /@postgres:5432\/billing"/);
  assert.match(compose, /REDIS_URL: "redis:\/\/redis:6379\/0"/);
  assert.match(compose, /REDIS_URL: "redis:\/\/redis:6379\/1"/);
  assert.match(compose, /postgres-data:\/var\/lib\/postgresql\/data\n {6}- \.\/db\/postgres:\/docker-entrypoint-initdb\.d:ro/);
  assert.equal(file(r, 'db/postgres/init.sql'), '-- One database per service. Runs once, when the data volume is first created.\nCREATE DATABASE api OWNER app;\nCREATE DATABASE billing OWNER app;\n');
  assert.equal(file(r, 'db/redis/init.sql'), undefined, 'redis has numbered databases, nothing to create');
  assert.ok(r.notes.some((n) => n.includes('api -> api') && n.includes('only runs when the data volume is first created')));
});

test('database per service: MySQL grants, MongoDB names, per-service lists, dashes', () => {
  const r = generate(null, { dbPerService: true, services: [svc('order-api', 'django', { db: ['mysql', 'mongo'] }), svc('billing', 'django', { db: ['mysql'] })] });
  const compose = file(r, 'docker-compose.yml');
  assert.match(compose, /mysql:\/\/app:\$\{DB_PASSWORD:-app\}@mysql:3306\/order_api"/);
  assert.match(compose, /MONGO_URL: "mongodb:\/\/mongo:27017\/order_api"/);
  assert.equal(
    file(r, 'db/mysql/init.sql'),
    "-- One database per service. Runs once, when the data volume is first created.\nCREATE DATABASE IF NOT EXISTS `order_api`;\nGRANT ALL PRIVILEGES ON `order_api`.* TO 'app'@'%';\nCREATE DATABASE IF NOT EXISTS `billing`;\nGRANT ALL PRIVILEGES ON `billing`.* TO 'app'@'%';\n",
  );
  assert.equal(file(r, 'db/mongo/init.sql'), undefined);
});

test('database per service: one service ignores it; redis has sixteen databases', () => {
  const single = generate({ services: [svc('backend', 'django')] }, { dbPerService: true, db: ['postgres'] });
  assert.ok(single.notes.some((n) => n.includes('A database per service was ignored')));
  assert.equal(file(single, 'db/postgres/init.sql'), undefined);
  const many = { services: Array.from({ length: 17 }, (_, i) => svc(`s${i}`, 'django')) };
  assert.throws(() => generate(many, { dbPerService: true, db: ['redis'] }), /redis has 16 databases/);
  assert.doesNotThrow(() => generate(many, { db: ['redis'] }));
});
