import { lines } from '../fsutil.js';
import { DEFAULT_BUILD, argLines, envLines, healthcheck, pkgs } from '../container.js';

const LOCKFILES = { npm: 'package-lock.json', yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml' };
const IGNORE = ['**/node_modules', 'dist', 'build', 'coverage', '.angular', '.next', 'npm-debug.log*'];
const SYNTAX = '# syntax=docker/dockerfile:1';

function install({ pm, hasLock }, prod = false) {
  if (pm === 'npm') return `${hasLock ? 'npm ci' : 'npm install'}${prod ? ' --omit=dev' : ''}`;
  return `${pm} install --frozen-lockfile${prod ? (pm === 'yarn' ? ' --production' : ' --prod') : ''}`;
}

/**
 * Info for the project: the scripts a CI step might call are assumed to exist (the user
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
      on('lint') && { run: `${pm} run lint`, ciStep: 'lint' },
      on('test') && { run: test, ciStep: 'test' },
      on('build') && { run: `${pm} run build`, ciStep: 'build' },
      on('audit') && { run: AUDIT[pm], ciStep: 'audit' },
    ],
  };
}

/** Development image for any Node project: dev dependencies, the source bind mounted over /app, node_modules kept in the image. */
function nodeDev(i, port, c, cmd) {
  return {
    dockerfile: lines(
      SYNTAX,
      `FROM node:${i.version}-alpine`,
      'WORKDIR /app',
      corepack(i),
      pkgs(c, 'alpine'),
      manifest(i),
      `RUN ${install(i)}`,
      'COPY . .',
      `ENV PORT=${port} HOST=0.0.0.0 NODE_ENV=development`,
      envLines(c),
      `EXPOSE ${port}`,
      `CMD ${JSON.stringify(cmd)}`,
    ),
    workdir: '/app',
    mode: 'mount',
    volumes: ['/app/node_modules'],
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

const probeOf = (v) => (v === 'alpine' ? 'wget' : 'node');
/** What `.dockerignore` leaves out; a production-only image copies the build output, so that must not be ignored. */
const ignoreFor = (b) => (b.mode === 'production' ? IGNORE.filter((e) => !['dist', 'build', '.next'].includes(e)) : IGNORE);
const prebuilt = (i, what) => i.scripts.build && `Production only: the image copies ${what}, so run \`${i.pm} run build\` before \`docker build\` (the generated pipeline builds the image from the repository as it is).`;

/** Static single-page app: build with node, serve with unprivileged nginx. */
const spa = (id, { starterDir, testArgs = '', usesName = false }) => ({
  id,
  port: 8080,
  backend: false,
  tools: TOOLS,
  usesName,
  usesBuildArgs: true,
  usesPackages: false,
  ecosystem: () => 'npm',
  variants: ['alpine', 'slim'],
  defaultVariant: 'alpine',
  healthKind: (b) => (b.mode === 'mixed' ? probeOf(b.variant) : b.variant === 'alpine' ? 'wget' : 'curl'),
  codeql: 'javascript-typescript',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/javascript-node:1-${i.version}`,
  ciSteps: CI_STEPS,
  ciDefaults: (i) => ciDefaults(i, { test: !testArgs }),
  ciNotes: (i, selected) => ciNotes(i, selected, { testArgs }),
  ignore: (b) => ignoreFor(b),
  starter(opts) {
    const i = starter(opts, { build: true });
    i.buildDir = cleanDir(opts.buildDir ?? starterDir(opts));
    return i;
  },
  assumes: (i) => `a "build" script that writes to ${i.buildDir}/ (Vite-style; use the build folder option otherwise)`,
  dockerfile(i, port, c, b = DEFAULT_BUILD) {
    const v = b.variant ?? 'alpine';
    const web = v === 'alpine' ? 'nginxinc/nginx-unprivileged:alpine' : 'nginxinc/nginx-unprivileged:bookworm';
    const probe = v === 'alpine' ? 'wget' : 'curl';
    if (b.mode === 'mixed') {
      // One image: node builds the site and `serve` hands it out (no nginx, so no nginx.conf).
      return lines(
        SYNTAX,
        `FROM node:${i.version}-${v}`,
        'WORKDIR /app',
        corepack(i),
        manifest(i),
        `RUN ${install(i)}`,
        'COPY . .',
        argLines(c),
        buildStep(i),
        'RUN npm install --global serve@14',
        'USER node',
        `EXPOSE ${port}`,
        healthcheck(c, port, probeOf(v)),
        `CMD ${JSON.stringify(['serve', '-s', i.buildDir, '-l', String(port)])}`,
      );
    }
    if (b.mode === 'production') {
      return lines(SYNTAX, `FROM ${web}`, 'COPY nginx.conf /etc/nginx/conf.d/default.conf', `COPY ${i.buildDir}/ /usr/share/nginx/html/`, `EXPOSE ${port}`, healthcheck(c, port, probe));
    }
    return lines(
      SYNTAX,
      `FROM node:${i.version}-${v} AS build`,
      'WORKDIR /app',
      corepack(i),
      manifest(i),
      `RUN ${install(i)}`,
      'COPY . .',
      argLines(c),
      buildStep(i),
      '',
      `FROM ${web}`,
      'COPY nginx.conf /etc/nginx/conf.d/default.conf',
      `COPY --from=build /app/${i.buildDir}/ /usr/share/nginx/html/`,
      `EXPOSE ${port}`,
      healthcheck(c, port, probe),
    );
  },
  // The dev server listens on the same port as the nginx image, so one compose port mapping serves both.
  dev(i, port, c) {
    // A project that defines no dev script is a Vite one (dev), except Angular (ng serve is `start`).
    const script = i.scripts.dev ? 'dev' : i.scripts.start ? 'start' : id === 'angular' ? 'start' : 'dev';
    const args = ['--host', '0.0.0.0', '--port', String(port)];
    return nodeDev(i, port, c, [i.pm, 'run', script, ...(i.pm === 'npm' ? ['--', ...args] : args)]);
  },
  files: (i, port, b = DEFAULT_BUILD) => (b.mode === 'mixed' ? [] : [{ path: 'nginx.conf', content: nginxConf(port) }]),
  ci: (i, v, selected) => ci(i, selected, v, { testArgs }),
  buildNotes: (i, b) => [
    b.mode === 'production' && prebuilt(i, `${i.buildDir}/`),
    b.mode === 'mixed' && 'Build and production in one image: node builds the site and `serve` (installed globally) serves it; the image keeps node, your dependencies and the sources.',
  ],
  notes: (i, port, c) => [
    `Serving the static build from ${i.buildDir}/ (override with the build folder option).`,
    c.buildArgs.length === 0 &&
      "Build-time env vars (e.g. VITE_API_URL) can't be set at container runtime: add them as build args.",
    !i.scripts.build && 'package.json has no "build" script; the Docker build will fail without one.',
  ],
});

export const angular = spa('angular', {
  starterDir: (opts) => `dist/${opts.name ?? 'app'}/browser`,
  usesName: true,
  testArgs: '--watch=false --browsers=ChromeHeadless',
});

export const vue = spa('vue', {
  starterDir: () => 'dist',
});

export const react = spa('react', {
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
  variants: ['alpine', 'slim'],
  defaultVariant: 'alpine',
  healthKind: (b) => probeOf(b.variant),
  codeql: 'javascript-typescript',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/javascript-node:1-${i.version}`,
  ciSteps: CI_STEPS,
  ciDefaults: (i) => ciDefaults(i),
  ciNotes: (i, selected) => ciNotes(i, selected, {}),
  ignore: (b) => ignoreFor(b),
  starter: (opts) => starter(opts, { build: opts.build !== false, start: true }),
  dev(i, port, c) {
    const cmd = i.scripts.dev ? [i.pm, 'run', 'dev'] : i.scripts.start ? [i.pm, 'start'] : ['node', i.pkg.main ?? 'index.js'];
    return nodeDev(i, port, c, cmd);
  },
  assumes: (i) => `a "start" script that runs the server${i.scripts.build ? ', a "build" script (TypeScript/Next.js/...)' : ''}`,
  dockerfile(i, port, c, b = DEFAULT_BUILD) {
    const v = b.variant ?? 'alpine';
    const main = i.pkg.main ?? 'index.js';
    const cmd = i.scripts.start ? [i.pm, 'start'] : ['node', main];
    const env = `ENV NODE_ENV=production PORT=${port}`;
    if (b.mode === 'production') {
      // One runtime-only stage: production dependencies and the already built output.
      return lines(
        SYNTAX,
        `FROM node:${i.version}-${v}`,
        'WORKDIR /app',
        corepack(i),
        env,
        envLines(c),
        pkgs(c, v),
        manifest(i),
        `RUN ${install(i, true)}`,
        'COPY --chown=node:node . .',
        'USER node',
        `EXPOSE ${port}`,
        healthcheck(c, port, probeOf(v)),
        `CMD ${JSON.stringify(cmd)}`,
      );
    }
    if (b.mode === 'mixed') {
      // One stage with everything: all dependencies, the build, then the server.
      return lines(
        SYNTAX,
        `FROM node:${i.version}-${v}`,
        'WORKDIR /app',
        corepack(i),
        pkgs(c, v),
        manifest(i),
        `RUN ${install(i)}`,
        'COPY --chown=node:node . .',
        argLines(c),
        buildStep(i),
        env,
        envLines(c),
        'USER node',
        `EXPOSE ${port}`,
        healthcheck(c, port, probeOf(v)),
        `CMD ${JSON.stringify(cmd)}`,
      );
    }
    return lines(
      SYNTAX,
      `FROM node:${i.version}-${v} AS base`,
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
      env,
      envLines(c),
      pkgs(c, v),
      'COPY --from=build --chown=node:node /app ./',
      'COPY --from=deps --chown=node:node /app/node_modules ./node_modules',
      'USER node',
      `EXPOSE ${port}`,
      healthcheck(c, port, probeOf(v)),
      `CMD ${JSON.stringify(cmd)}`,
    );
  },
  buildNotes: (i, b) => [
    b.mode === 'production' && prebuilt(i, 'the build output'),
    b.mode === 'mixed' && 'Build and production in one image: it keeps your devDependencies and the sources next to the running server, so it is bigger than a multi-stage image.',
  ],
  ci: (i, v, selected) => ci(i, selected, v),
  notes: (i, port) => [
    `The app must listen on process.env.PORT (set to ${port}) and on 0.0.0.0, not just localhost.`,
  ],
};
