import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generate, writeFiles } from '../src/generate.js';

/** Creates a temp project dir from { 'relative/path': content }; objects are written as JSON. */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'shipkit-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const file = (result, path) => result.files.find((f) => f.path === path)?.content;

test('express app: multi-stage node image, runs start script as non-root', () => {
  const dir = project({
    'package.json': { dependencies: { express: '4' }, scripts: { start: 'node server.js', test: 'jest' }, engines: { node: '>=20' } },
    'package-lock.json': '{}',
  });
  const r = generate(dir);
  assert.equal(r.stack, 'node');
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM node:20-alpine AS base/);
  assert.match(df, /RUN npm ci --omit=dev/);
  assert.match(df, /USER node/);
  assert.match(df, /CMD \["npm","start"\]/);
  assert.doesNotMatch(df, /npm run build/);
  assert.match(file(r, '.github/workflows/ci.yml'), /cache: "npm"/);
  assert.match(file(r, '.github/workflows/ci.yml'), /run: npm test/);
});

test('pnpm project enables corepack and uses a frozen lockfile', () => {
  const dir = project({ 'package.json': { dependencies: { fastify: '5' }, scripts: { build: 'tsc', start: 'node dist/index.js' } }, 'pnpm-lock.yaml': '' });
  const r = generate(dir);
  assert.match(file(r, 'Dockerfile'), /RUN corepack enable/);
  assert.match(file(r, 'Dockerfile'), /pnpm install --frozen-lockfile --prod/);
  assert.match(file(r, 'Dockerfile'), /RUN pnpm run build/);
  assert.match(file(generate(dir, { ci: 'gitlab' }), '.gitlab-ci.yml'), /corepack enable/);
});

test('react + vite serves dist through nginx with SPA fallback; --db is ignored', () => {
  const dir = project({ 'package.json': { dependencies: { react: '19' }, devDependencies: { vite: '7' }, scripts: { build: 'vite build' } }, 'package-lock.json': '{}' });
  const r = generate(dir, { db: ['postgres'] });
  assert.equal(r.stack, 'react');
  assert.match(file(r, 'Dockerfile'), /COPY --from=build \/app\/dist\/ \/usr\/share\/nginx\/html\//);
  assert.match(file(r, 'nginx.conf'), /try_files \$uri \$uri\/ \/index.html/);
  assert.doesNotMatch(file(r, 'docker-compose.yml'), /postgres/);
  assert.ok(r.notes.some((n) => n.includes('Ignoring --db')));
});

test('create-react-app builds into build/', () => {
  const dir = project({ 'package.json': { dependencies: { react: '18', 'react-scripts': '5' }, scripts: { build: 'react-scripts build' } } });
  assert.match(file(generate(dir), 'Dockerfile'), /\/app\/build\//);
});

test('next.js is treated as a node server, not a static react site', () => {
  const dir = project({ 'package.json': { dependencies: { react: '19', next: '15' }, scripts: { build: 'next build', start: 'next start' } } });
  assert.equal(generate(dir).stack, 'node');
});

test('vue', () => {
  const dir = project({ 'package.json': { dependencies: { vue: '3' }, scripts: { build: 'vite build' } } });
  assert.equal(generate(dir).stack, 'vue');
});

test('angular 17+ application builder outputs to dist/<name>/browser', () => {
  const dir = project({
    'package.json': { dependencies: { '@angular/core': '19' }, scripts: { build: 'ng build', test: 'ng test' } },
    'angular.json': { projects: { shop: { architect: { build: { builder: '@angular-devkit/build-angular:application' } } } } },
  });
  const r = generate(dir);
  assert.equal(r.stack, 'angular');
  assert.match(file(r, 'Dockerfile'), /\/app\/dist\/shop\/browser\//);
  assert.doesNotMatch(file(r, '.github/workflows/ci.yml'), /npm test/);
});

test('angular legacy builder uses outputPath as-is; --build-dir overrides', () => {
  const dir = project({
    'package.json': { dependencies: { '@angular/core': '15' }, scripts: { build: 'ng build' } },
    'angular.json': { projects: { app: { architect: { build: { builder: '@angular-devkit/build-angular:browser', options: { outputPath: 'dist/custom' } } } } } },
  });
  assert.match(file(generate(dir), 'Dockerfile'), /\/app\/dist\/custom\//);
  assert.match(file(generate(dir, { buildDir: './out/' }), 'Dockerfile'), /\/app\/out\//);
});

test('fastapi: finds the app object, pip install, uvicorn on the chosen port', () => {
  const dir = project({
    'requirements.txt': 'fastapi\nuvicorn[standard]\npytest\n',
    'app/main.py': 'from fastapi import FastAPI\napi = FastAPI()\n',
    '.python-version': '3.12.4\n',
  });
  const r = generate(dir, { port: 9000 });
  assert.equal(r.stack, 'fastapi');
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM python:3\.12-slim/);
  assert.match(df, /CMD \["uvicorn","app\.main:api","--host","0\.0\.0\.0","--port","9000"\]/);
  assert.match(file(r, '.github/workflows/ci.yml'), /python-version: "3\.12"/);
  assert.match(file(r, '.github/workflows/ci.yml'), /run: pytest/);
});

test('fastapi with uv', () => {
  const dir = project({ 'pyproject.toml': 'dependencies = ["fastapi[standard]"]', 'uv.lock': '', 'main.py': 'app = FastAPI()' });
  const r = generate(dir);
  assert.match(file(r, 'Dockerfile'), /uv sync --frozen --no-dev --no-install-project/);
  assert.match(file(r, 'Dockerfile'), /"main:app"/);
});

test('python project without a dependency manifest fails with a clear message', () => {
  const dir = project({ 'pyproject.toml': 'dependencies = ["fastapi"]' });
  assert.throws(() => generate(dir), /no requirements\.txt, uv\.lock or poetry\.lock/);
});

test('django beats a tooling package.json and finds the wsgi module', () => {
  const dir = project({
    'manage.py': '',
    'requirements.txt': 'Django==5.1\ngunicorn\n',
    'mysite/wsgi.py': '',
    'package.json': { devDependencies: { tailwindcss: '4' } },
  });
  const r = generate(dir);
  assert.equal(r.stack, 'django');
  assert.match(file(r, 'Dockerfile'), /"gunicorn","mysite\.wsgi:application","--bind","0\.0\.0\.0:8000"/);
  assert.match(file(r, '.github/workflows/ci.yml'), /python manage\.py test/);
});

test('dotnet web project: picks csproj, framework version and assembly name', () => {
  const dir = project({
    'src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>',
    'tests/Api.Tests/Api.Tests.csproj': '<Project Sdk="Microsoft.NET.Sdk"></Project>',
  });
  const r = generate(dir);
  const df = file(r, 'Dockerfile');
  assert.equal(r.stack, 'dotnet');
  assert.match(df, /sdk:8\.0 AS build/);
  assert.match(df, /dotnet publish "src\/Api\/Api\.csproj"/);
  assert.match(df, /ENTRYPOINT \["dotnet", "Api\.dll"\]/);
  assert.match(file(r, '.github/workflows/ci.yml'), /dotnet-version: "8\.0\.x"/);
});

test('spring boot maven', () => {
  const dir = project({ 'pom.xml': '<project><properties><java.version>17</java.version></properties><artifactId>spring-boot-starter</artifactId></project>' });
  const r = generate(dir);
  const df = file(r, 'Dockerfile');
  assert.equal(r.stack, 'java');
  assert.match(df, /FROM maven:3-eclipse-temurin-17 AS build/);
  assert.match(df, /FROM eclipse-temurin:17-jre/);
  assert.match(df, /find target .*-exec cp \{\} \/app\.jar \\;/);
  assert.match(file(r, '.github/workflows/ci.yml'), /mvn -B verify/);
});

test('spring boot gradle requires the wrapper', () => {
  const build = 'plugins { id "org.springframework.boot" version "3.3.0" }\njava { toolchain { languageVersion = JavaLanguageVersion.of(21) } }';
  assert.throws(() => generate(project({ 'build.gradle': build })), /gradlew/);
  const r = generate(project({ 'build.gradle': build, gradlew: '' }));
  assert.match(file(r, 'Dockerfile'), /sh \.\/gradlew --no-daemon bootJar/);
  assert.match(file(r, '.github/workflows/ci.yml'), /cache: "gradle"/);
});

test('compose wires databases with healthchecks, volumes and connection URLs', () => {
  const dir = project({ 'package.json': { scripts: { start: 'node .' } } });
  const r = generate(dir, { db: ['postgres', 'redis'], port: 4000 });
  const compose = file(r, 'docker-compose.yml');
  assert.match(compose, /- "4000:4000"/);
  assert.match(compose, /DATABASE_URL: "postgres:\/\/app:\$\{DB_PASSWORD:-app\}@postgres:5432\/app"/);
  assert.match(compose, /REDIS_URL: "redis:\/\/redis:6379"/);
  assert.match(compose, /postgres:\n {8}condition: service_healthy/);
  assert.match(compose, /volumes:\n {2}postgres-data:\n {2}redis-data:/);
  assert.match(file(r, '.env.example'), /DB_PASSWORD=/);
});

test('compose output reuses the project\'s existing compose file name', () => {
  const dir = project({ 'package.json': { scripts: { start: 'x' } }, 'compose.yaml': 'services: {}' });
  const names = generate(dir).files.map((f) => f.path);
  assert.ok(names.includes('compose.yaml'));
  assert.ok(!names.includes('docker-compose.yml'));
});

test('gitlab and no-ci variants', () => {
  const dir = project({ 'package.json': { scripts: { start: 'node .' } } });
  assert.match(file(generate(dir, { ci: 'gitlab' }), '.gitlab-ci.yml'), /image: node:24/);
  assert.equal(generate(dir, { ci: 'none' }).files.some((f) => /ci|workflows/.test(f.path)), false);
});

test('invalid options and undetectable projects are rejected', () => {
  const dir = project({ 'README.md': '' });
  assert.throws(() => generate(dir), /could not detect/);
  assert.throws(() => generate(dir, { stack: 'react' }), /no react project/);
  assert.throws(() => generate(dir, { stack: 'rails' }), /unknown stack/);
  assert.throws(() => generate(dir, { db: ['oracle'] }), /unknown database/);
  assert.throws(() => generate(dir, { db: ['postgres', 'mysql'] }), /pick one/);
  assert.throws(() => generate(dir, { port: 99999 }), /invalid --port/);
});

test('writeFiles keeps existing files unless forced', () => {
  const dir = project({ 'package.json': { scripts: { start: 'x' } }, Dockerfile: 'mine' });
  const { files } = generate(dir);
  const first = writeFiles(dir, files);
  assert.equal(first.find((f) => f.path === 'Dockerfile').status, 'skipped');
  assert.equal(readFileSync(join(dir, 'Dockerfile'), 'utf8'), 'mine');
  assert.ok(existsSync(join(dir, '.github/workflows/ci.yml')));
  writeFiles(dir, files, { force: true });
  assert.notEqual(readFileSync(join(dir, 'Dockerfile'), 'utf8'), 'mine');
});

// ---- new projects (no folder to read: the user picks stack and tools)

const fresh = (opts) => generate(null, { isNew: true, ...opts });

test('every stack can generate a new project with defaults', () => {
  for (const stack of ['node', 'react', 'vue', 'angular', 'fastapi', 'django', 'dotnet', 'java', 'go', 'rust', 'php', 'ruby']) {
    const r = fresh({ stack });
    assert.equal(r.stack, stack);
    assert.deepEqual(r.files.map((f) => f.kind).filter((k, i, a) => a.indexOf(k) === i), ['dockerfile', 'dockerignore', 'compose', 'ci']);
    assert.ok(r.notes.some((n) => n.startsWith('New project:')), stack);
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

test('new project does not read the folder, but reuses its compose file name', () => {
  assert.equal(generate('/definitely/not/here', { isNew: true, stack: 'vue' }).stack, 'vue');
  const dir = project({ 'compose.yml': '' });
  assert.ok(generate(dir, { isNew: true, stack: 'vue' }).files.some((f) => f.path === 'compose.yml'));
});

test('include selects file groups', () => {
  const r = fresh({ stack: 'react', include: ['dockerfile', 'ci'], db: ['redis'] });
  assert.deepEqual(r.files.map((f) => f.path), ['Dockerfile', 'nginx.conf', '.github/workflows/ci.yml']);
  const compose = fresh({ stack: 'node', include: ['compose'], db: ['postgres'] });
  assert.deepEqual(compose.files.map((f) => f.path), ['docker-compose.yml', '.env.example']);
  const dir = project({ 'package.json': { scripts: { start: 'x' } } });
  assert.deepEqual(generate(dir, { include: ['dockerignore'] }).files.map((f) => f.path), ['.dockerignore']);
});

test('new project and option validation', () => {
  assert.throws(() => generate(null, { isNew: true }), /choose a stack/);
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
  const gl = generate(null, { isNew: true, stack: 'node', ci: 'gitlab', testVersions: ['20', '22'] }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /image: node:\$VERSION/);
  assert.match(gl, /- VERSION: \["20","22"\]/);
});

test('permissions: extras go top-level, id-token and packages only where needed', () => {
  const { text } = ciOf({ permissions: ['pull-requests-write', 'id-token-write'] });
  assert.match(text, /\npermissions:\n {2}contents: read\n {2}pull-requests: write\n\n/);
  assert.match(text, /image:[\s\S]*permissions:[\s\S]*packages: write/);
  assert.doesNotMatch(text, /id-token/);
});

test('platforms add QEMU and the platforms input', () => {
  const { text } = ciOf({ platforms: ['linux/amd64', 'linux/arm64'] });
  assert.match(text, /docker\/setup-qemu-action@v3/);
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

test('OIDC: id-token permission switches cloud login from stored keys to federation', () => {
  const keys = ciOf({ deploy: 'cloudrun' });
  assert.match(keys.text, /credentials_json: "\$\{\{ secrets.GCP_SA_KEY \}\}"/);
  assert.doesNotMatch(keys.text, /id-token/);
  const oidc = ciOf({ deploy: 'cloudrun', permissions: ['id-token-write'] });
  assert.match(oidc.text, /workload_identity_provider/);
  assert.match(oidc.text, /id-token: write/);
  assert.doesNotMatch(oidc.text, /GCP_SA_KEY/);
  assert.match(ciOf({ deploy: 'ecs', permissions: ['id-token-write'] }).text, /role-to-assume/);
  assert.match(ciOf({ deploy: 'azure', permissions: ['id-token-write'] }).text, /client-id/);
});

test('registry follows the target: Artifact Registry, ECR, ACR, GHCR', () => {
  assert.match(ciOf({ deploy: 'cloudrun' }).text, /-docker\.pkg\.dev\/\$\{\{ vars\.GCP_PROJECT \}\}\/\$\{\{ vars\.GAR_REPO \}\}\/app/);
  assert.match(ciOf({ deploy: 'ecs' }).text, /amazon-ecr-login@v2/);
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
  const dir = project({ 'package.json': { scripts: { start: 'x' } } });
  assert.match(generate(dir, { deploy: 'fly' }).files.find((f) => f.path === 'fly.toml').content, /^app = "shipkit-[a-zA-Z0-9]+"|^app = "shipkit-/m);
});

test('deploy options are validated', () => {
  assert.throws(() => ciOf({ deploy: 'heroku' }), /unknown deploy target/);
  assert.throws(() => ciOf({ deploy: 'ssh', deployOn: 'someday' }), /invalid deploy-on/);
  assert.throws(() => ciOf({ deploy: 'ssh', environment: 'prod uction' }), /invalid environment/);
  assert.throws(() => ciOf({ permissions: ['admin'] }), /invalid permission/);
  assert.throws(() => ciOf({ testOs: ['solaris'] }), /invalid test OS/);
  assert.throws(() => generate(null, { isNew: true, stack: 'node', ci: 'none', deploy: 'ssh' }), /needs a CI provider/);
});

test('gitlab: workflow rules, resource group, manual deploy, ignored GitHub-only settings', () => {
  const r = generate(null, {
    isNew: true, stack: 'node', ci: 'gitlab', deploy: 'kubernetes', deployOn: 'manual',
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
  const dir = project({ 'package.json': { scripts: { lint: 'eslint .', test: 'vitest', build: 'tsc', start: 'x' } } });
  assert.deepEqual(generate(dir).ci.selected, ['lint', 'test', 'build']);
  assert.throws(() => fresh({ stack: 'java', ciSteps: ['lint'] }), /lint CI step is not available for java/);
  assert.throws(() => fresh({ stack: 'node', ciSteps: ['deploy'] }), /invalid CI step/);
});

test('selecting a CI step the project lacks is called out', () => {
  const dir = project({ 'package.json': { scripts: { start: 'x' } } });
  const r = generate(dir, { ciSteps: ['lint', 'test'] });
  assert.ok(r.notes.some((n) => /no "lint" script/.test(n)));
  assert.ok(r.notes.some((n) => /no "test" script/.test(n)));
  assert.ok(!fresh({ stack: 'node', ciSteps: ['lint'] }).notes.some((n) => /no "lint" script/.test(n)));
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
  assert.match(ci, /DATABASE_URL: "postgres:\/\/app:app@localhost:5432\/app"/);
  assert.match(ci, /MONGO_URL: "mongodb:\/\/localhost:27017\/app"/);
  const gl = generate(null, { isNew: true, stack: 'node', ci: 'gitlab', ciServices: ['postgres', 'redis'] }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /services:\n {4}- name: postgres:17-alpine\n {6}alias: postgres/);
  assert.match(gl, /DATABASE_URL: "postgres:\/\/app:app@postgres:5432\/app"/);
  assert.match(gl, /REDIS_URL: "redis:\/\/redis:6379"/);
  assert.throws(() => stepsOf({ stack: 'node', ciServices: ['postgres'], testOs: ['windows-latest'] }), /need Linux runners/);
  assert.throws(() => stepsOf({ stack: 'node', ciServices: ['oracle'] }), /invalid CI service/);
});

test('image scan: Trivy action on GitHub; on GitLab a docker run of Trivy between build and push, any registry', () => {
  const gh = stepsOf({ stack: 'node', scan: true }).ci;
  assert.match(gh, /aquasecurity\/trivy-action@0\.28\.0/);
  assert.match(gh, /image-ref: "\$\{\{ steps.ref.outputs.image \}\}"/);
  const gl = generate(null, { isNew: true, stack: 'node', ci: 'gitlab', scan: true, deploy: 'kubernetes' }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /stages: \[test, build, deploy\]/);
  assert.match(gl, /docker build [\s\S]*aquasec\/trivy:latest image --exit-code 1 --severity HIGH,CRITICAL[\s\S]*docker push --all-tags/);
  assert.match(gl, /needs: \[build-image\]/);
  const cloud = generate(null, { isNew: true, stack: 'node', ci: 'gitlab', scan: true, deploy: 'cloudrun' }).files.find((f) => f.kind === 'ci').content;
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
  assert.match(stepsOf({ stack: 'node', packages: ['curl', 'tini'] }).df, /FROM base AS runtime[\s\S]*RUN apk add --no-cache curl tini\nCOPY --from=build/);
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
  const gl = generate(null, { isNew: true, stack: 'node', ci: 'gitlab', buildArgs: ['API=1'] }).files.find((f) => f.kind === 'ci').content;
  assert.match(gl, /docker build --build-arg API="\$API" -t/);
  assert.ok(stepsOf({ stack: 'fastapi', buildArgs: ['X=1'] }).r.notes.some((n) => /Build args apply to Node and static-site/.test(n)));
});

test('rabbitmq is a compose service with an AMQP URL', () => {
  const r = fresh({ stack: 'node', db: ['rabbitmq'] });
  assert.match(file(r, 'docker-compose.yml'), /AMQP_URL: "amqp:\/\/app:\$\{DB_PASSWORD:-app\}@rabbitmq:5672"/);
  assert.match(file(r, 'docker-compose.yml'), /rabbitmq-diagnostics/);
});

test('GitLab test job always has a script, even with no CI steps selected', () => {
  const text = generate(null, { isNew: true, stack: 'java', ci: 'gitlab', ciSteps: [] }).files.find((f) => f.kind === 'ci').content;
  assert.match(text, /script:\n {4}- echo "No test steps selected"/);
});

// ------------------------------------------------------------------------------------ Go and Rust

test('go: detects go.mod, the cmd/ main package and the go version; static binary in alpine', () => {
  const dir = project({ 'go.mod': 'module x\n\ngo 1.23.1\n', 'cmd/api/main.go': 'package main', 'cmd/tool/sub/main.go': 'package main' });
  const r = generate(dir, { healthcheck: '/health', packages: ['curl'] });
  assert.equal(r.stack, 'go');
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM golang:1\.23-alpine AS build/);
  assert.match(df, /CGO_ENABLED=0 go build .* -o \/out\/app \.\/cmd\/api/);
  assert.match(df, /FROM alpine:3 AS runtime/);
  assert.match(df, /RUN apk add --no-cache curl/);
  assert.match(df, /USER app/);
  assert.match(df, /HEALTHCHECK .* wget -qO \/dev\/null http:\/\/127\.0\.0\.1:8080\/health/);
  assert.match(file(r, '.github/workflows/ci.yml'), /actions\/setup-go@v5/);
  const audit = fresh({ stack: 'go', ciSteps: ['lint', 'audit'] }).files.find((f) => f.kind === 'ci').content;
  assert.match(audit, /run: go vet .\/\.\.\./);
  assert.match(audit, /govulncheck/);
});

test('rust: crate name, rust-version and Cargo.lock drive the Dockerfile', () => {
  const dir = project({ 'Cargo.toml': '[package]\nname = "my-svc"\nversion = "0.1.0"\nrust-version = "1.82"\n[dependencies]\n', 'Cargo.lock': '', 'src/main.rs': 'fn main(){}' });
  const r = generate(dir);
  assert.equal(r.stack, 'rust');
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM rust:1\.82-alpine AS build/);
  assert.match(df, /cargo build --release --locked/);
  assert.match(df, /cp target\/release\/my-svc \/out\/app/);
  const noLock = generate(project({ 'Cargo.toml': '[package]\nname = "a"\n', 'src/lib.rs': '' }));
  assert.ok(noLock.notes.some((n) => /No Cargo\.lock/.test(n)));
  assert.ok(noLock.notes.some((n) => /library crate/.test(n)));
  assert.throws(() => generate(project({ 'Cargo.toml': '[workspace]\nmembers = []\n' })), /no \[package\]/);
});

// ------------------------------------------------------------------------------ more compose services

test('mariadb, memcached, elasticsearch and mailpit are compose services; stateless ones get no volume', () => {
  const r = fresh({ stack: 'node', db: ['mariadb', 'memcached', 'elasticsearch', 'mailpit'] });
  const compose = file(r, 'docker-compose.yml');
  assert.match(compose, /DATABASE_URL: "mysql:\/\/app:\$\{DB_PASSWORD:-app\}@mariadb:3306\/app"/);
  assert.match(compose, /MEMCACHED_URL: "memcached:11211"/);
  assert.match(compose, /ELASTICSEARCH_URL: "http:\/\/elasticsearch:9200"/);
  assert.match(compose, /SMTP_URL: "smtp:\/\/mailpit:1025"/);
  assert.match(compose, /volumes:\n {2}mariadb-data:\n {2}elasticsearch-data:\n?$/);
  assert.doesNotMatch(compose, /memcached-data|mailpit-data/);
  assert.ok(r.notes.some((n) => /web inbox is on port 8025/.test(n)));
  assert.throws(() => fresh({ stack: 'node', db: ['postgres', 'mariadb'] }), /both define DATABASE_URL/);
  const ci = stepsOf({ stack: 'node', ciServices: ['memcached'] }).ci;
  assert.match(ci, /MEMCACHED_URL: "localhost:11211"/);
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
  assert.match(ci, /lint-dockerfile:\n {4}runs-on: ubuntu-latest[\s\S]*hadolint\/hadolint-action@v3\.1\.0/);
  assert.match(ci, /failure-threshold: "error"/);
  assert.match(ci, /image:\n {4}needs: \[test, lint-dockerfile\]/);
  assert.match(ci, /sbom: "true"\n\s+provenance: "mode=max"/);
  assert.match(ci, /sigstore\/cosign-installer@v3/);
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
  assert.match(gl, /lint-dockerfile:\n {2}stage: test\n {2}image: hadolint\/hadolint:latest-debian/);
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
  const dev = JSON.parse(file(r, '.devcontainer/devcontainer.json'));
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

test('php: composer.json drives version, extensions and web root; apache runs unprivileged', () => {
  const dir = project({
    'composer.json': { require: { php: '^8.3', 'ext-intl': '*', 'laravel/framework': '^11' }, 'require-dev': { 'phpunit/phpunit': '^11' } },
    'composer.lock': '{}',
    'public/index.php': '<?php',
  });
  const r = generate(dir, { healthcheck: '/up' });
  assert.equal(r.stack, 'php');
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM php:8\.3-apache AS runtime/);
  assert.match(df, /install-php-extensions opcache intl/);
  assert.match(df, /composer install --no-dev .*--ignore-platform-reqs/);
  assert.match(df, /s!\/var\/www\/html!\/var\/www\/html\/public!g/);
  assert.match(df, /Listen 8080/);
  assert.match(df, /USER www-data/);
  assert.match(df, /CMD curl -fsS -o \/dev\/null http:\/\/127\.0\.0\.1:8080\/up \|\| exit 1/);
  assert.ok(r.notes.some((n) => /Laravel: set APP_KEY/.test(n)));
  const ci = file(r, '.github/workflows/ci.yml');
  assert.match(ci, /shivammathur\/setup-php@v2/);
  assert.match(ci, /run: php artisan test/);
  assert.equal(r.ci.selected.join(), 'test');
  const noRoot = generate(project({ 'composer.json': { require: {} } }));
  assert.match(file(noRoot, 'Dockerfile'), /FROM php:8\.4-apache/);
  assert.ok(noRoot.notes.some((n) => /No composer\.lock/.test(n)));
  assert.ok(fresh({ stack: 'php', codeScan: true }).notes.some((n) => /CodeQL does not support php/.test(n)));
});

test('ruby: rails app builds with native gem libs, precompiles assets, runs rails server', () => {
  const dir = project({
    Gemfile: "source 'https://rubygems.org'\nruby '3.3.5'\ngem 'rails'\ngem 'pg'\ngem 'puma'\ngem 'propshaft'\ngem 'rspec-rails'\n",
    'Gemfile.lock': '',
    'config.ru': '',
    'config/application.rb': 'module App; class Application < Rails::Application; end; end',
  });
  const r = generate(dir, { packages: ['tzdata'] });
  assert.equal(r.stack, 'ruby');
  const df = file(r, 'Dockerfile');
  assert.match(df, /FROM ruby:3\.3-slim AS build/);
  assert.match(df, /libpq-dev/);
  assert.match(df, /apt-get install -y --no-install-recommends libpq5 tzdata/);
  assert.match(df, /SECRET_KEY_BASE_DUMMY=1 bundle exec rails assets:precompile/);
  assert.match(df, /CMD \["bundle","exec","rails","server","-b","0.0.0.0","-p","3000"\]/);
  assert.match(df, /USER app/);
  assert.match(file(r, '.github/workflows/ci.yml'), /run: bundle exec rspec/);
  const api = generate(project({ Gemfile: "gem 'rails'\ngem 'propshaft'\n", 'Gemfile.lock': '', 'config/application.rb': 'config.api_only = true' }));
  assert.doesNotMatch(file(api, 'Dockerfile'), /assets:precompile/);
  const rack = generate(project({ Gemfile: "gem 'sinatra'\ngem 'puma'\n", 'Gemfile.lock': '', 'config.ru': '' }));
  assert.match(file(rack, 'Dockerfile'), /CMD \["bundle","exec","puma","-b","tcp:\/\/0\.0\.0\.0:3000"\]/);
  const hc = generate(dir, { healthcheck: '/up' });
  assert.ok(hc.notes.some((n) => /no curl or wget/.test(n)));
  assert.match(file(hc, 'Dockerfile'), /\/dev\/tcp\/127\.0\.0\.1\/3000/);
});

// ------------------------------------------------------------------------- choosing the image registry

test('every registry can be chosen for the registry target, on both providers, with its secrets listed', () => {
  const expected = {
    dockerhub: [/DOCKERHUB_USERNAME/, /secrets DOCKERHUB_TOKEN; variables DOCKERHUB_USERNAME/],
    quay: [/quay\.io\/\$\{\{ vars\.QUAY_NAMESPACE \}\}\/app/, /secrets QUAY_PASSWORD; variables QUAY_USERNAME, QUAY_NAMESPACE/],
    custom: [/\$\{\{ vars\.REGISTRY_HOST \}\}\/\$\{\{ vars\.REGISTRY_NAMESPACE \}\}\/app/, /secrets REGISTRY_PASSWORD; variables REGISTRY_HOST, REGISTRY_NAMESPACE, REGISTRY_USERNAME/],
    gar: [/-docker\.pkg\.dev/, /secrets GCP_SA_KEY; variables GCP_PROJECT, GCP_REGION, GAR_REPO\./],
    ecr: [/amazonaws\.com/, /secrets AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY; variables AWS_REGION, AWS_ACCOUNT_ID, ECR_REPOSITORY\./],
    acr: [/azurecr\.io\/app/, /secrets AZURE_CREDENTIALS; variables ACR_NAME\./],
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
  assert.match(ci, /uses: google-github-actions\/auth@v2[\s\S]*workload_identity_provider/);
  assert.match(ci, /id-token: write/);
  assert.ok(gar.notes.some((n) => /GCP_WORKLOAD_IDENTITY_PROVIDER, GCP_SERVICE_ACCOUNT/.test(n)));
  assert.match(fresh({ stack: 'node', registry: 'ecr' }).files.find((f) => f.kind === 'ci').content, /aws-actions\/configure-aws-credentials@v4[\s\S]*amazon-ecr-login@v2/);
  assert.match(fresh({ stack: 'node', registry: 'acr' }).files.find((f) => f.kind === 'ci').content, /azure\/login@v2[\s\S]*az acr login/);
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

test('jenkins: docker agents, credentials for secrets, services on the host network, deploy rule', () => {
  const r = fresh({ stack: 'node', ci: 'jenkins', registry: 'dockerhub', deploy: 'ssh', deployOn: 'manual', testVersions: ['20', '22'], ciServices: ['postgres'], schedule: '0 3 * * 1', timeout: 20, runner: 'linux' });
  const j = r.files.find((f) => f.kind === 'ci').content;
  assert.match(j, /cron\('0 3 \* \* 1'\)/);
  assert.match(j, /timeout\(time: 20, unit: 'MINUTES'\)/);
  assert.match(j, /stage\('Test 20'\)[\s\S]*docker\.image\('node:20'\)\.inside\('--network host'\)/);
  assert.match(j, /stage\('Test 22'\)/);
  assert.match(j, /docker run -d --name "shipkit-\$BUILD_TAG-postgres" --network host/);
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
  assert.match(b, /- \|\n {12}cat > \.shipkit-deploy\.sh <<'SHIPKIT_DEPLOY'/);
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
  assert.match(t, /\npermissions:\n {2}contents: write\n {2}issues: read\n {2}checks: write\n/);
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
