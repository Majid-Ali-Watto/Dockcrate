import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, stackIds } from '../src/generate.js';
import { getMeta, handleGenerate } from '../src/api.js';

const fresh = (opts) => generate(null, { ci: 'none', ...opts });
const file = (r, path) => r.files.find((f) => f.path === path)?.content;
const dockerfile = (opts) => file(fresh(opts), 'Dockerfile');
const froms = (df) => df.split('\n').filter((l) => l.startsWith('FROM ')).map((l) => l.slice(5));
const single = { multistage: false };

test('multi-stage with the stack default image is what you get when you ask for nothing', () => {
  for (const stack of stackIds()) {
    const plain = dockerfile({ stack });
    assert.equal(dockerfile({ stack, multistage: true }), plain, `${stack}: multistage: true is the default`);
    assert.ok(froms(plain).length >= 2, `${stack} has a build stage and a runtime stage`);
  }
});

test('the image flavor changes the base image of every stack that has both', () => {
  const first = (stack, imageVariant, extra = {}) => froms(dockerfile({ stack, imageVariant, ...extra }));
  assert.deepEqual(first('node', 'alpine').slice(0, 1), ['node:24-alpine AS base']);
  assert.deepEqual(first('node', 'slim').slice(0, 1), ['node:24-slim AS base']);
  assert.deepEqual(first('django', 'alpine'), ['python:3.13-alpine AS build', 'python:3.13-alpine AS runtime']);
  assert.deepEqual(first('fastapi', 'slim'), ['python:3.13-slim AS build', 'python:3.13-slim AS runtime']);
  assert.deepEqual(first('go', 'alpine'), ['golang:1.25-alpine AS build', 'alpine:3 AS runtime']);
  assert.deepEqual(first('go', 'slim'), ['golang:1.25-bookworm AS build', 'debian:bookworm-slim AS runtime']);
  assert.deepEqual(first('rust', 'slim'), ['rust:1-slim AS build', 'debian:bookworm-slim AS runtime']);
  assert.deepEqual(first('java', 'alpine'), ['maven:3-eclipse-temurin-21-alpine AS build', 'eclipse-temurin:21-jre-alpine AS runtime']);
  assert.deepEqual(first('java', 'slim'), ['maven:3-eclipse-temurin-21 AS build', 'eclipse-temurin:21-jre AS runtime']);
  assert.deepEqual(first('dotnet', 'alpine'), ['mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build', 'mcr.microsoft.com/dotnet/aspnet:9.0-alpine AS runtime']);
  assert.deepEqual(first('ruby', 'alpine'), ['ruby:3.4-alpine AS build', 'ruby:3.4-alpine AS runtime']);
  assert.deepEqual(first('react', 'slim'), ['node:24-slim AS build', 'nginxinc/nginx-unprivileged:1.30-trixie']);
  assert.deepEqual(first('vue', 'alpine'), ['node:24-alpine AS build', 'nginxinc/nginx-unprivileged:1.30-alpine']);
  // the same Gradle project gets a JDK image instead of the Maven one
  assert.deepEqual(first('java', 'alpine', { tool: 'gradle' }), ['eclipse-temurin:21-jdk-alpine AS build', 'eclipse-temurin:21-jre-alpine AS runtime']);
});

test('a flavor the stack does not have is reported and the default is used', () => {
  const r = fresh({ stack: 'php', imageVariant: 'alpine' });
  assert.deepEqual(froms(file(r, 'Dockerfile')), ['composer:2 AS vendor', 'php:8.4-apache AS runtime']);
  assert.ok(r.notes.some((n) => n.includes('php has no alpine image') && n.includes('Apache')));
  assert.equal(fresh({ stack: 'php', imageVariant: 'slim' }).notes.some((n) => n.includes('has no')), false);
});

test('OS packages, users and the healthcheck follow the flavor', () => {
  const o = { packages: ['curl'], healthcheck: '/health' };
  const nodeAlpine = dockerfile({ stack: 'node', imageVariant: 'alpine', ...o });
  assert.match(nodeAlpine, /RUN apk add --no-cache curl/);
  assert.match(nodeAlpine, /HEALTHCHECK .* wget -qO \/dev\/null/);
  const nodeSlim = dockerfile({ stack: 'node', imageVariant: 'slim', ...o });
  assert.match(nodeSlim, /apt-get install -y --no-install-recommends curl/);
  assert.match(nodeSlim, /HEALTHCHECK .*"node","-e","fetch\('http:\/\/127\.0\.0\.1:3000\/health'\)/, 'slim node has no wget: the probe is node itself');
  assert.match(dockerfile({ stack: 'django', imageVariant: 'alpine', packages: ['libpq'] }), /RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app/);
  assert.match(dockerfile({ stack: 'django', imageVariant: 'slim' }), /RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app app/);
  assert.match(dockerfile({ stack: 'java', imageVariant: 'alpine', healthcheck: '/h' }), /HEALTHCHECK .* wget/);
  assert.match(dockerfile({ stack: 'java', imageVariant: 'slim', healthcheck: '/h' }), /HEALTHCHECK .*bash/);
  // the "no curl or wget" note follows the image that is actually built
  assert.ok(fresh({ stack: 'java', imageVariant: 'slim', healthcheck: '/h' }).notes.some((n) => n.includes('no curl or wget')));
  assert.ok(!fresh({ stack: 'java', imageVariant: 'alpine', healthcheck: '/h' }).notes.some((n) => n.includes('no curl or wget')));
  assert.ok(fresh({ stack: 'go', imageVariant: 'slim', healthcheck: '/h' }).notes.some((n) => n.includes('no curl or wget')));
});

test('python: the multi-stage build installs into a virtualenv that the runtime copies', () => {
  const pip = dockerfile({ stack: 'django' });
  assert.match(pip, /FROM python:3\.13-slim AS build[\s\S]*build-essential[\s\S]*RUN python -m venv \/opt\/venv[\s\S]*RUN pip install --no-cache-dir -r requirements\.txt/);
  assert.match(pip, /FROM python:3\.13-slim AS runtime\nENV .* VIRTUAL_ENV=\/opt\/venv PATH="\/opt\/venv\/bin:\$PATH"[\s\S]*COPY --from=build \/opt\/venv \/opt\/venv\nCOPY \. \.\nUSER 10001:10001/);
  assert.doesNotMatch(pip.split('AS runtime')[1], /build-essential|pip install/, 'no compilers and no pip run in the final image');
  const uv = dockerfile({ stack: 'fastapi', tool: 'uv' });
  assert.match(uv, /UV_PROJECT_ENVIRONMENT=\/opt\/venv/);
  assert.match(dockerfile({ stack: 'django', tool: 'poetry' }), /RUN pip install --no-cache-dir poetry\nRUN python -m venv \/opt\/venv\nENV POETRY_VIRTUALENVS_CREATE=false VIRTUAL_ENV=\/opt\/venv/);
  assert.match(dockerfile({ stack: 'django', imageVariant: 'alpine' }), /RUN apk add --no-cache build-base/);
});

test('every stack, flavor and mode makes a Dockerfile with the right number of stages', () => {
  for (const stack of stackIds()) {
    for (const imageVariant of ['alpine', 'slim']) {
      for (const [mode, opts] of [['production', { multistage: false }], ['mixed', { multistage: false, stageMode: 'mixed' }]]) {
        const df = dockerfile({ stack, imageVariant, ...opts, healthcheck: '/health', packages: ['curl'] });
        assert.equal(froms(df).length, 1, `${stack} ${imageVariant} ${mode}: one stage\n${df}`);
        assert.ok(!/undefined|\[object/.test(df), `${stack} ${imageVariant} ${mode}`);
        assert.ok(!/COPY --from=build/.test(df), `${stack} ${imageVariant} ${mode}: nothing is copied from a stage that does not exist`);
      }
    }
  }
});

test('production only: the runtime image copies what you built, and says so', () => {
  const note = (stack, extra = {}) => fresh({ stack, ...single, ...extra }).notes.find((n) => n.startsWith('Production only'));
  assert.match(dockerfile({ stack: 'go', ...single }), /FROM alpine:3 AS runtime[\s\S]*COPY app \/usr\/local\/bin\/app/);
  assert.match(note('go'), /CGO_ENABLED=0 go build -o app/);
  assert.match(dockerfile({ stack: 'rust', ...single }), /COPY target\/x86_64-unknown-linux-musl\/release\/app \/usr\/local\/bin\/app/);
  assert.match(dockerfile({ stack: 'rust', ...single, imageVariant: 'slim' }), /COPY target\/release\/app \/usr\/local\/bin\/app/);
  assert.match(note('rust'), /musl/);
  assert.match(dockerfile({ stack: 'java', ...single }), /COPY target\/\*\.jar \/tmp\/jars\/[\s\S]*-exec mv \{\} app\.jar/);
  assert.match(dockerfile({ stack: 'java', ...single, tool: 'gradle' }), /COPY build\/libs\/\*\.jar/);
  assert.match(note('java'), /mvn package/);
  assert.match(dockerfile({ stack: 'dotnet', ...single }), /FROM mcr\.microsoft\.com\/dotnet\/aspnet:9\.0\n[\s\S]*COPY publish\/ \./);
  assert.match(note('dotnet'), /dotnet publish -c Release -o publish/);
  const spa = dockerfile({ stack: 'react', ...single });
  assert.match(spa, /^FROM nginxinc\/nginx-unprivileged:1\.30-alpine\nCOPY nginx\.conf[\s\S]*COPY dist\/ \/usr\/share\/nginx\/html\/\nUSER 101:101/m);
  assert.match(note('react'), /run `npm run build` before `docker build`/);
  assert.ok(file(fresh({ stack: 'react', ...single }), 'nginx.conf'));
  const node = dockerfile({ stack: 'node', ...single });
  assert.match(node, /RUN npm ci --omit=dev\nCOPY \. \.\n# Next\.js[^\n]*\nRUN mkdir -p \.next\/cache && chown -R 1000:1000 \.next\nUSER 1000:1000/);
  assert.doesNotMatch(node, /npm run build/);
  assert.match(dockerfile({ stack: 'php', ...single }), /FROM php:8\.4-apache AS runtime[\s\S]*COPY \. \.\/\nRUN for d in storage bootstrap\/cache; [^\n]*\nUSER 33:33/);
  assert.match(note('php'), /composer install --no-dev/);
  // an interpreted stack needs no prebuilt output; its note is about the missing compilers
  assert.match(note('django'), /without compilers/);
  assert.doesNotMatch(note('django'), /before `docker build`/);
  const ruby = dockerfile({ stack: 'ruby', ...single });
  assert.match(ruby, /apt-get install -y --no-install-recommends build-essential[\s\S]*&& bundle install[\s\S]*&& apt-get purge -y --auto-remove build-essential/);
  assert.match(dockerfile({ stack: 'ruby', ...single, imageVariant: 'alpine' }), /apk add --no-cache --virtual \.build [\s\S]*&& apk del \.build/);
});

test('production only: .dockerignore lets the build output into the context', () => {
  const ignore = (stack, opts = {}) => file(fresh({ stack, ...opts }), '.dockerignore');
  assert.match(ignore('node'), /^dist$/m);
  assert.doesNotMatch(ignore('node', single), /^(dist|build|\.next)$/m);
  assert.doesNotMatch(ignore('vue', single), /^dist$/m);
  assert.match(ignore('vue'), /^dist$/m);
  assert.match(ignore('rust'), /^target$/m);
  assert.match(ignore('rust', single), /^target\/\*\n!target\/release\/app\n!target\/x86_64-unknown-linux-musl\/release\/app$/m);
  assert.match(ignore('java', single), /^target\/\*\n!target\/\*\.jar$/m);
  assert.match(ignore('java', { ...single, tool: 'gradle' }), /^build\/\*\n!build\/libs$/m);
  assert.match(ignore('php'), /^vendor$/m);
  assert.doesNotMatch(ignore('php', single), /^vendor$/m);
});

test('build and production mixed: one image with the toolchain, built from the sources', () => {
  const mixed = { ...single, stageMode: 'mixed' };
  const note = (stack) => fresh({ stack, ...mixed }).notes.find((n) => n.startsWith('Build and production in one image'));
  assert.match(dockerfile({ stack: 'go', ...mixed }), /FROM golang:1\.25-alpine\n[\s\S]*go build [^\n]*-o \/usr\/local\/bin\/app \.[\s\S]*ENTRYPOINT/);
  assert.match(dockerfile({ stack: 'rust', ...mixed }), /FROM rust:1-alpine\n[\s\S]*cargo build --release[\s\S]*cp target\/release\/app \/usr\/local\/bin\/app/);
  const java = dockerfile({ stack: 'java', ...mixed });
  assert.match(java, /FROM maven:3-eclipse-temurin-21\nWORKDIR \/app\nCOPY \. \.\nRUN --mount=type=cache,target=\/root\/\.m2 \\\n {4}mvn -B -DskipTests package && \\\n {4}find target[\s\S]*-exec cp \{\} \/app\/app\.jar/);
  assert.match(dockerfile({ stack: 'dotnet', ...mixed }), /FROM mcr\.microsoft\.com\/dotnet\/sdk:9\.0\n[\s\S]*dotnet publish[\s\S]*WORKDIR \/app\/publish[\s\S]*ENTRYPOINT \["dotnet", "App\.dll"\]/);
  const node = dockerfile({ stack: 'node', ...mixed });
  assert.match(node, /RUN npm ci\nCOPY \. \.\n# Next\.js[^\n]*\nRUN npm run build && mkdir -p \.next\/cache && chown -R 1000:1000 \.next\nENV NODE_ENV=production/);
  assert.doesNotMatch(node, /--omit=dev/, 'devDependencies stay in a mixed image');
  const spa = dockerfile({ stack: 'vue', ...mixed });
  assert.match(spa, /RUN npm run build\nRUN npm install --global serve@14\nUSER 1000:1000[\s\S]*CMD \["serve","-s","dist","-l","8080"\]/);
  assert.equal(file(fresh({ stack: 'vue', ...mixed }), 'nginx.conf'), undefined, 'no nginx, no nginx.conf');
  assert.match(dockerfile({ stack: 'django', ...mixed }), /build-essential[\s\S]*RUN uv sync|build-essential[\s\S]*RUN pip install/);
  const mixedUv = dockerfile({ stack: 'django', tool: 'uv', ...mixed });
  assert.match(mixedUv, /RUN uv sync --frozen --no-install-project/, 'development dependencies are installed');
  assert.match(dockerfile({ stack: 'php', ...mixed }), /COPY --from=composer:2 \/usr\/bin\/composer[\s\S]*RUN composer install --no-interaction --prefer-dist/);
  assert.doesNotMatch(dockerfile({ stack: 'ruby', ...mixed }), /BUNDLE_WITHOUT/);
  for (const stack of ['go', 'java', 'node', 'react', 'django', 'php', 'ruby', 'dotnet', 'rust']) assert.ok(note(stack), `${stack} explains what mixed means`);
});

test('the options are validated, and a single-stage mode without single-stage builds is reported', () => {
  assert.throws(() => fresh({ stack: 'node', imageVariant: 'debian' }), /invalid image variant "debian"/);
  assert.throws(() => fresh({ stack: 'node', ...single, stageMode: 'both' }), /invalid single-stage mode "both"/);
  const r = fresh({ stack: 'node', stageMode: 'mixed' });
  assert.ok(r.notes.some((n) => n.includes('mixed single-stage mode was ignored')));
  assert.equal(froms(file(r, 'Dockerfile')).length, 4);
});

test('services can pick their own flavor and mode', () => {
  const r = generate(null, {
    ci: 'none',
    imageVariant: 'slim',
    services: [
      { name: 'api', stack: 'django' },
      { name: 'web', stack: 'react', imageVariant: 'alpine', multistage: false, stageMode: 'mixed' },
      { name: 'edge', stack: 'go', multistage: false },
    ],
  });
  assert.deepEqual(froms(file(r, 'api/Dockerfile')), ['python:3.13-slim AS build', 'python:3.13-slim AS runtime']);
  assert.deepEqual(froms(file(r, 'web/Dockerfile')), ['node:24-alpine']);
  assert.deepEqual(froms(file(r, 'edge/Dockerfile')), ['debian:bookworm-slim AS runtime']);
  assert.ok(r.notes.some((n) => n.startsWith('edge: Production only')));
  assert.equal(file(r, 'web/nginx.conf'), undefined);
});

test('the API takes the flavor and the stage options, and lists what each stack offers', () => {
  const meta = getMeta();
  assert.deepEqual(meta.variants, ['alpine', 'slim']);
  assert.deepEqual(meta.stageModes, ['production', 'mixed']);
  assert.deepEqual(meta.stacks.find((s) => s.id === 'php').variants, ['slim']);
  assert.deepEqual(meta.stacks.find((s) => s.id === 'node').variants, ['alpine', 'slim']);
  assert.equal(meta.stacks.find((s) => s.id === 'node').defaultVariant, 'alpine');
  const data = handleGenerate({ mode: 'new', stack: 'go', imageVariant: 'slim', multistage: false, stageMode: 'mixed', ci: 'none' });
  assert.deepEqual(froms(data.files.find((f) => f.path === 'Dockerfile').content), ['golang:1.25-bookworm']);
  assert.throws(() => handleGenerate({ mode: 'new', stack: 'go', imageVariant: 'x', ci: 'none' }), /invalid image variant/);
});

test('every stack, flavor and mode runs as a numeric non-root user that cannot rewrite its own code', async () => {
  const { STACKS } = await import('../src/stacks/index.js');
  const modes = [['multi', {}], ['production', { multistage: false }], ['mixed', { multistage: false, stageMode: 'mixed' }]];
  for (const stack of STACKS) {
    for (const imageVariant of stack.variants) {
      for (const [mode, opts] of modes) {
        const what = `${stack.id} ${imageVariant} ${mode}`;
        const df = dockerfile({ stack: stack.id, imageVariant, ...opts });
        const users = df.split('\n').filter((l) => l.startsWith('USER '));
        const last = users.at(-1);
        const runAs = stack.runAs({}, { variant: imageVariant, mode });
        assert.ok(runAs.uid > 0, what);
        // .NET records its own numeric user through $APP_UID (1654); nginx and node images have theirs.
        if (stack.id === 'dotnet') assert.equal(last, 'USER $APP_UID', what);
        else assert.equal(last, `USER ${runAs.uid}:${runAs.gid}`, what);
        assert.ok(runAs.writable.includes('/tmp'), what);
        // Code is copied as root's: only Next.js' .next folder is handed to the node user.
        for (const line of df.split('\n').filter((l) => /--chown/.test(l))) assert.match(line, /\/next \.\/\.next$/, `${what}: ${line}`);
        assert.doesNotMatch(df, /chown -R \S+ \.(\s|$)|chown -R \S+ \/app(\s|$)/, what);
      }
    }
  }
  assert.equal(STACKS.find((s) => s.id === 'php').runAs().readOnlyRoot, false);
  assert.deepEqual(STACKS.find((s) => s.id === 'ruby').runAs().writable, ['/tmp', '/app/tmp', '/app/log', '/app/storage']);
  assert.equal(STACKS.find((s) => s.id === 'react').runAs({}, { mode: 'mixed' }).uid, 1000);
  assert.equal(STACKS.find((s) => s.id === 'react').runAs({}, { mode: 'multi' }).uid, 101);
});

test('the development Dockerfile says why it runs as root', () => {
  for (const stack of stackIds()) {
    const r = fresh({ stack, envs: ['dev'] });
    const dev = file(r, 'Dockerfile.dev');
    if (!dev) continue;
    assert.match(dev, /^# syntax=docker\/dockerfile:1\n# Development only: runs as root[^\n]*Never deploy it/, stack);
    assert.doesNotMatch(dev, /^USER /m, stack);
  }
});
