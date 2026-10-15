import { has, read, readJson, firstInt, lines } from '../fsutil.js';
import { apk, argLines, envLines, healthcheck } from '../container.js';

const LOCKFILES = { npm: 'package-lock.json', yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml' };
const IGNORE = ['**/node_modules', 'dist', 'build', 'coverage', '.angular', '.next', 'npm-debug.log*'];
const SYNTAX = '# syntax=docker/dockerfile:1';

function install({ pm, hasLock }, prod = false) {
  if (pm === 'npm') return `${hasLock ? 'npm ci' : 'npm install'}${prod ? ' --omit=dev' : ''}`;
  return `${pm} install --frozen-lockfile${prod ? (pm === 'yarn' ? ' --production' : ' --prod') : ''}`;
}

function inspect(dir, opts) {
  const pkg = readJson(dir, 'package.json');
  if (!pkg) return null;
  const pm = has(dir, LOCKFILES.pnpm) ? 'pnpm' : has(dir, LOCKFILES.yarn) ? 'yarn' : 'npm';
  const scripts = pkg.scripts ?? {};
  return {
    pkg,
    pm,
    scripts,
    deps: { ...pkg.dependencies, ...pkg.devDependencies },
    hasLock: has(dir, LOCKFILES[pm]),
    version: opts.runtime ?? firstInt(pkg.engines?.node) ?? firstInt(read(dir, '.nvmrc')) ?? '24',
    hasTest: Boolean(scripts.test) && !/no test specified/.test(scripts.test),
  };
}

/**
 * Info for a project that does not exist yet. The scripts a CI step might call are assumed to exist (the user
 * decides which steps to enable), `build` only when the project has a build step, and the lockfile is committed.
 */
function starter(opts, { build, start = false }) {
  return {
    starter: true,
    pkg: { main: 'index.js' },
    pm: opts.tool ?? 'npm',
    scripts: { lint: 'lint', test: 'test', ...(build && { build: 'build' }), ...(start && { start: 'start' }) },
    deps: {},
    hasLock: true,
    hasTest: true,
    version: opts.runtime ?? '24',
  };
}

const TOOLS = ['npm', 'yarn', 'pnpm'];
const cleanDir = (dir) => dir.replace(/^\.\//, '').replace(/\/$/, '');

const corepack = (i) => i.pm !== 'npm' && 'RUN corepack enable';
const manifest = (i) => `COPY package.json ${LOCKFILES[i.pm]}* ./`;
const buildStep = (i) => i.scripts.build && `RUN ${i.pm} run build`;

const CI_STEPS = ['lint', 'test', 'build', 'audit'];
const AUDIT = {
  npm: 'npm audit --omit=dev --audit-level=high',
  yarn: 'yarn audit --groups dependencies --level high',
  pnpm: 'pnpm audit --prod --audit-level high',
};

/** Steps that make sense out of the box: what the project already defines (a new project: just the build). */
function ciDefaults(i, { test = true } = {}) {
  if (i.starter) return i.scripts.build ? ['build'] : [];
  return [i.scripts.lint && 'lint', test && i.hasTest && 'test', i.scripts.build && 'build'].filter(Boolean);
}

function ciNotes(i, selected, { testArgs }) {
  const missing = i.starter ? {} : { lint: !i.scripts.lint, test: !i.hasTest, build: !i.scripts.build };
  return [
    ...selected
      .filter((step) => missing[step])
      .map((step) => `package.json has no "${step}" script, so the CI ${step} step will fail until you add one.`),
    selected.includes('test') && testArgs && 'Angular tests need a headless Chrome launcher (Karma) to run in CI.',
  ];
}

function ci(i, selected, v = i.version, { testArgs = '' } = {}) {
  const { pm } = i;
  const on = (step) => selected.includes(step);
  const test = testArgs ? (pm === 'npm' ? `npm test -- ${testArgs}` : `${pm} test ${testArgs}`) : `${pm} test`;
  return {
    image: `node:${v}`,
    steps: [
      pm !== 'npm' && { run: 'corepack enable' },
      {
        uses: 'actions/setup-node@v4',
        with: { 'node-version': v, ...(i.hasLock && { cache: pm }) },
      },
      { run: install(i) },
      on('lint') && { run: `${pm} run lint` },
      on('test') && { run: test },
      on('build') && { run: `${pm} run build` },
      on('audit') && { run: AUDIT[pm] },
    ],
  };
}

function nginxConf(port) {
  return lines(
    'server {',
    `  listen ${port};`,
    '  root /usr/share/nginx/html;',
    '  index index.html;',
    '',
    '  gzip on;',
    '  gzip_types text/css application/javascript application/json image/svg+xml;',
    '',
    '  location / {',
    '    try_files $uri $uri/ /index.html;',
    '  }',
    '',
    '  location = /index.html {',
    '    add_header Cache-Control "no-cache";',
    '  }',
    '',
    '  location ~* \\.(?:js|css|woff2?|png|jpe?g|gif|svg|ico|webp)$ {',
    '    expires 1y;',
    '    add_header Cache-Control "public, immutable";',
    '    try_files $uri =404;',
    '  }',
    '}',
  );
}

/** Static single-page app: build with node, serve with unprivileged nginx. */
const spa = (id, { match, buildDir, starterDir, testArgs = '', usesName = false }) => ({
  id,
  port: 8080,
  backend: false,
  tools: TOOLS,
  usesName,
  usesBuildArgs: true,
  usesPackages: false,
  ecosystem: () => 'npm',
  codeql: 'javascript-typescript',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/javascript-node:1-${i.version}`,
  ciSteps: CI_STEPS,
  ciDefaults: (i) => ciDefaults(i, { test: !testArgs }),
  ciNotes: (i, selected) => ciNotes(i, selected, { testArgs }),
  ignore: IGNORE,
  detect(dir, opts) {
    const i = inspect(dir, opts);
    if (!i || !match(i.deps)) return null;
    i.buildDir = cleanDir(opts.buildDir ?? buildDir(dir, i));
    return i;
  },
  starter(opts) {
    const i = starter(opts, { build: true });
    i.buildDir = cleanDir(opts.buildDir ?? starterDir(opts));
    return i;
  },
  assumes: (i) => `a "build" script that writes to ${i.buildDir}/ (Vite-style; use the build folder option otherwise)`,
  dockerfile: (i, port, c) =>
    lines(
      SYNTAX,
      `FROM node:${i.version}-alpine AS build`,
      'WORKDIR /app',
      corepack(i),
      manifest(i),
      `RUN ${install(i)}`,
      'COPY . .',
      argLines(c),
      buildStep(i),
      '',
      'FROM nginxinc/nginx-unprivileged:alpine',
      'COPY nginx.conf /etc/nginx/conf.d/default.conf',
      `COPY --from=build /app/${i.buildDir}/ /usr/share/nginx/html/`,
      `EXPOSE ${port}`,
      healthcheck(c, port, 'wget'),
    ),
  files: (i, port) => [{ path: 'nginx.conf', content: nginxConf(port) }],
  ci: (i, v, selected) => ci(i, selected, v, { testArgs }),
  notes: (i, port, c) => [
    `Serving the static build from ${i.buildDir}/ (override with the build folder option).`,
    c.buildArgs.length === 0 &&
      "Build-time env vars (e.g. VITE_API_URL) can't be set at container runtime: add them as build args.",
    !i.scripts.build && 'package.json has no "build" script; the Docker build will fail without one.',
  ],
});

function angularBuildDir(dir) {
  const config = readJson(dir, 'angular.json');
  const [name, project] = Object.entries(config?.projects ?? {})[0] ?? [];
  const build = project?.architect?.build ?? project?.targets?.build;
  const out = build?.options?.outputPath;
  const base = (typeof out === 'string' ? out : out?.base) ?? `dist/${name}`;
  const browser =
    typeof out === 'object' ? (out.browser ?? 'browser') : /:application$/.test(build?.builder ?? '') ? 'browser' : '';
  return browser ? `${base}/${browser}` : base;
}

export const angular = spa('angular', {
  match: (deps) => '@angular/core' in deps,
  buildDir: angularBuildDir,
  starterDir: (opts) => `dist/${opts.name ?? 'app'}/browser`,
  usesName: true,
  testArgs: '--watch=false --browsers=ChromeHeadless',
});

export const vue = spa('vue', {
  match: (deps) => 'vue' in deps && !('nuxt' in deps),
  buildDir: () => 'dist',
  starterDir: () => 'dist',
});

export const react = spa('react', {
  match: (deps) => 'react' in deps && !('next' in deps) && !('react-native' in deps),
  buildDir: (dir, i) => ('react-scripts' in i.deps ? 'build' : 'dist'),
  starterDir: () => 'dist',
});

/** Any Node server (Express, Fastify, Nest, Next.js, ...). Also the fallback for other package.json projects. */
export const node = {
  id: 'node',
  port: 3000,
  backend: true,
  fallback: true,
  tools: TOOLS,
  usesBuild: true,
  usesBuildArgs: true,
  usesPackages: true,
  ecosystem: () => 'npm',
  codeql: 'javascript-typescript',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/javascript-node:1-${i.version}`,
  ciSteps: CI_STEPS,
  ciDefaults: (i) => ciDefaults(i),
  ciNotes: (i, selected) => ciNotes(i, selected, {}),
  ignore: IGNORE,
  detect: (dir, opts) => inspect(dir, opts),
  starter: (opts) => starter(opts, { build: opts.build !== false, start: true }),
  assumes: (i) => `a "start" script that runs the server${i.scripts.build ? ', a "build" script (TypeScript/Next.js/...)' : ''}`,
  dockerfile(i, port, c) {
    const main = i.pkg.main ?? 'index.js';
    const cmd = i.scripts.start ? [i.pm, 'start'] : ['node', main];
    return lines(
      SYNTAX,
      `FROM node:${i.version}-alpine AS base`,
      'WORKDIR /app',
      corepack(i),
      '',
      'FROM base AS deps',
      manifest(i),
      `RUN ${install(i, true)} && mkdir -p node_modules`,
      '',
      'FROM base AS build',
      manifest(i),
      `RUN ${install(i)}`,
      'COPY . .',
      argLines(c),
      buildStep(i),
      'RUN rm -rf node_modules',
      '',
      'FROM base AS runtime',
      `ENV NODE_ENV=production PORT=${port}`,
      envLines(c),
      apk(c),
      'COPY --from=build --chown=node:node /app ./',
      'COPY --from=deps --chown=node:node /app/node_modules ./node_modules',
      'USER node',
      `EXPOSE ${port}`,
      healthcheck(c, port, 'wget'),
      `CMD ${JSON.stringify(cmd)}`,
    );
  },
  ci: (i, v, selected) => ci(i, selected, v),
  notes: (i, port) => [
    `The app must listen on process.env.PORT (set to ${port}) and on 0.0.0.0, not just localhost.`,
    !i.scripts.start && !i.pkg.main && 'No "start" script or "main" in package.json; CMD falls back to node index.js.',
  ],
};
