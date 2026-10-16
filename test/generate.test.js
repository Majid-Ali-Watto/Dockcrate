import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generate, writeFiles } from '../src/generate.js';

/** Creates a temp project dir from { 'relative/path': content }; objects are written as JSON. */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dockcrate-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const file = (result, path) => result.files.find((f) => f.path === path)?.content;

// Nothing is read from a project: every test names its stack.
const fresh = (opts) => generate(null, opts);

test('compose wires databases with healthchecks, volumes and connection URLs', () => {
  const r = fresh({ stack: 'node', db: ['postgres', 'redis'], port: 4000 });
  const compose = file(r, 'docker-compose.yml');
  assert.match(compose, /- "4000:4000"/);
  assert.match(compose, /DATABASE_URL: "postgres:\/\/app:\$\{DB_PASSWORD:\?set DB_PASSWORD in \.env\}@postgres:5432\/app"/);
  assert.match(compose, /REDIS_URL: "redis:\/\/:\$\{REDIS_PASSWORD:\?set REDIS_PASSWORD in \.env\}@redis:6379"/);
  assert.match(compose, /postgres:\n {8}condition: service_healthy/);
  assert.match(compose, /volumes:\n {2}postgres-data:\n {2}redis-data:/);
  assert.match(file(r, '.env.example'), /^DB_PASSWORD=change-me\nREDIS_PASSWORD=change-me$/m);
});

test('compose: no default passwords; every database and queue requires its own, Mongo, Redis and Elasticsearch included', () => {
  const r = fresh({ stack: 'node', db: ['postgres', 'mysql', 'mongo', 'redis', 'elasticsearch', 'rabbitmq'] });
  const compose = file(r, 'docker-compose.yml');
  assert.doesNotMatch(compose, /:-app\}|guest|xpack\.security\.enabled: "false"/);
  assert.match(compose, /POSTGRES_PASSWORD: "\$\{DB_PASSWORD:\?set DB_PASSWORD in \.env\}"/);
  assert.match(compose, /MYSQL_ROOT_PASSWORD: "\$\{DB_ROOT_PASSWORD:\?set DB_ROOT_PASSWORD in \.env\}"/);
  assert.match(compose, /MONGO_INITDB_ROOT_USERNAME: "app"\n {6}MONGO_INITDB_ROOT_PASSWORD: "\$\{MONGO_PASSWORD:\?/);
  assert.match(compose, /MONGO_URL: "mongodb:\/\/app:\$\{MONGO_PASSWORD:\?set MONGO_PASSWORD in \.env\}@mongo:27017\/app\?authSource=admin"/);
  assert.match(compose, /redis:\n {4}image: redis:7-alpine\n {4}command: \["redis-server","--requirepass","\$\{REDIS_PASSWORD:\?set REDIS_PASSWORD in \.env\}"\]/);
  assert.match(compose, /REDISCLI_AUTH: "\$\{REDIS_PASSWORD:\?/);
  assert.match(compose, /test: \["CMD-SHELL","redis-cli ping \| grep -q PONG"\]/);
  assert.match(compose, /ELASTIC_PASSWORD: "\$\{ELASTIC_PASSWORD:\?/);
  assert.match(compose, /curl -fs -u \\"elastic:\$\$ELASTIC_PASSWORD\\" http:\/\/localhost:9200\/_cluster\/health/);
  const env = file(r, '.env.example');
  for (const name of ['DB_PASSWORD', 'DB_ROOT_PASSWORD', 'MONGO_PASSWORD', 'REDIS_PASSWORD', 'ELASTIC_PASSWORD', 'RABBITMQ_PASSWORD']) assert.match(env, new RegExp(`^${name}=change-me$`, 'm'));
  assert.match(env, /^# Copy to \.env \(never commit it\) and replace every value/);
  // CI service containers get a fixed throwaway password; the CI redis has none (service containers cannot pass arguments).
  const ci = r.files.find((f) => f.kind === 'ci').content;
  assert.doesNotMatch(ci, /DB_PASSWORD/);
  const services = fresh({ stack: 'node', ciServices: ['mysql', 'redis', 'elasticsearch', 'rabbitmq'] });
  const sci = services.files.find((f) => f.kind === 'ci').content;
  assert.match(sci, /MYSQL_ROOT_PASSWORD: "ci-test-only"/);
  assert.match(sci, /RABBITMQ_DEFAULT_PASS: "ci-test-only"/);
  assert.match(sci, /REDIS_URL: "redis:\/\/localhost:6379"/);
  assert.doesNotMatch(sci, /REDISCLI_AUTH|\$\$|:\?set/);
  assert.ok(services.notes.some((n) => /throwaway password "ci-test-only"/.test(n) && /redis has no password/.test(n)));
});

test('the dev override publishes database ports on 127.0.0.1 only', () => {
  const dev = file(fresh({ stack: 'node', db: ['postgres', 'redis'], envs: ['dev'] }), 'docker-compose.dev.yml');
  assert.match(dev, /postgres:\n {4}ports:\n {6}- "127\.0\.0\.1:5432:5432"/);
  assert.match(dev, /redis:\n {4}ports:\n {6}- "127\.0\.0\.1:6379:6379"/);
  assert.doesNotMatch(dev, /- "\d+:\d+"/);
});

test('compose output reuses the target folder\'s existing compose file name', () => {
  const dir = project({ 'compose.yaml': 'services: {}' });
  const names = generate(dir, { stack: 'node' }).files.map((f) => f.path);
  assert.ok(names.includes('compose.yaml'));
  assert.ok(!names.includes('docker-compose.yml'));
});

test('gitlab and no-ci variants', () => {
  assert.match(file(fresh({ stack: 'node', ci: 'gitlab' }), '.gitlab-ci.yml'), /image: node:24/);
  assert.equal(fresh({ stack: 'node', ci: 'none' }).files.some((f) => /ci|workflows/.test(f.path)), false);
});

test('invalid options are rejected', () => {
  assert.throws(() => generate(null, {}), /choose a stack/);
  assert.throws(() => fresh({ stack: 'rails' }), /unknown stack/);
  assert.throws(() => fresh({ stack: 'node', db: ['oracle'] }), /unknown database/);
  assert.throws(() => fresh({ stack: 'node', port: 99999 }), /invalid --port/);
});

test('writeFiles keeps existing files unless forced', () => {
  const dir = project({ Dockerfile: 'mine' });
  const { files } = generate(dir, { stack: 'node' });
  const first = writeFiles(dir, files);
  assert.equal(first.find((f) => f.path === 'Dockerfile').status, 'skipped');
  assert.equal(readFileSync(join(dir, 'Dockerfile'), 'utf8'), 'mine');
  assert.ok(existsSync(join(dir, '.github/workflows/ci.yml')));
  writeFiles(dir, files, { force: true });
  assert.notEqual(readFileSync(join(dir, 'Dockerfile'), 'utf8'), 'mine');
});

test('every stack can generate a new project with defaults', () => {
  for (const stack of ['node', 'react', 'vue', 'angular', 'fastapi', 'django', 'dotnet', 'java', 'go', 'rust', 'php', 'ruby']) {
    const r = fresh({ stack });
    assert.equal(r.stack, stack);
    assert.deepEqual(r.files.map((f) => f.kind).filter((k, i, a) => a.indexOf(k) === i), ['dockerfile', 'dockerignore', 'compose', 'ci']);
    assert.ok(r.notes.some((n) => n.startsWith('These files assume')), stack);
  }
});

test('new project: tool choice drives the install commands', () => {
  assert.match(file(fresh({ stack: 'node', tool: 'pnpm' }), 'Dockerfile'), /pnpm install --frozen-lockfile --prod/);
  assert.match(file(fresh({ stack: 'react', tool: 'yarn' }), 'Dockerfile'), /yarn install --frozen-lockfile/);
  assert.match(file(fresh({ stack: 'fastapi', tool: 'uv' }), 'Dockerfile'), /uv sync --frozen/);
  assert.match(file(fresh({ stack: 'django', tool: 'poetry' }), 'Dockerfile'), /poetry install --no-root --only main/);
  assert.match(file(fresh({ stack: 'java', tool: 'gradle' }), 'Dockerfile'), /sh \.\/gradlew --no-daemon bootJar/);
  assert.match(file(fresh({ stack: 'java' }), 'Dockerfile'), /mvn -B -DskipTests package/);
});

test('new project: name, runtime, port and build step options', () => {
  assert.match(file(fresh({ stack: 'angular', name: 'shop' }), 'Dockerfile'), /\/app\/dist\/shop\/browser\//);
  assert.match(file(fresh({ stack: 'dotnet', name: 'Shop.Api', runtime: '8.0' }), 'Dockerfile'), /dotnet publish "Shop\.Api\.csproj".*\n[\s\S]*dotnet\/aspnet:8\.0[\s\S]*"Shop\.Api\.dll"/);
  assert.match(file(fresh({ stack: 'django', name: 'mysite' }), 'Dockerfile'), /mysite\.wsgi:application/);
  assert.match(file(fresh({ stack: 'fastapi', runtime: '3.12', port: 9000 }), 'Dockerfile'), /python:3\.12-slim[\s\S]*"--port","9000"/);
  assert.match(file(fresh({ stack: 'node' }), 'Dockerfile'), /RUN npm run build/);
  assert.doesNotMatch(file(fresh({ stack: 'node', build: false }), 'Dockerfile'), /npm run build/);
  assert.match(file(fresh({ stack: 'node' }), 'Dockerfile'), /CMD \["npm","start"\]/);
});

test('new project CI only installs and builds (no test or lint scripts assumed)', () => {
  const ci = file(fresh({ stack: 'node' }), '.github/workflows/ci.yml');
  assert.match(ci, /run: npm ci/);
  assert.match(ci, /run: npm run build/);
  assert.doesNotMatch(ci, /npm test|npm run lint/);
  assert.doesNotMatch(file(fresh({ stack: 'fastapi' }), '.github/workflows/ci.yml'), /pytest/);
});

test('nothing is read from the project folder, but its compose file name is reused', () => {
  assert.equal(generate('/definitely/not/here', { stack: 'vue' }).stack, 'vue');
  const dir = project({ 'compose.yml': '' });
  assert.ok(generate(dir, { stack: 'vue' }).files.some((f) => f.path === 'compose.yml'));
});

test('include selects file groups', () => {
  const r = fresh({ stack: 'react', include: ['dockerfile', 'ci'], db: ['redis'] });
  assert.deepEqual(r.files.map((f) => f.path), ['Dockerfile', 'nginx.conf', '.github/workflows/ci.yml']);
  const compose = fresh({ stack: 'node', include: ['compose'], db: ['postgres'] });
  assert.deepEqual(compose.files.map((f) => f.path), ['docker-compose.yml', '.env.example']);
  assert.deepEqual(fresh({ stack: 'node', include: ['dockerignore'] }).files.map((f) => f.path), ['.dockerignore']);
});

test('new project and option validation', () => {
  assert.throws(() => generate(null, {}), /choose a stack/);
  assert.throws(() => fresh({ stack: 'node', tool: 'bun' }), /supports --tool npm \| yarn \| pnpm/);
  assert.throws(() => fresh({ stack: 'dotnet', tool: 'npm' }), /no --tool option/);
  assert.throws(() => fresh({ stack: 'dotnet', name: 'x"; rm -rf /' }), /invalid name/);
  assert.throws(() => fresh({ stack: 'node', runtime: '24\nRUN evil' }), /invalid runtime/);
  assert.throws(() => fresh({ stack: 'react', buildDir: 'dist; x' }), /invalid buildDir/);
  assert.throws(() => fresh({ stack: 'node', include: ['nope'] }), /unknown file group/);
  assert.throws(() => fresh({ stack: 'node', include: [] }), /at least one/);
});

// ---- deployment targets and pipeline options

const ciOf = (opts) => {
  const r = fresh({ stack: 'node', ...opts });
  return { r, text: r.files.find((f) => f.kind === 'ci').content };
};

test('default pipeline: push main + tags, PRs, superseded PR runs cancelled, image only', () => {
  const { text } = ciOf({});
  assert.match(text, /branches: \["main"\]\n {4}tags: \["v\*"\]\n {2}pull_request:/);
  assert.match(text, /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/);
  assert.match(text, /\n {2}image:\n/);
  assert.doesNotMatch(text, /\n {2}deploy:/);
});

test('triggers: branches, tags, PRs, manual and schedule', () => {
  const { text } = ciOf({ branches: ['main', 'release/*'], tags: '', pullRequests: false, manual: true, schedule: '0 3 * * 1' });
  assert.match(text, /branches: \["main","release\/\*"\]/);
  assert.doesNotMatch(text, /\n {4}tags:|\n {2}pull_request:/);
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /- cron: "0 3 \* \* 1"/);
  assert.throws(() => ciOf({ branches: [], tags: '', pullRequests: false }), /at least one pipeline trigger/);
  assert.throws(() => ciOf({ schedule: 'every day' }), /invalid schedule/);
  assert.throws(() => ciOf({ branches: ['main; rm -rf /'] }), /invalid branch/);
});

test('concurrency modes', () => {
  assert.match(ciOf({ concurrency: 'always' }).text, /cancel-in-progress: true/);
  assert.match(ciOf({ concurrency: 'queue' }).text, /cancel-in-progress: false/);
  assert.doesNotMatch(ciOf({ concurrency: 'off' }).text, /\nconcurrency:/);
  assert.throws(() => ciOf({ concurrency: 'sometimes' }), /invalid concurrency/);
});

test('test matrix: runtime versions and operating systems', () => {
  const { text } = ciOf({ testVersions: ['20', '22'], testOs: ['ubuntu-latest', 'windows-latest'] });
  assert.match(text, /runs-on: \$\{\{ matrix.os \}\}/);
  assert.match(text, /os: \["ubuntu-latest","windows-latest"\]\n {8}version: \["20","22"\]/);
  assert.match(text, /node-version: "\$\{\{ matrix.version \}\}"/);
  assert.match(text, /shell: bash/);
  const gl = generate(null, { stack: 'node', ci: 'gitlab', testVersions: ['20', '22'] }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /image: node:\$VERSION/);
  assert.match(gl, /- VERSION: \["20","22"\]/);
});

test('permissions: read-only by default; extras, id-token and packages only on the jobs that publish or deploy', () => {
  const { r, text } = ciOf({ permissions: ['pull-requests-write', 'id-token-write'], deploy: 'ssh' });
  assert.match(text, /\npermissions:\n {2}contents: read\n\n/);
  assert.match(text, /\n {2}image:[\s\S]*permissions:\n {6}contents: read\n {6}pull-requests: write\n {6}packages: write\n/);
  assert.match(text, /\n {2}deploy:[\s\S]*permissions:\n {6}contents: read\n {6}pull-requests: write\n/);
  // The test job runs the pull request's code: it never gets more than the read-only default.
  const testJob = text.slice(text.indexOf('\n  test:'), text.indexOf('\n  image:'));
  assert.doesNotMatch(testJob, /permissions|pull-requests/);
  assert.doesNotMatch(text, /id-token/);
  assert.ok(r.notes.some((n) => /pull-requests-write\) are granted to the image and deploy jobs only/.test(n)));
});

test('every checkout leaves no token behind (persist-credentials: false), on GitHub and Gitea', () => {
  for (const ci of ['github', 'gitea']) {
    const files = generate(null, { ci, deploy: 'ssh', lintDockerfile: true, codeScan: true, changedOnly: true, services: [{ name: 'api', dir: 'api', stack: 'node' }, { name: 'web', dir: 'web', stack: 'react' }] }).files.filter((f) => f.kind === 'ci');
    const text = files.map((f) => f.content).join('\n');
    const checkouts = [...text.matchAll(/uses: actions\/checkout@\S+.*\n((?: {8}.*\n)*)/g)];
    assert.ok(checkouts.length >= 4, ci);
    for (const [, rest] of checkouts) assert.match(rest, /persist-credentials: "false"/, ci);
  }
});

test('platforms add QEMU and the platforms input', () => {
  const { text } = ciOf({ platforms: ['linux/amd64', 'linux/arm64'] });
  assert.match(text, /docker\/setup-qemu-action@[0-9a-f]{40} # v3/);
  assert.match(text, /platforms: "linux\/amd64,linux\/arm64"/);
  assert.doesNotMatch(ciOf({}).text, /qemu/);
});

test('every deploy target adds a deploy job, its secrets note and its files', () => {
  const expectFiles = { kubernetes: ['k8s/deployment.yaml', 'k8s/service.yaml'], ecs: ['ecs/task-definition.json'], fly: ['fly.toml'] };
  for (const deploy of ['ssh', 'kubernetes', 'cloudrun', 'ecs', 'azure', 'fly']) {
    const r = fresh({ stack: 'fastapi', deploy });
    const ci = r.files.find((f) => f.kind === 'ci').content;
    assert.match(ci, /\n {2}deploy:\n/, deploy);
    assert.deepEqual(r.files.filter((f) => f.kind === 'deploy').map((f) => f.path), expectFiles[deploy] ?? [], deploy);
    assert.ok(r.notes.some((n) => /^Add to GitHub/.test(n)), deploy);
  }
  assert.doesNotMatch(fresh({ stack: 'node', deploy: 'fly' }).files.find((f) => f.kind === 'ci').content, /\n {2}image:/);
});

test('deploy on branch, tag or manual run; a missing trigger is reported, never added behind your back', () => {
  assert.match(ciOf({ deploy: 'ssh' }).text, /if: "github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)"/);
  const tag = ciOf({ deploy: 'ssh', deployOn: 'tag', tags: '' });
  assert.match(tag.text, /if: "startsWith\(github.ref, 'refs\/tags\/'\)"/);
  assert.doesNotMatch(tag.text, /\n {4}tags: \[/);
  assert.ok(tag.r.notes.some((n) => /no tag trigger is enabled/.test(n)));
  const manual = ciOf({ deploy: 'ssh', deployOn: 'manual' });
  assert.doesNotMatch(manual.text, /workflow_dispatch:/);
  assert.ok(manual.r.notes.some((n) => /manual-run trigger is off/.test(n)));
  const both = ciOf({ deploy: 'ssh', deployOn: 'manual', manual: true });
  assert.match(both.text, /workflow_dispatch:/);
  assert.match(both.text, /github.event_name == 'workflow_dispatch'/);
});

test('deploy job: environment, serialised concurrency, per-target secrets', () => {
  const { text } = ciOf({ deploy: 'ssh', environment: 'staging' });
  assert.match(text, /deploy:[\s\S]*environment: staging\n {4}concurrency:\n {6}group: deploy-staging\n {6}cancel-in-progress: false/);
  assert.match(text, /SSH_PRIVATE_KEY: "\$\{\{ secrets.SSH_PRIVATE_KEY \}\}"/);
  assert.match(text, /IMAGE: "\$\{\{ needs.image.outputs.image \}\}"/);
});

test('OIDC by default on GitHub; cloudAuth keys switches to stored keys, and the id-token permission still forces OIDC', () => {
  const keys = ciOf({ deploy: 'cloudrun', cloudAuth: 'keys' });
  assert.match(keys.text, /credentials_json: "\$\{\{ secrets.GCP_SA_KEY \}\}"/);
  assert.doesNotMatch(keys.text, /id-token/);
  assert.ok(keys.r.notes.some((n) => /stored long-lived key/.test(n)));
  for (const oidc of [ciOf({ deploy: 'cloudrun' }), ciOf({ deploy: 'cloudrun', cloudAuth: 'keys', permissions: ['id-token-write'] })]) {
    assert.match(oidc.text, /workload_identity_provider/);
    assert.match(oidc.text, /id-token: write/);
    assert.doesNotMatch(oidc.text, /GCP_SA_KEY/);
  }
  assert.ok(ciOf({ deploy: 'cloudrun' }).r.notes.some((n) => /Cloud login uses OIDC/.test(n)));
  assert.ok(ciOf({ deploy: 'ecs' }).r.notes.some((n) => /^Add to GitHub.*AWS_ROLE_ARN/.test(n)));
  assert.match(ciOf({ deploy: 'ecs' }).text, /role-to-assume/);
  assert.match(ciOf({ deploy: 'azure' }).text, /client-id/);
  assert.match(ciOf({ deploy: 'ecs', cloudAuth: 'keys' }).text, /aws-secret-access-key/);
  assert.match(ciOf({ deploy: 'azure', cloudAuth: 'keys' }).text, /creds: "\$\{\{ secrets.AZURE_CREDENTIALS \}\}"/);
  // Other providers keep stored keys; the option is GitHub's.
  const gl = fresh({ stack: 'node', ci: 'gitlab', deploy: 'cloudrun' });
  assert.ok(gl.notes.some((n) => /GCP_SA_KEY/.test(n)));
  assert.ok(gl.notes.some((n) => /OIDC login is GitHub-only/.test(n)));
  assert.throws(() => ciOf({ deploy: 'cloudrun', cloudAuth: 'password' }), /invalid cloud auth/);
});

test('registry follows the target: Artifact Registry, ECR, ACR, GHCR', () => {
  assert.match(ciOf({ deploy: 'cloudrun' }).text, /-docker\.pkg\.dev\/\$\{\{ vars\.GCP_PROJECT \}\}\/\$\{\{ vars\.GAR_REPO \}\}\/app/);
  assert.match(ciOf({ deploy: 'ecs' }).text, /amazon-ecr-login@[0-9a-f]{40} # v2/);
  assert.match(ciOf({ deploy: 'azure' }).text, /az acr login/);
  assert.match(ciOf({ deploy: 'ssh' }).text, /ghcr\.io/);
});

test('ssh deploy makes compose pull a prebuilt image; other targets leave compose alone', () => {
  const ssh = fresh({ stack: 'node', name: 'Shop', deploy: 'ssh' });
  assert.match(file(ssh, 'docker-compose.yml'), /image: "\$\{APP_IMAGE:-shop:local\}"\n {4}build: \./);
  assert.doesNotMatch(file(fresh({ stack: 'node', deploy: 'kubernetes' }), 'docker-compose.yml'), /APP_IMAGE/);
});

test('app name is a DNS-safe slug of the project name or folder', () => {
  const k8s = file(fresh({ stack: 'node', name: 'My_Shop.API', deploy: 'kubernetes' }), 'k8s/deployment.yaml');
  assert.match(k8s, /name: my-shop-api/);
  const dir = project({});
  assert.match(generate(dir, { stack: 'node', deploy: 'fly' }).files.find((f) => f.path === 'fly.toml').content, /^app = "dockcrate-[a-zA-Z0-9]+"|^app = "dockcrate-/m);
});

test('deploy options are validated', () => {
  assert.throws(() => ciOf({ deploy: 'heroku' }), /unknown deploy target/);
  assert.throws(() => ciOf({ deploy: 'ssh', deployOn: 'someday' }), /invalid deploy-on/);
  assert.throws(() => ciOf({ deploy: 'ssh', environment: 'prod uction' }), /invalid environment/);
  assert.throws(() => ciOf({ permissions: ['admin'] }), /invalid permission/);
  assert.throws(() => ciOf({ testOs: ['solaris'] }), /invalid test OS/);
  assert.throws(() => generate(null, { stack: 'node', ci: 'none', deploy: 'ssh' }), /needs a CI provider/);
});

test('gitlab: workflow rules, resource group, manual deploy, ignored GitHub-only settings', () => {
  const r = generate(null, {
    stack: 'node', ci: 'gitlab', deploy: 'kubernetes', deployOn: 'manual',
    branches: ['main', 'release/*'], tags: 'v*', permissions: ['contents-write'], testOs: ['windows-latest'], schedule: '0 3 * * 1',
  });
  const text = r.files.find((f) => f.kind === 'ci').content;
  assert.match(text, /\$CI_COMMIT_BRANCH =~ \/\^\(main\|release\\\/\.\*\)\$\//);
  assert.match(text, /- if: \$CI_COMMIT_TAG =~ \/\^\(v\.\*\)\$\//);
  assert.match(text, /\$CI_PIPELINE_SOURCE == "schedule"/);
  assert.match(text, /resource_group: production/);
  assert.match(text, /rules:\n {4}- if: \$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH\n {6}when: manual/);
  assert.match(text, /interruptible: true/);
  assert.ok(r.notes.some((n) => /Token permissions is not supported by GitLab CI/.test(n)));
  assert.ok(r.notes.some((n) => /The test OS matrix is not supported by GitLab CI/.test(n)));
  assert.ok(r.notes.some((n) => /pipeline schedule/.test(n)));
  assert.match(r.notes.find((n) => /^Add to GitLab/.test(n)), /KUBE_CONFIG/);
});

test('include can select the deploy files on their own', () => {
  const r = fresh({ stack: 'node', deploy: 'kubernetes', include: ['deploy'] });
  assert.deepEqual(r.files.map((f) => f.path), ['k8s/deployment.yaml', 'k8s/service.yaml']);
});

test('compose without databases is exactly the app service (no stray lines)', () => {
  assert.equal(
    file(fresh({ stack: 'fastapi' }), 'docker-compose.yml'),
    'services:\n  app:\n    build: .\n    ports:\n      - "8000:8000"\n    restart: unless-stopped\n',
  );
  assert.equal(
    file(fresh({ stack: 'fastapi', name: 'Api', deploy: 'ssh' }), 'docker-compose.yml'),
    'services:\n  app:\n    image: "${APP_IMAGE:-api:local}"\n    build: .\n    ports:\n      - "8000:8000"\n    restart: unless-stopped\n',
  );
});

test('lines() rejects stray non-string parts instead of printing them', async () => {
  const { lines } = await import('../src/fsutil.js');
  assert.throws(() => lines('a', [].length && 'b'), /unexpected number/);
  assert.equal(lines('a', false, null, undefined, ['', 'b']), 'a\n\nb\n');
});

// ---- selectable CI steps, CI services, image scan, container options

const stepsOf = (opts) => {
  const r = fresh(opts);
  return { r, ci: r.files.find((f) => f.kind === 'ci').content, df: file(r, 'Dockerfile') };
};

test('CI steps are chosen per stack; defaults keep what the project defines', () => {
  const all = stepsOf({ stack: 'node', ciSteps: ['lint', 'test', 'build', 'audit'] }).ci;
  assert.match(all, /run: npm run lint\n\s+- run: npm test\n\s+- run: npm run build\n\s+- run: npm audit --omit=dev --audit-level=high/);
  const none = stepsOf({ stack: 'node', ciSteps: [] }).ci;
  assert.doesNotMatch(none, /npm run (lint|build)|npm test|audit/);
  assert.deepEqual(fresh({ stack: 'node' }).ci, { available: ['lint', 'test', 'build', 'audit'], selected: ['build'] });
  assert.deepEqual(fresh({ stack: 'fastapi' }).ci.available, ['lint', 'test', 'audit']);
  assert.deepEqual(fresh({ stack: 'java' }).ci.available, ['test', 'build']);
  assert.throws(() => fresh({ stack: 'java', ciSteps: ['lint'] }), /lint CI step is not available for java/);
  assert.throws(() => fresh({ stack: 'node', ciSteps: ['deploy'] }), /invalid CI step/);
});

test('python CI steps: ruff, pytest (installed when missing), pip-audit, per package manager', () => {
  const pip = stepsOf({ stack: 'fastapi', ciSteps: ['lint', 'test', 'audit'] }).ci;
  assert.match(pip, /pip install ruff\n\s+- run: ruff check \.\n\s+- run: pip install pytest\n\s+- run: pytest\n\s+- run: pip install pip-audit\n\s+- run: pip-audit -r requirements\.txt/);
  assert.match(stepsOf({ stack: 'fastapi', tool: 'uv', ciSteps: ['test'] }).ci, /uv run --with pytest pytest/);
  assert.match(stepsOf({ stack: 'django', tool: 'poetry', ciSteps: ['test'] }).ci, /poetry run python manage\.py test/);
  assert.match(stepsOf({ stack: 'fastapi', tool: 'uv', ciSteps: ['audit'] }).ci, /uv export --frozen --no-dev --no-hashes/);
});

test('dotnet and java CI steps', () => {
  const dn = stepsOf({ stack: 'dotnet', ciSteps: ['lint', 'test', 'audit'] }).ci;
  assert.match(dn, /dotnet format --verify-no-changes --no-restore/);
  assert.match(dn, /dotnet build --no-restore -c Release\n\s+- run: dotnet test --no-build/);
  assert.match(dn, /vulnerable --include-transitive/);
  assert.doesNotMatch(stepsOf({ stack: 'dotnet', ciSteps: ['lint'] }).ci, /dotnet build|dotnet test/);
  assert.match(stepsOf({ stack: 'java', ciSteps: ['test'] }).ci, /mvn -B verify/);
  assert.match(stepsOf({ stack: 'java', ciSteps: ['build'] }).ci, /mvn -B -DskipTests package/);
  assert.match(stepsOf({ stack: 'java', tool: 'gradle', ciSteps: ['test', 'build'] }).ci, /\.\/gradlew build/);
  assert.match(stepsOf({ stack: 'java', tool: 'gradle', ciSteps: ['build'] }).ci, /\.\/gradlew assemble/);
  assert.doesNotMatch(stepsOf({ stack: 'java', ciSteps: [] }).ci, /mvn/);
});

test('angular tests run headless and note the Karma requirement', () => {
  const { r, ci } = stepsOf({ stack: 'angular', ciSteps: ['test'] });
  assert.match(ci, /npm test -- --watch=false --browsers=ChromeHeadless/);
  assert.ok(r.notes.some((n) => /headless Chrome/.test(n)));
});

test('CI service containers: GitHub services + localhost URLs, GitLab services + alias hosts', () => {
  const { ci } = stepsOf({ stack: 'node', ciServices: ['postgres', 'mongo'] });
  assert.match(ci, /services:\n {6}postgres:\n {8}image: postgres:17-alpine/);
  assert.match(ci, /"5432:5432"/);
  assert.match(ci, /--health-cmd \\"pg_isready -U app -d app\\"/);
  assert.match(ci, /--health-cmd \\"mongosh --quiet --eval 1\\"/);
  assert.match(ci, /DATABASE_URL: "postgres:\/\/app:ci-test-only@localhost:5432\/app"/);
  assert.match(ci, /MONGO_URL: "mongodb:\/\/app:ci-test-only@localhost:27017\/app\?authSource=admin"/);
  assert.match(ci, /MONGO_INITDB_ROOT_PASSWORD: "ci-test-only"/);
  const gl = generate(null, { stack: 'node', ci: 'gitlab', ciServices: ['postgres', 'redis'] }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /services:\n {4}- name: postgres:17-alpine\n {6}alias: postgres/);
  assert.match(gl, /DATABASE_URL: "postgres:\/\/app:ci-test-only@postgres:5432\/app"/);
  assert.match(gl, /REDIS_URL: "redis:\/\/redis:6379"/);
  assert.throws(() => stepsOf({ stack: 'node', ciServices: ['postgres'], testOs: ['windows-latest'] }), /need Linux runners/);
  assert.throws(() => stepsOf({ stack: 'node', ciServices: ['oracle'] }), /invalid CI service/);
});

test('image scan: Trivy action on GitHub; on GitLab a docker run of Trivy between build and push, any registry', () => {
  const gh = stepsOf({ stack: 'node', scan: true }).ci;
  assert.match(gh, /aquasecurity\/trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1 # 0\.35\.0/);
  assert.match(gh, /image-ref: "\$\{\{ steps.ref.outputs.image \}\}"/);
  const gl = generate(null, { stack: 'node', ci: 'gitlab', scan: true, deploy: 'kubernetes' }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /stages: \[test, build, deploy\]/);
  assert.match(gl, /docker build [\s\S]*aquasec\/trivy:0\.69\.3 image --exit-code 1 --severity HIGH,CRITICAL[\s\S]*docker push --all-tags/);
  assert.match(gl, /needs: \[build-image\]/);
  const cloud = generate(null, { stack: 'node', ci: 'gitlab', scan: true, deploy: 'cloudrun' }).files.find((f) => f.kind === 'ci').content;
  assert.match(cloud, /aquasec\/trivy/);
  assert.ok(fresh({ stack: 'node', scan: true, deploy: 'fly' }).notes.some((n) => /nothing to scan/.test(n)));
});

test('container options: healthcheck per base image', () => {
  assert.match(stepsOf({ stack: 'node', healthcheck: '/health' }).df, /HEALTHCHECK --interval=30s .* CMD wget -qO \/dev\/null http:\/\/127\.0\.0\.1:3000\/health \|\| exit 1/);
  assert.match(stepsOf({ stack: 'react', healthcheck: '/' }).df, /HEALTHCHECK .* CMD wget -qO \/dev\/null http:\/\/127\.0\.0\.1:8080\/ \|\| exit 1/);
  assert.match(stepsOf({ stack: 'fastapi', healthcheck: '/health' }).df, /HEALTHCHECK .* CMD \["python","-c","import urllib\.request; urllib\.request\.urlopen\('http:\/\/127\.0\.0\.1:8000\/health', timeout=3\)"\]/);
  const dn = stepsOf({ stack: 'dotnet', healthcheck: '/health' });
  assert.match(dn.df, /CMD \["bash","-c","exec 3<>\/dev\/tcp\/127\.0\.0\.1\/8080"\]/);
  assert.ok(dn.r.notes.some((n) => /only checks that the port accepts connections/.test(n)));
  assert.doesNotMatch(stepsOf({ stack: 'node' }).df, /HEALTHCHECK/);
  assert.throws(() => stepsOf({ stack: 'node', healthcheck: 'health' }), /invalid healthcheck/);
});

test('container options: OS packages use apk on alpine and apt on debian/ubuntu images', () => {
  assert.match(stepsOf({ stack: 'node', packages: ['curl', 'tini'] }).df, /FROM base AS runtime[\s\S]*RUN apk add --no-cache curl tini\n# The code[^\n]*\nCOPY --from=build/);
  assert.match(stepsOf({ stack: 'fastapi', packages: ['libpq5'] }).df, /RUN apt-get update \\\n {4}&& apt-get install -y --no-install-recommends libpq5 \\\n {4}&& rm -rf \/var\/lib\/apt\/lists\/\*/);
  assert.match(stepsOf({ stack: 'java', packages: ['tzdata'] }).df, /apt-get install -y --no-install-recommends tzdata/);
  const spa = stepsOf({ stack: 'react', packages: ['curl'] });
  assert.doesNotMatch(spa.df, /apk add|apt-get/);
  assert.ok(spa.r.notes.some((n) => /static nginx site/.test(n)));
  assert.throws(() => stepsOf({ stack: 'node', packages: ['bad;rm'] }), /invalid package/);
});

test('container options: env vars land in the image; static sites ignore them', () => {
  const { df } = stepsOf({ stack: 'fastapi', env: ['LOG_LEVEL=info', 'GREETING=say "hi"'] });
  assert.match(df, /ENV LOG_LEVEL="info"\nENV GREETING="say \\"hi\\""/);
  assert.ok(stepsOf({ stack: 'react', env: 'A=1' }).r.notes.some((n) => /Runtime environment variables were ignored/.test(n)));
  assert.throws(() => stepsOf({ stack: 'node', env: ['1BAD=x'] }), /invalid environment variable/);
  assert.throws(() => stepsOf({ stack: 'node', env: ['NOEQUALS'] }), /use NAME=value/);
});

test('container options: build args flow to Dockerfile, compose and CI', () => {
  const r = fresh({ stack: 'react', buildArgs: ['VITE_API_URL=http://localhost:3000', 'VITE_FLAG'] });
  assert.match(file(r, 'Dockerfile'), /COPY \. \.\nARG VITE_API_URL=http:\/\/localhost:3000\nENV VITE_API_URL=\$VITE_API_URL\nARG VITE_FLAG\nENV VITE_FLAG=\$VITE_FLAG\nRUN npm run build/);
  assert.match(file(r, 'docker-compose.yml'), /build:\n {6}context: \.\n {6}args:\n {8}VITE_API_URL: "\$\{VITE_API_URL:-http:\/\/localhost:3000\}"\n {8}VITE_FLAG: "\$\{VITE_FLAG:-\}"/);
  const ci = r.files.find((f) => f.kind === 'ci').content;
  assert.match(ci, /build-args: "VITE_API_URL=\$\{\{ vars.VITE_API_URL \}\}\\nVITE_FLAG=\$\{\{ vars.VITE_FLAG \}\}"|build-args: \|/);
  assert.ok(r.notes.some((n) => /read from GitHub repository variables/.test(n)));
  const gl = generate(null, { stack: 'node', ci: 'gitlab', buildArgs: ['API=1'] }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /docker build --build-arg API="\$API" -t/);
  assert.ok(stepsOf({ stack: 'fastapi', buildArgs: ['X=1'] }).r.notes.some((n) => /Build args apply to Node and static-site/.test(n)));
});

test('rabbitmq is a compose service with an AMQP URL', () => {
  const r = fresh({ stack: 'node', db: ['rabbitmq'] });
  assert.match(file(r, 'docker-compose.yml'), /AMQP_URL: "amqp:\/\/app:\$\{RABBITMQ_PASSWORD:\?set RABBITMQ_PASSWORD in \.env\}@rabbitmq:5672"/);
  assert.match(file(r, 'docker-compose.yml'), /RABBITMQ_DEFAULT_PASS: "\$\{RABBITMQ_PASSWORD:\?/);
  assert.match(file(r, 'docker-compose.yml'), /rabbitmq-diagnostics/);
});

test('GitLab test job always has a script, even with no CI steps selected', () => {
  const text = generate(null, { stack: 'java', ci: 'gitlab', ciSteps: [] }).files.find((f) => f.kind === 'ci').content;
  assert.match(text, /script:\n {4}- echo "No test steps selected"/);
});

// ------------------------------------------------------------------------------------ Go and Rust

test('go: a static binary in alpine, the main package at the root', () => {
  const r = fresh({ stack: 'go', healthcheck: '/health', packages: ['curl'] });
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM golang:1\.25-alpine AS build/);
  assert.match(df, /CGO_ENABLED=0 go build .* -o \/out\/app \./);
  assert.match(df, /FROM alpine:3 AS runtime/);
  assert.match(df, /RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app/);
  assert.match(df, /RUN apk add --no-cache curl/);
  assert.match(df, /USER 10001:10001/);
  assert.match(df, /HEALTHCHECK .* wget -qO \/dev\/null http:\/\/127\.0\.0\.1:8080\/health/);
  assert.match(file(fresh({ stack: 'go', runtime: '1.23' }), 'Dockerfile'), /FROM golang:1\.23-alpine AS build/);
  assert.match(file(r, '.github/workflows/ci.yml'), /actions\/setup-go@[0-9a-f]{40} # v5/);
  const audit = fresh({ stack: 'go', ciSteps: ['lint', 'audit'] }).files.find((f) => f.kind === 'ci').content;
  assert.match(audit, /run: go vet .\/\.\.\./);
  assert.match(audit, /govulncheck/);
});

test('rust: the crate name and a locked build drive the Dockerfile', () => {
  const r = fresh({ stack: 'rust', name: 'my-svc', runtime: '1.82' });
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM rust:1\.82-alpine AS build/);
  assert.match(df, /cargo build --release --locked/);
  assert.match(df, /cp target\/release\/my-svc \/out\/app/);
  assert.match(file(fresh({ stack: 'rust' }), 'Dockerfile'), /FROM rust:1-alpine AS build/);
});

test('mariadb, memcached, elasticsearch and mailpit are compose services; stateless ones get no volume', () => {
  const r = fresh({ stack: 'node', db: ['mariadb', 'memcached', 'elasticsearch', 'mailpit'] });
  const compose = file(r, 'docker-compose.yml');
  assert.match(compose, /DATABASE_URL: "mysql:\/\/app:\$\{DB_PASSWORD:\?set DB_PASSWORD in \.env\}@mariadb:3306\/app"/);
  assert.match(compose, /MEMCACHED_URL: "memcached:11211"/);
  assert.match(compose, /ELASTICSEARCH_URL: "http:\/\/elastic:\$\{ELASTIC_PASSWORD:\?set ELASTIC_PASSWORD in \.env\}@elasticsearch:9200"/);
  assert.match(compose, /xpack\.security\.enabled: "true"/);
  assert.doesNotMatch(compose, /xpack\.security\.enabled: "false"/);
  assert.match(compose, /DB_ROOT_PASSWORD/);
  assert.match(compose, /SMTP_URL: "smtp:\/\/mailpit:1025"/);
  assert.match(compose, /volumes:\n {2}mariadb-data:\n {2}elasticsearch-data:\n?$/);
  assert.doesNotMatch(compose, /memcached-data|mailpit-data/);
  assert.ok(r.notes.some((n) => /web inbox is on port 8025/.test(n)));
  assert.throws(() => fresh({ stack: 'node', db: ['mysql', 'mariadb'] }), /both listen on port 3306/);
  const ci = stepsOf({ stack: 'node', ciServices: ['memcached'] }).ci;
  assert.match(ci, /MEMCACHED_URL: "localhost:11211"/);
});

test('several SQL engines: the first keeps DATABASE_URL, the others get their own variable', () => {
  const compose = file(fresh({ stack: 'node', db: ['postgres', 'mariadb'] }), 'docker-compose.yml');
  assert.match(compose, /DATABASE_URL: "postgres:\/\/app:\$\{DB_PASSWORD:\?set DB_PASSWORD in \.env\}@postgres:5432\/app"/);
  assert.match(compose, /MARIADB_URL: "mysql:\/\/app:\$\{DB_PASSWORD:\?set DB_PASSWORD in \.env\}@mariadb:3306\/app"/);
  assert.equal(compose.match(/DATABASE_URL/g).length, 1);
  const ci = stepsOf({ stack: 'node', ciServices: ['mysql', 'postgres'] }).ci;
  assert.match(ci, /DATABASE_URL: "mysql:\/\/app:ci-test-only@localhost:3306\/app"/);
  assert.match(ci, /POSTGRES_URL: "postgres:\/\/app:ci-test-only@localhost:5432\/app"/);
});

// ------------------------------------------------------------------- supply chain and security

test('Docker Hub replaces GHCR for registry-based targets, but not cloud targets', () => {
  const gh = stepsOf({ stack: 'node', registry: 'dockerhub' }).ci;
  assert.match(gh, /username: "\$\{\{ vars.DOCKERHUB_USERNAME \}\}"/);
  assert.match(gh, /IMAGE_NAME: "\$\{\{ vars.DOCKERHUB_USERNAME \}\}\/app"/);
  assert.doesNotMatch(gh, /ghcr\.io/);
  assert.doesNotMatch(gh, /packages: write/);
  const gl = fresh({ stack: 'node', ci: 'gitlab', registry: 'dockerhub' }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /IMAGE_REPO: "\$DOCKERHUB_USERNAME\/app"/);
  assert.match(gl, /docker login -u "\$DOCKERHUB_USERNAME"/);
  assert.ok(fresh({ stack: 'node', deploy: 'ecs', registry: 'dockerhub' }).notes.some((n) => /own registry/.test(n)));
  assert.throws(() => fresh({ stack: 'node', registry: 'nope' }), /invalid registry/);
});

test('hadolint, SBOM + provenance and cosign signing on GitHub', () => {
  const ci = stepsOf({ stack: 'node', lintDockerfile: true, sbom: true, sign: true }).ci;
  assert.match(ci, /lint-dockerfile:\n {4}runs-on: ubuntu-latest[\s\S]*hadolint\/hadolint-action@[0-9a-f]{40} # v3\.1\.0/);
  assert.match(ci, /failure-threshold: "error"/);
  assert.match(ci, /image:\n {4}needs: \[test, lint-dockerfile\]/);
  assert.match(ci, /sbom: "true"\n\s+provenance: "mode=max"/);
  assert.match(ci, /sigstore\/cosign-installer@[0-9a-f]{40} # v3/);
  assert.match(ci, /cosign sign --yes \\"\$IMAGE@\$DIGEST\\"/);
  assert.match(ci, /DIGEST: "\$\{\{ steps.build.outputs.digest \}\}"/);
  assert.match(ci, /image:[\s\S]*permissions:\n {6}contents: read\n {6}packages: write\n {6}id-token: write/);
  const fly = stepsOf({ stack: 'node', deploy: 'fly', lintDockerfile: true }).ci;
  assert.match(fly, /deploy:\n {4}needs: \[test, lint-dockerfile\]/);
  const noImage = fresh({ stack: 'node', deploy: 'fly', sbom: true, sign: true });
  assert.ok(noImage.notes.some((n) => /SBOM, provenance and image signing skipped/.test(n)));
});

test('GitLab: hadolint job and SAST template; SBOM and signing are dropped with a note', () => {
  const r = fresh({ stack: 'node', ci: 'gitlab', lintDockerfile: true, codeScan: true, sbom: true, sign: true });
  const gl = r.files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /^include:\n {2}- template: Security\/SAST\.gitlab-ci\.yml/);
  assert.match(gl, /lint-dockerfile:\n {2}stage: test\n {2}image: hadolint\/hadolint:v2\.15\.1-debian/);
  assert.match(gl, /hadolint --failure-threshold error Dockerfile/);
  assert.doesNotMatch(gl, /cosign|sbom/);
  assert.ok(r.notes.some((n) => /SBOM and provenance attestations is not supported by GitLab CI/.test(n)));
  assert.ok(r.notes.some((n) => /Image signing \(cosign\) is not supported by GitLab CI/.test(n)));
});

test('CodeQL workflow is its own file with the stack language', () => {
  const langs = { node: 'javascript-typescript', fastapi: 'python', java: 'java-kotlin', dotnet: 'csharp', go: 'go', rust: 'rust' };
  for (const [stack, language] of Object.entries(langs)) {
    const r = fresh({ stack, codeScan: true });
    const codeql = file(r, '.github/workflows/codeql.yml');
    assert.match(codeql, new RegExp(`languages: "${language}"`), stack);
    assert.match(codeql, /security-events: write/);
  }
  assert.match(file(fresh({ stack: 'go', codeScan: true }), '.github/workflows/codeql.yml'), /build-mode: "autobuild"/);
  assert.equal(file(fresh({ stack: 'node' }), '.github/workflows/codeql.yml'), undefined);
  assert.equal(file(fresh({ stack: 'node', codeScan: true, include: ['dockerfile'] }), '.github/workflows/codeql.yml'), undefined);
});

// ------------------------------------------------------------------------------- repository extras

test('extras are opt-in: dependabot, dev container, Makefile, editorconfig', () => {
  assert.ok(!fresh({ stack: 'go' }).files.some((f) => f.kind === 'repo'));
  const r = fresh({ stack: 'go', name: 'svc', extras: ['dependabot', 'devcontainer', 'makefile', 'editorconfig'] });
  assert.deepEqual(r.files.filter((f) => f.kind === 'repo').map((f) => f.path), ['.github/dependabot.yml', '.devcontainer/devcontainer.json', 'Makefile', '.editorconfig']);
  assert.match(file(r, '.github/dependabot.yml'), /package-ecosystem: gomod[\s\S]*package-ecosystem: docker[\s\S]*package-ecosystem: github-actions/);
  const devText = file(r, '.devcontainer/devcontainer.json');
  assert.match(devText, /\n {2}\/\/ docker-in-docker runs this container privileged[^\n]*\n {2}"features"/);
  assert.ok(r.notes.some((n) => /docker-in-docker, which runs it privileged/.test(n)));
  const dev = JSON.parse(devText.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(dev.image, 'mcr.microsoft.com/devcontainers/go:1-1.25');
  assert.deepEqual(dev.forwardPorts, [8080]);
  assert.match(file(r, 'Makefile'), /^up:\n\tdocker compose -f docker-compose\.yml up --build -d$/m);
  const java = fresh({ stack: 'java', tool: 'gradle', extras: ['dependabot'] });
  assert.match(file(java, '.github/dependabot.yml'), /package-ecosystem: gradle/);
  assert.throws(() => fresh({ stack: 'node', extras: ['nope'] }), /invalid extra file/);
});

test('extras: Renovate replaces Dependabot outside GitHub; the file group filter applies', () => {
  const r = fresh({ stack: 'node', ci: 'gitlab', extras: ['dependabot'] });
  assert.deepEqual(JSON.parse(file(r, 'renovate.json')).extends, ['config:recommended']);
  assert.ok(r.notes.some((n) => /Renovate/.test(n)));
  assert.equal(file(fresh({ stack: 'node', extras: ['makefile'], include: ['dockerfile'] }), 'Makefile'), undefined);
});

// ------------------------------------------------------------------------------------ PHP and Ruby

test('php: apache runs unprivileged on the chosen port, composer in a vendor stage', () => {
  const r = fresh({ stack: 'php', runtime: '8.3', healthcheck: '/up' });
  assert.equal(r.stack, 'php');
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM php:8\.3-apache AS runtime/);
  assert.match(df, /install-php-extensions opcache/);
  assert.match(df, /composer install --no-dev .*--ignore-platform-reqs/);
  assert.match(df, /s!\/var\/www\/html!\/var\/www\/html\/public!g/);
  assert.match(df, /Listen 8080/);
  assert.match(df, /USER 33:33/);
  assert.doesNotMatch(df, /--chown/);
  assert.match(df, /for d in storage bootstrap\/cache; do if \[ -d "\$d" \]; then chown -R www-data:www-data "\$d"; fi; done/);
  assert.match(df, /CMD curl -fsS -o \/dev\/null http:\/\/127\.0\.0\.1:8080\/up \|\| exit 1/);
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /shivammathur\/setup-php@[0-9a-f]{40} # v2/);
  assert.match(ci, /run: vendor\/bin\/phpunit/);
  assert.equal(r.ci.selected.join(), 'test');
  assert.match(file(fresh({ stack: 'php' }), 'Dockerfile'), /FROM php:8\.4-apache/);
  assert.ok(fresh({ stack: 'php', codeScan: true }).notes.some((n) => /CodeQL does not support php/.test(n)));
});

test('ruby: a Rails server with native gem libraries on request', () => {
  const r = fresh({ stack: 'ruby', packages: ['tzdata'], runtime: '3.3' });
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM ruby:3\.3-slim AS build/);
  assert.match(df, /apt-get install -y --no-install-recommends tzdata/);
  assert.match(df, /CMD \["bundle","exec","rails","server","-b","0.0.0.0","-p","3000"\]/);
  assert.match(df, /USER 10001:10001/);
  assert.match(df, /COPY --from=build \/app \.\/\nRUN mkdir -p tmp log storage && chown -R app:app tmp log storage\nUSER 10001:10001/);
  assert.match(df, /groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --create-home app/);
  assert.match(file(r, '.github/workflows/ci.yml'), /run: bin\/rails test|run: bundle exec rspec/);
  assert.match(file(fresh({ stack: 'ruby' }), 'Dockerfile'), /FROM ruby:3\.4-slim AS build/);
  const hc = fresh({ stack: 'ruby', healthcheck: '/up' });
  assert.ok(hc.notes.some((n) => /no curl or wget/.test(n)));
});

test('every registry can be chosen for the registry target, on both providers, with its secrets listed', () => {
  const expected = {
    dockerhub: [/DOCKERHUB_USERNAME/, /secrets DOCKERHUB_TOKEN; variables DOCKERHUB_USERNAME/],
    quay: [/quay\.io\/\$\{\{ vars\.QUAY_NAMESPACE \}\}\/app/, /secrets QUAY_PASSWORD; variables QUAY_USERNAME, QUAY_NAMESPACE/],
    custom: [/\$\{\{ vars\.REGISTRY_HOST \}\}\/\$\{\{ vars\.REGISTRY_NAMESPACE \}\}\/app/, /secrets REGISTRY_PASSWORD; variables REGISTRY_HOST, REGISTRY_NAMESPACE, REGISTRY_USERNAME/],
    gar: [/-docker\.pkg\.dev/, /variables GCP_PROJECT, GCP_REGION, GAR_REPO, GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_SERVICE_ACCOUNT\./],
    ecr: [/amazonaws\.com/, /variables AWS_REGION, AWS_ACCOUNT_ID, ECR_REPOSITORY, AWS_ROLE_ARN\./],
    acr: [/azurecr\.io\/app/, /variables ACR_NAME, AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID\./],
  };
  for (const [registry, [image, note]] of Object.entries(expected)) {
    const gh = fresh({ stack: 'node', registry });
    const ci = gh.files.find((f) => f.kind === 'ci').content;
    assert.match(ci, image, registry);
    assert.ok(gh.notes.some((n) => note.test(n)), `${registry} secrets note`);
    assert.doesNotMatch(ci, /ghcr\.io|packages: write/, registry);
    const gl = fresh({ stack: 'node', ci: 'gitlab', registry }).files.find((f) => f.kind === 'ci').content;
    assert.match(gl, /IMAGE_REPO: /, registry);
    assert.doesNotMatch(gl, /CI_REGISTRY/, registry);
  }
});

test('a cloud registry chosen for a generic target signs in with the matching cloud steps (OIDC included)', () => {
  const gar = fresh({ stack: 'node', registry: 'gar', permissions: ['id-token-write'] });
  const ci = gar.files.find((f) => f.kind === 'ci').content;
  assert.match(ci, /uses: google-github-actions\/auth@[0-9a-f]{40} # v2[\s\S]*workload_identity_provider/);
  assert.match(ci, /id-token: write/);
  assert.ok(gar.notes.some((n) => /GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_SERVICE_ACCOUNT/.test(n)));
  assert.match(fresh({ stack: 'node', registry: 'ecr' }).files.find((f) => f.kind === 'ci').content, /aws-actions\/configure-aws-credentials@[0-9a-f]{40} # v4[\s\S]*amazon-ecr-login@[0-9a-f]{40} # v2/);
  assert.match(fresh({ stack: 'node', registry: 'acr' }).files.find((f) => f.kind === 'ci').content, /azure\/login@[0-9a-f]{40} # v2[\s\S]*az acr login/);
});

test('registry choice: ssh needs a username/token registry; cloud and platform-built targets keep their own', () => {
  assert.throws(() => fresh({ stack: 'node', deploy: 'ssh', registry: 'ecr' }), /logs in to the registry from the server/);
  assert.match(fresh({ stack: 'node', deploy: 'ssh', registry: 'quay' }).files.find((f) => f.kind === 'ci').content, /REGISTRY: "quay\.io"/);
  assert.match(fresh({ stack: 'node', deploy: 'kubernetes', registry: 'custom' }).files.find((f) => f.kind === 'ci').content, /vars\.REGISTRY_HOST/);
  assert.ok(fresh({ stack: 'node', deploy: 'cloudrun', registry: 'quay' }).notes.some((n) => /pushes to its own registry \(Google Artifact Registry\)/.test(n)));
  assert.ok(fresh({ stack: 'node', deploy: 'fly', registry: 'quay' }).notes.some((n) => /builds the image on the platform itself/.test(n)));
  assert.ok(!fresh({ stack: 'node', deploy: 'cloudrun', registry: 'gar' }).notes.some((n) => /ignored/.test(n)));
});

// ------------------------------------------------------------------------------ more CI providers

const ciText = (opts) => fresh({ stack: 'node', registry: 'dockerhub', ...opts }).files.find((f) => f.kind === 'ci').content;

test('every CI provider renders, with its own file name', () => {
  const paths = { github: '.github/workflows/ci.yml', gitlab: '.gitlab-ci.yml', gitea: '.gitea/workflows/ci.yml', jenkins: 'Jenkinsfile', bitbucket: 'bitbucket-pipelines.yml', azure: 'azure-pipelines.yml', circleci: '.circleci/config.yml' };
  for (const [ci, path] of Object.entries(paths)) {
    const r = fresh({ stack: 'node', ci, registry: 'dockerhub', deploy: 'ssh' });
    const f = r.files.find((x) => x.kind === 'ci');
    assert.equal(f.path, path, ci);
    assert.match(f.content, /npm ci/, ci);
    assert.match(f.content, /DOCKERHUB|dockerhub|docker\.io/i, ci);
    assert.ok(f.blocks.length >= 3, ci);
  }
  assert.throws(() => fresh({ stack: 'node', ci: 'travis' }), /unknown --ci "travis"; choose github, gitlab, gitea, jenkins, bitbucket, azure, circleci or none/);
  assert.throws(() => fresh({ stack: 'node', ci: 'jenkins' , registry: 'builtin' }), /Jenkins has no built-in container registry/);
});

test('jenkins: docker agents, credentials for secrets, services on a network of the build, deploy rule', () => {
  const r = fresh({ stack: 'node', ci: 'jenkins', registry: 'dockerhub', deploy: 'ssh', deployOn: 'manual', testVersions: ['20', '22'], ciServices: ['postgres'], schedule: '0 3 * * 1', timeout: 20, runner: 'linux' });
  const j = r.files.find((f) => f.kind === 'ci').content;
  assert.match(j, /cron\('0 3 \* \* 1'\)/);
  assert.match(j, /timeout\(time: 20, unit: 'MINUTES'\)/);
  assert.match(j, /stage\('Test 20'\)[\s\S]*docker\.image\('node:20'\)\.inside\("--network dockcrate-\$\{env\.BUILD_TAG\}"\)/);
  assert.doesNotMatch(j, /--network host/);
  assert.match(j, /docker network create "dockcrate-\$BUILD_TAG"/);
  assert.match(j, /DATABASE_URL = 'postgres:\/\/app:ci-test-only@postgres:5432\/app'/);
  assert.match(j, /docker network rm "dockcrate-\$BUILD_TAG"/);
  assert.match(fresh({ stack: 'node', ci: 'jenkins' }).files.find((f) => f.kind === 'ci').content, /docker\.image\('node:24'\)\.inside \{/);
  assert.ok(r.notes.some((n) => /dedicated agent/.test(n) && /Docker socket/.test(n)));
  assert.match(j, /stage\('Test 22'\)/);
  assert.match(j, /docker run -d --name "dockcrate-\$BUILD_TAG-postgres" --network "dockcrate-\$BUILD_TAG" --network-alias postgres/);
  assert.match(j, /DOCKERHUB_TOKEN = credentials\('DOCKERHUB_TOKEN'\)/);
  assert.match(j, /when \{ beforeAgent true; not \{ changeRequest\(\) \} \}/);
  assert.match(j, /agent \{\n {8}docker \{ image 'docker:27-cli'; label 'linux'/);
  assert.match(j, /stage\('Deploy'\)[\s\S]*input \{ message 'Deploy to production\?' \}/);
  assert.ok(r.notes.some((n) => /multibranch/.test(n)));
});

test('bitbucket: reusable steps, triggers become pipeline sections, deploy is one heredoc command', () => {
  const b = ciText({ ci: 'bitbucket', deploy: 'ssh', manual: true, tags: ['v*'], pullRequests: true, testVersions: ['20', '22'] });
  assert.match(b, /^pipelines:\n {2}pull-requests:\n {4}'\*\*':/m);
  assert.match(b, /\n {2}branches:\n {4}"main":\n {6}- parallel:\n {10}- step: \*test-20/);
  assert.match(b, /\n {2}tags:\n {4}"v\*":/);
  assert.match(b, /\n {2}custom:\n {4}manual:/);
  assert.match(b, /- \|\n {12}cat > \.dockcrate-deploy\.sh <<'DOCKCRATE_DEPLOY'/);
  const noPr = ciText({ ci: 'bitbucket', pullRequests: false, tags: [] });
  assert.doesNotMatch(noPr, /pull-requests:|\n {2}tags:/);
});

test('azure: triggers, PR switch, schedule, matrix, tool tasks and secret mapping', () => {
  const a = ciText({ ci: 'azure', deploy: 'ssh', testVersions: ['20'], schedule: '0 3 * * 1', pullRequests: false, branchesIgnore: ['wip/*'], paths: ['src/*'] });
  assert.match(a, /^trigger:\n {2}branches:\n {4}include: \["main"\]\n {4}exclude: \["wip\/\*"\]/m);
  assert.match(a, /\n {2}paths:\n {4}include: \["src\/\*"\]/);
  assert.match(a, /^pr: none$/m);
  assert.match(a, /schedules:\n {2}- cron: "0 3 \* \* 1"/);
  assert.match(a, /task: NodeTool@0\n {8}inputs:\n {10}versionSpec: "\$\(VERSION\)"/);
  assert.match(a, /VERSION: '20'/);
  assert.match(a, /BUILD_SOURCEVERSION/);
  assert.match(a, /env:\n {16}SSH_PRIVATE_KEY: "\$\(SSH_PRIVATE_KEY\)"/);
});

test('circleci: filters follow the trigger options; manual deploy waits for approval', () => {
  const c = ciText({ ci: 'circleci', deploy: 'ssh', deployOn: 'manual', tags: [], testVersions: ['20', '22'] });
  assert.match(c, /test:\n {10}matrix:\n {12}parameters:\n {14}version: \["20","22"\]/);
  assert.match(c, /- hold-deploy:\n {10}type: approval/);
  assert.match(c, /tags:\n {14}ignore: \/\.\*\//);
  const tag = ciText({ ci: 'circleci', deploy: 'ssh', deployOn: 'tag' });
  assert.match(tag, /- deploy:\n {10}requires: \["image"\]\n {10}filters:\n {12}branches:\n {14}ignore: \/\.\*\/\n {12}tags:\n {14}only: \["\/\^v\.\*\$\/"\]/);
});

test('gitea reuses the GitHub Actions renderer under .gitea/workflows and reports what it lacks', () => {
  const r = fresh({ stack: 'node', ci: 'gitea', registry: 'dockerhub', permissions: ['contents-write'], sbom: true });
  assert.match(r.files.find((f) => f.kind === 'ci').content, /runs-on: ubuntu-latest/);
  assert.ok(r.notes.some((n) => /Token permissions is not supported by Gitea/.test(n)));
  assert.ok(r.notes.some((n) => /SBOM and provenance attestations is not supported by Gitea/.test(n)));
});

// --------------------------------------------------------------- explicit triggers and pipeline options

test('triggers are exactly what you ask for: pull requests, tags, branches, paths, release, schedules', () => {
  const none = ciText({ ci: 'github', pullRequests: false, tags: [], branches: ['main', 'dev'] });
  assert.doesNotMatch(none, /pull_request:/);
  assert.match(none, /on:\n {2}push:\n {4}branches: \["main","dev"\]\n\n/);
  const rich = ciText({ ci: 'github', branches: ['main'], branchesIgnore: ['wip/**'], tags: ['v*'], tagsIgnore: ['v*-rc*'], paths: ['src/**'], pathsIgnore: ['**.md'], prBranches: ['main'], release: true, manual: true, schedule: ['0 3 * * 1', '0 5 * * *'] });
  assert.match(rich, /branches: \["main","!wip\/\*\*"\]/);
  assert.match(rich, /tags: \["v\*","!v\*-rc\*"\]/);
  assert.match(rich, /paths: \["src\/\*\*","!\*\*\.md"\]/);
  assert.match(rich, /pull_request:\n {4}branches: \["main"\]/);
  assert.match(rich, /release:\n {4}types: \[published\]/);
  assert.match(rich, /- cron: "0 3 \* \* 1"\n {4}- cron: "0 5 \* \* \*"/);
  assert.throws(() => ciText({ pullRequests: false, tags: [], branches: [], manual: false }), /at least one pipeline trigger/);
  assert.throws(() => ciText({ schedule: 'every day' }), /invalid schedule/);
});

test('pipeline options: name, runner, timeout, env, token permissions, fail-fast, image tags, caches, severities', () => {
  const t = ciText({
    ci: 'github', pipelineName: 'Build and ship', runner: 'self-hosted', timeout: 30, pipelineEnv: ['LOG=debug', 'TZ=UTC'], failFast: true,
    testVersions: ['20', '22'], imageTags: ['semver', 'latest'], depCache: false, layerCache: false, scan: true, scanSeverity: ['MEDIUM', 'HIGH', 'CRITICAL'],
    permissions: ['contents-write', 'issues-read', 'checks-write'],
  });
  assert.match(t, /^name: Build and ship$/m);
  assert.match(t, /runs-on: self-hosted/);
  assert.match(t, /timeout-minutes: 30/);
  assert.match(t, /\nenv:\n {2}LOG: "debug"\n {2}TZ: "UTC"/);
  assert.match(t, /fail-fast: true/);
  assert.match(t, /type=semver,pattern=\{\{version\}\}/);
  assert.doesNotMatch(t, /type=ref,event=branch/);
  assert.doesNotMatch(t, /cache-from|cache: /);
  assert.match(t, /severity: "MEDIUM,HIGH,CRITICAL"/);
  assert.match(t, /\npermissions:\n {2}contents: read\n\n/);
  assert.match(t, /\n {2}image:[\s\S]*permissions:\n {6}contents: write\n {6}issues: read\n {6}checks: write\n {4}outputs:/);
  assert.throws(() => ciText({ imageTags: ['nope'] }), /invalid image tag/);
  assert.throws(() => ciText({ timeout: 5000 }), /invalid timeout/);
  assert.throws(() => ciText({ pipelineEnv: ['bad'] }), /invalid pipeline variable/);
  const noTest = ciText({ ci: 'github', testJob: false, deploy: 'ssh' });
  assert.doesNotMatch(noTest, /\n {2}test:/);
  assert.doesNotMatch(noTest, /needs: test/);
});

// ------------------------------------------------------------------------------ editing blocks

test('every file is blocks with stable ids; disabling or rewriting one changes only that block', () => {
  const base = fresh({ stack: 'node', ci: 'github', registry: 'dockerhub' });
  const ci = base.files.find((f) => f.kind === 'ci');
  const ids = ci.blocks.map((b) => b.id);
  assert.ok(ids.includes('on') && ids.includes('test.setup-node') && ids.includes('image.build-push'));
  const path = ci.path;
  const edited = fresh({
    stack: 'node', ci: 'github', registry: 'dockerhub',
    edits: { [path]: { blocks: { 'test.setup-node': { disabled: true }, name: { text: 'name: My pipeline' } }, add: [{ id: 'mine', after: 'test.npm-ci', title: 'Smoke test', text: '      - run: npm run smoke' }] } },
  }).files.find((f) => f.kind === 'ci');
  assert.match(edited.content, /^name: My pipeline$/m);
  assert.doesNotMatch(edited.content, /setup-node/);
  assert.match(edited.content, /- run: npm ci\n {6}- run: npm run smoke\n/);
  const status = Object.fromEntries(edited.blocks.map((b) => [b.id, b]));
  assert.equal(status.name.edited, true);
  assert.equal(status['test.setup-node'].disabled, true);
  assert.equal(status.mine.custom, true);
  assert.equal(edited.content.split('\n').length, base.files.find((f) => f.kind === 'ci').content.split('\n').length - 4 + 1);
});

test('edits: Dockerfile stages and .dockerignore lines are blocks too; stale and unknown edits are reported', () => {
  const r = fresh({ stack: 'node', edits: { Dockerfile: { blocks: { 'stage:runtime': { text: 'FROM base AS runtime\nUSER root' }, 'stage:nope': { text: 'x' } } }, '.dockerignore': { blocks: {} } } });
  assert.match(file(r, 'Dockerfile'), /FROM base AS runtime\nUSER root\n/);
  assert.ok(r.notes.some((n) => /block "stage:nope" in Dockerfile no longer matches/.test(n)));
  const di = r.files.find((f) => f.path === '.dockerignore');
  assert.ok(di.blocks.length > 5 && di.blocks.every((b) => !b.text.includes('\n')));
  const stale = fresh({ stack: 'node', edits: { Dockerfile: { blocks: { 'stage:runtime': { text: 'FROM x', from: 'old text' } } } } });
  assert.equal(stale.files.find((f) => f.path === 'Dockerfile').blocks.find((b) => b.id === 'stage:runtime').stale, true);
});

test('edits can disable a whole file and add a new one; paths are validated', () => {
  const r = fresh({ stack: 'node', edits: { '.dockerignore': { disabled: true }, 'scripts/release.sh': { add: [{ id: 'a', text: '#!/bin/sh\necho hi' }] } } });
  assert.ok(!r.files.some((f) => f.path === '.dockerignore'));
  const custom = r.files.find((f) => f.path === 'scripts/release.sh');
  assert.equal(custom.kind, 'custom');
  assert.equal(custom.content, '#!/bin/sh\necho hi\n');
  assert.throws(() => fresh({ stack: 'node', edits: { '../evil': { add: [{ id: 'a', text: 'x' }] } } }), /invalid custom file path/);
  assert.throws(() => fresh({ stack: 'node', edits: { '/etc/passwd': { add: [{ id: 'a', text: 'x' }] } } }), /invalid custom file path/);
  assert.throws(() => fresh({ stack: 'node', edits: { '.git/hooks/pre-commit': { add: [{ id: 'a', text: 'x' }] } } }), /invalid custom file path/);
  assert.throws(() => fresh({ stack: 'node', edits: [] }), /edits must be an object/);
});

// ---- supply chain: pinned actions, safe Trivy versions
const everything = (extra = {}) =>
  generate(null, {
    stack: 'node', ci: 'github', deploy: 'kubernetes', scan: true, lintDockerfile: true, sbom: true, sign: true,
    codeScan: true, platforms: ['linux/amd64', 'linux/arm64'], ...extra,
  }).files.filter((f) => f.kind === 'ci');
const usesOf = (files) => files.flatMap((f) => [...f.content.matchAll(/^\s*(?:- )?uses: (\S+)(.*)$/gm)].map((m) => ({ ref: m[1], comment: m[2].trim() })));

test('GitHub actions are pinned to full commit SHAs with the tag as a comment, by default', () => {
  const uses = usesOf(everything());
  assert.ok(uses.length > 8);
  for (const { ref, comment } of uses) {
    assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is not pinned`);
    assert.match(comment, /^# \S+$/);
  }
});

test('--no-pin-actions keeps tags; Gitea pins like GitHub', () => {
  const tags = usesOf(everything({ pinActions: false }));
  assert.ok(tags.every(({ ref }) => /@[\w.]+$/.test(ref) && !/@[0-9a-f]{40}$/.test(ref)));
  const gitea = usesOf(everything({ ci: 'gitea', sbom: false, sign: false, codeScan: false }));
  assert.ok(gitea.length > 0 && gitea.every(({ ref }) => /@[0-9a-f]{40}$/.test(ref)));
  assert.ok(usesOf(everything({ ci: 'gitea', pinActions: false })).every(({ ref }) => !/@[0-9a-f]{40}$/.test(ref)));
});

test('every action any stack, target or option emits on GitHub and Gitea is pinned to a full commit SHA', () => {
  const stacks = ['node', 'react', 'fastapi', 'django', 'go', 'rust', 'java', 'dotnet', 'php', 'ruby'];
  const deploys = ['registry', 'ssh', 'kubernetes', 'cloudrun', 'ecs', 'azure', 'fly'];
  const seen = new Set();
  for (const ci of ['github', 'gitea']) {
    for (const stack of stacks) {
      for (const deploy of deploys) {
        const files = generate(null, {
          stack, ci, deploy, scan: true, lintDockerfile: true, sbom: true, sign: true, codeScan: true, platforms: ['linux/amd64', 'linux/arm64'],
          ciSteps: undefined, manual: true, changedOnly: false,
        }).files.filter((f) => f.kind === 'ci');
        for (const { ref, comment } of usesOf(files)) {
          seen.add(ref.replace(/@.*/, ''));
          assert.match(ref, /@[0-9a-f]{40}$/, `${ci} ${stack} ${deploy}: ${ref} is not pinned`);
          assert.match(comment, /^# \S+$/);
        }
      }
    }
  }
  assert.ok(seen.has('superfly/flyctl-actions/setup-flyctl') && seen.has('dtolnay/rust-toolchain') && seen.has('aquasecurity/trivy-action'));
});

test('GitHub builds and scans the image before it pushes and signs it; a multi-platform build scans one platform', () => {
  const { text } = ciOf({ scan: true, sign: true, sbom: true, platforms: ['linux/amd64', 'linux/arm64'] });
  const at = (re) => text.search(re);
  const load = at(/load: "true"/);
  const scan = at(/uses: aquasecurity\/trivy-action/);
  const push = at(/push: "true"/);
  const sign = at(/cosign sign --yes/);
  assert.ok(load > 0 && load < scan && scan < push && push < sign, 'build+load, scan, push, sign');
  assert.match(text, /load: "true"\n {10}push: "false"\n {10}provenance: "false"/);
  assert.match(text.slice(load - 200, load), /platforms: "linux\/amd64"\n/);
  assert.match(text.slice(scan, push + 400), /platforms: "linux\/amd64,linux\/arm64"/);
  // Pull requests build and scan, but nothing is pushed or signed for them.
  assert.match(text.slice(scan, push), /id: build\n {8}if: "github.event_name != 'pull_request'"/);
  assert.doesNotMatch(text.slice(load - 300, scan), /if: "github.event_name != 'pull_request'"/);
  // Without a scan the single build pushes outside pull requests, as before.
  const plain = ciOf({}).text;
  assert.doesNotMatch(plain, /load: "true"/);
  assert.match(plain, /push: "\$\{\{ github.event_name != 'pull_request' \}\}"/);
});

test('pipeline variables reach the shell literally on Bitbucket and CircleCI: no $(...), $VAR or backticks expand', async () => {
  const { spawnSync } = await import('node:child_process');
  const value = 'a $(id) $HOME `uname` \'single\' "double" \\ end';
  for (const ci of ['bitbucket', 'circleci']) {
    const text = fresh({ stack: 'node', ci, pipelineEnv: [`TRICKY=${value}`] }).files.find((f) => f.kind === 'ci').content;
    const line = text.split('\n').map((l) => l.trim().replace(/^- /, '')).find((l) => /^"?export TRICKY=/.test(l));
    assert.ok(line, ci);
    const command = line.startsWith('"') ? JSON.parse(line) : line;
    assert.match(command, /^export TRICKY='/, ci);
    const out = spawnSync('sh', ['-c', `${command}; printf '%s' "$TRICKY"`], { encoding: 'utf8' });
    assert.equal(out.stdout, value, ci);
  }
});

test('Trivy is never emitted at a version from the March 2026 compromise (trivy-action 0.0.1-0.34.2, image 0.69.4+, latest)', () => {
  const text = [
    ...everything().map((f) => f.content),
    ...everything({ pinActions: false }).map((f) => f.content),
    generate(null, { stack: 'node', ci: 'gitlab', scan: true }).files.find((f) => f.kind === 'ci').content,
    generate(null, { stack: 'node', extras: ['makefile'] }).files.find((f) => f.path === 'Makefile').content,
  ].join('\n');
  assert.doesNotMatch(text, /trivy-action@0\.28/);
  assert.doesNotMatch(text, /aquasec\/trivy(:latest)?\s/);
  assert.match(text, /trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1 # 0\.35\.0/);
  assert.match(text, /trivy-action@0\.35\.0/);
  assert.match(text, /aquasec\/trivy:0\.69\.3/);
});

// ---- Kubernetes

test('kubernetes manifests: hardened containers, optional env Secret, probes follow the health path', () => {
  const plain = file(fresh({ stack: 'node', name: 'Shop', deploy: 'kubernetes' }), 'k8s/deployment.yaml');
  assert.match(plain, /allowPrivilegeEscalation: false/);
  assert.match(plain, /drop: \[ALL\]/);
  assert.match(plain, /seccompProfile:\n {10}type: RuntimeDefault/);
  assert.match(plain, /automountServiceAccountToken: false/);
  assert.match(plain, /envFrom:\n {12}- secretRef:\n {16}name: shop-env\n {16}optional: true/);
  assert.match(plain, /readinessProbe:\n {12}tcpSocket:/);
  const http = file(fresh({ stack: 'node', name: 'Shop', deploy: 'kubernetes', healthcheck: '/health' }), 'k8s/deployment.yaml');
  assert.match(http, /readinessProbe:\n {12}httpGet:\n {14}path: \/health\n {14}port: 3000/);
  assert.match(http, /livenessProbe:\n {12}httpGet:\n {14}path: \/health/);
});

test('kubernetes with compose services warns that the services are not deployed', () => {
  const r = fresh({ stack: 'node', name: 'Shop', deploy: 'kubernetes', db: ['postgres', 'redis'] });
  assert.ok(r.notes.some((n) => /postgres, redis/.test(n) && /shop-env/.test(n)));
  assert.ok(!fresh({ stack: 'node', deploy: 'kubernetes' }).notes.some((n) => /compose services/.test(n)));
});

// ---- no movable references to third-party tools

/** Splits a shell command line into words, keeping quoted parts together. */
const words = (line) => [...line.matchAll(/"[^"]*"|'[^']*'|\S+/g)].map((m) => m[0]);
/** The image a `docker run ...` line runs: the first word after the options. */
function dockerRunImage(line) {
  const ws = words(line.slice(line.indexOf('docker run ') + 'docker run '.length));
  for (let i = 0; i < ws.length; i += 1) {
    const w = ws[i];
    if (['--rm', '-i', '-d', '-t', '-it'].includes(w)) continue;
    if (w.startsWith('-')) {
      if (!w.includes('=')) i += 1;
      continue;
    }
    return w;
  }
  return null;
}

/** Every image or tool reference a generated file names, with what it is. */
function references(content) {
  const stages = new Set([...content.matchAll(/ AS (\w+)/g)].map((m) => m[1]));
  const refs = [
    ...[...content.matchAll(/^[ \t]*(?:- )?image:[ \t]+['"]?([^\s'"{}]+)/gm)].map((m) => m[1]),
    ...[...content.matchAll(/image:\n\s+name:\s+(\S+)/g)].map((m) => m[1]),
    ...[...content.matchAll(/^FROM[ \t]+(\S+)/gm)].map((m) => m[1]),
    ...[...content.matchAll(/--from=(\S+)/g)].map((m) => m[1]),
    ...[...content.matchAll(/docker\.image\('([^']+)'\)|docker \{ image '([^']+)'/g)].map((m) => m[1] ?? m[2]),
    ...content.split('\n').filter((l) => /docker run /.test(l)).map(dockerRunImage),
    ...[...content.matchAll(/^\s*"image":\s*"([^"]+)"/gm)].map((m) => m[1]),
  ];
  return refs.filter((r) => r && !stages.has(r) && !/^(IMAGE_PLACEHOLDER|\$|<<)/.test(r) && !r.includes('$'));
}

test('no generated file names a tool by a movable reference (latest, a branch, or no tag at all)', () => {
  const outputs = [];
  const stacks = ['node', 'react', 'fastapi', 'django', 'go', 'rust', 'java', 'dotnet', 'php', 'ruby'];
  const providers = ['github', 'gitlab', 'gitea', 'jenkins', 'bitbucket', 'azure', 'circleci'];
  const deploys = ['registry', 'ssh', 'kubernetes', 'cloudrun', 'ecs', 'azure', 'fly'];
  for (const ci of providers) {
    for (const deploy of deploys) {
      for (const stack of stacks) {
        for (const extra of [{}, { multistage: false }, { multistage: false, stageMode: 'mixed' }, { imageVariant: 'slim' }, { imageVariant: 'alpine' }]) {
          const registry = ['github', 'gitlab'].includes(ci) || ['cloudrun', 'ecs', 'azure', 'fly'].includes(deploy) ? undefined : 'dockerhub';
          const r = generate(null, {
            stack, ci, deploy, registry, scan: true, lintDockerfile: true, codeScan: true, envs: ['dev'], ciServices: ci === 'circleci' ? [] : ['postgres'],
            extras: ['makefile', 'devcontainer', 'dependabot'], ciSteps: undefined, tool: undefined, ...extra,
          });
          outputs.push(...r.files);
        }
      }
    }
    const several = generate(null, { ci, deploy: 'ssh', registry: ['github', 'gitlab'].includes(ci) ? undefined : 'dockerhub', changedOnly: true, services: [{ name: 'api', dir: 'api', stack: 'fastapi', tool: 'uv', ciSteps: ['lint', 'test', 'audit'] }, { name: 'svc', dir: 'svc', stack: 'go', ciSteps: ['audit'] }] });
    outputs.push(...several.files);
  }
  outputs.push(...generate(null, { stack: 'php', ci: 'none' }).files, ...generate(null, { stack: 'fastapi', tool: 'uv', ci: 'none', envs: ['dev'] }).files);
  const text = outputs.map((f) => f.content).join('\n');
  // The project's own image may carry a `latest` tag (an option); nothing third-party may.
  assert.doesNotMatch(text.replace(/"\$IMAGE_REPO:latest"/g, ''), /:latest\b/);
  assert.doesNotMatch(text, /@(latest|master|main)\b/);
  const checked = new Set();
  for (const f of outputs) {
    for (const ref of references(f.content)) {
      checked.add(ref);
      const name = ref.replace(/@sha256:[0-9a-f]+$/, '');
      const tag = name.includes(':') && name.lastIndexOf(':') > name.lastIndexOf('/') ? name.slice(name.lastIndexOf(':') + 1) : null;
      assert.ok(tag || ref.includes('@sha256:'), `${f.path}: ${ref} has no tag`);
      assert.ok(!['latest', 'stable', 'current', 'edge', 'master', 'main', 'alpine', 'slim', 'bookworm'].includes(tag), `${f.path}: ${ref} is a movable tag`);
    }
  }
  for (const tool of ['hadolint/hadolint:v2.15.1-debian', 'amazon/aws-cli:2.38.1', 'mcr.microsoft.com/azure-cli:2.91.0', 'flyio/flyctl:v0.4.118', 'google/cloud-sdk:589.0.0-slim', 'alpine:3.24', 'ghcr.io/astral-sh/uv:0.13.1', 'ghcr.io/mlocati/php-extension-installer:2.12.1', 'aquasec/trivy:0.69.3', 'nginxinc/nginx-unprivileged:1.30-alpine', 'cimg/base:2026.10', 'ubuntu-2204:2026.05.1']) {
    assert.ok(checked.has(tool), `${tool} is among the checked references`);
  }
  assert.match(text, /go install golang\.org\/x\/vuln\/cmd\/govulncheck@v\d+\.\d+\.\d+/);
  assert.match(text, /setup-flyctl@[0-9a-f]{40} # 1\.5\n {8}with:\n {10}version: "0\.4\.118"/);
});

test('kubernetes and ECS run the image as its numeric non-root user; k8s with a read-only root and emptyDirs where it writes', () => {
  const k8s = (opts) => generate(null, { deploy: 'kubernetes', ...opts }).files.find((f) => f.path === 'k8s/deployment.yaml').content;
  const node = k8s({ stack: 'node' });
  assert.match(node, /securityContext:\n {8}runAsNonRoot: true\n {8}runAsUser: 1000\n {8}runAsGroup: 1000\n {8}seccompProfile:/);
  assert.match(node, /allowPrivilegeEscalation: false\n {12}readOnlyRootFilesystem: true/);
  assert.match(node, /volumeMounts:\n {12}- name: tmp\n {14}mountPath: \/tmp\n {12}- name: home-node\n {14}mountPath: \/home\/node\n {12}- name: app-next-cache\n {14}mountPath: \/app\/\.next\/cache/);
  assert.match(node, /\n {6}volumes:\n {8}- name: tmp\n {10}emptyDir: \{\}/);
  assert.match(k8s({ stack: 'go' }), /runAsUser: 10001\n {8}runAsGroup: 10001/);
  assert.match(k8s({ stack: 'react' }), /runAsUser: 101/);
  assert.match(k8s({ stack: 'react', multistage: false, stageMode: 'mixed' }), /runAsUser: 1000\n/);
  assert.match(k8s({ stack: 'dotnet' }), /runAsUser: 1654/);
  assert.match(k8s({ stack: 'ruby' }), /mountPath: \/app\/tmp[\s\S]*mountPath: \/app\/log[\s\S]*mountPath: \/app\/storage/);
  const php = k8s({ stack: 'php' });
  assert.match(php, /runAsUser: 33/);
  assert.match(php, /# readOnlyRootFilesystem is off: [^\n]*storage\/ and bootstrap\/cache[^\n]*\n {12}readOnlyRootFilesystem: false/);
  const ecs = (stack) => JSON.parse(generate(null, { stack, deploy: 'ecs' }).files.find((f) => f.path === 'ecs/task-definition.json').content).containerDefinitions[0];
  assert.equal(ecs('fastapi').user, '10001:10001');
  assert.equal(ecs('node').user, '1000:1000');
  assert.equal(ecs('fastapi').readonlyRootFilesystem, undefined);
  assert.ok(generate(null, { stack: 'node', deploy: 'ecs' }).notes.some((n) => /readonlyRootFilesystem is left off/.test(n)));
  // Several services: each manifest follows its own stack.
  const multi = generate(null, { deploy: 'kubernetes', services: [{ name: 'api', dir: 'api', stack: 'go' }, { name: 'web', dir: 'web', stack: 'react' }] });
  assert.match(multi.files.find((f) => f.path === 'k8s/api/deployment.yaml').content, /runAsUser: 10001/);
  assert.match(multi.files.find((f) => f.path === 'k8s/web/deployment.yaml').content, /runAsUser: 101/);
});

test('the SSH deploy logs out of the registry on the server after the pull, and on failure', () => {
  const text = ciOf({ deploy: 'ssh' }).text;
  assert.match(text, /ssh "\$REMOTE" "trap 'docker logout \$REGISTRY >\/dev\/null' EXIT; docker login \$REGISTRY -u \$REGISTRY_USER --password-stdin && cd \$DEPLOY_PATH && APP_IMAGE=\$IMAGE docker compose pull && docker logout \$REGISTRY && APP_IMAGE=\$IMAGE docker compose up -d --remove-orphans"/);
  for (const ci of ['gitlab', 'jenkins', 'bitbucket', 'azure', 'circleci']) {
    const out = fresh({ stack: 'node', ci, deploy: 'ssh', registry: ci === 'gitlab' ? undefined : 'dockerhub' }).files.find((f) => f.kind === 'ci').content;
    assert.match(out, /docker compose pull && docker logout \$REGISTRY && /, ci);
  }
});

test('setup notes say where deploy secrets belong on each provider, and how to scope the kubeconfig', () => {
  const where = {
    github: /environment secrets of production[\s\S]*required reviewers/,
    gitea: /no protected environments/,
    gitlab: /Protected and Masked[\s\S]*environment scope to production/,
    bitbucket: /secured deployment variables of production/,
    azure: /variable group[\s\S]*approvals and checks to the production environment/,
    jenkins: /credentials of this job's folder/,
    circleci: /restricted context/,
  };
  for (const [ci, re] of Object.entries(where)) {
    const r = fresh({ stack: 'node', ci, deploy: 'kubernetes', registry: ['github', 'gitlab'].includes(ci) ? undefined : 'dockerhub' });
    assert.ok(r.notes.some((n) => n.includes('KUBE_CONFIG') && re.test(n)), ci);
  }
  const k8s = fresh({ stack: 'node', deploy: 'kubernetes' }).notes.find((n) => n.startsWith('Kubernetes:'));
  assert.match(k8s, /ServiceAccount in the target namespace/);
  assert.match(k8s, /Do not use your own ~\/\.kube\/config/);
  // Cloud targets also sign in from the image job, so their keys are not deploy-only.
  assert.ok(!fresh({ stack: 'node', deploy: 'cloudrun', cloudAuth: 'keys' }).notes.some((n) => /environment secrets of/.test(n)));
});
