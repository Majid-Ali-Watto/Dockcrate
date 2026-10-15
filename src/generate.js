import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { STACKS } from './stacks/index.js';
import { CI_FILES, buildPipeline } from './ci.js';
import { TARGETS } from './deploy.js';
import { DBS, composeFile, envExample } from './compose.js';
import { lines } from './fsutil.js';
import { EXTRAS, extraFiles } from './extras.js';
import { assemble, splitBlocks } from './blocks.js';

const COMMON_IGNORE = [
  '.git',
  '.gitignore',
  '.github',
  '.gitlab-ci.yml',
  'Dockerfile',
  'docker-compose*.y*ml',
  'compose.y*ml',
  '.dockerignore',
  '.env',
  '.env.*',
  '!.env.example',
  '.vscode',
  '.idea',
];

// Compose accepts several file names; reuse the one the project already has instead of adding a duplicate.
const COMPOSE_NAMES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'];
const composeName = (dir) => (dir && COMPOSE_NAMES.find((n) => existsSync(join(dir, n)))) || COMPOSE_NAMES[0];

/** File groups the user can switch on and off. Each generated file belongs to exactly one. */
export const KINDS = ['dockerfile', 'dockerignore', 'compose', 'ci', 'deploy', 'repo'];

export { EXTRAS };

// Values that end up inside generated files; keep them to harmless characters.
const SAFE = {
  runtime: /^[\w.-]+$/,
  name: /^[A-Za-z][\w.-]*$/,
  buildDir: /^[\w./-]+$/,
};

export { PERMISSIONS, TEST_OS, PLATFORMS, CONCURRENCY, DEPLOY_ON, IMAGE_TAGS, SEVERITIES, REGISTRY_CHOICES, targetIds, targetInfo, registryInfo, providerInfo } from './ci.js';

export const stackIds = () => STACKS.map((s) => s.id);
export const dbIds = () => Object.keys(DBS);
export const ciIds = () => Object.keys(CI_FILES);

/** Lowercase DNS-style name for image repositories and Kubernetes/Fly/ECS resources. */
function appSlug(raw) {
  const slug = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return 'app';
  return /^[a-z]/.test(slug) ? slug : `app-${slug}`;
}
export const stackInfo = () =>
  STACKS.map(({ id, port, backend, tools, usesName = false, usesBuild = false, usesBuildArgs = false, usesPackages = false, ciSteps }) => ({
    id,
    port,
    backend,
    tools,
    usesName,
    usesBuild,
    usesBuildArgs,
    usesPackages,
    ciSteps,
  }));

// ---- container options (healthcheck, OS packages, env vars, build args)

const PACKAGE = /^[a-z0-9][a-z0-9+.-]*$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEALTH_PATH = /^\/[\w./~-]*$/;

const lineItems = (raw, split) =>
  (Array.isArray(raw) ? raw : String(raw).split(split)).map((s) => String(s).trim()).filter((s) => s && !s.startsWith('#'));

function keyValue(item, what) {
  const at = item.indexOf('=');
  const key = (at < 0 ? item : item.slice(0, at)).trim();
  if (!ENV_KEY.test(key)) throw new Error(`invalid ${what} "${item}": use NAME or NAME=value`);
  return [key, at < 0 ? undefined : item.slice(at + 1)];
}

/** Validates the container options and drops the ones the stack cannot use (with a note). */
function containerOptions(opts, stack) {
  const notes = [];
  const healthcheck = opts.healthcheck ?? '';
  if (healthcheck && !HEALTH_PATH.test(healthcheck)) throw new Error(`invalid healthcheck path "${healthcheck}": use /health`);

  let packages = lineItems(opts.packages ?? [], /[\s,]+/);
  for (const name of packages) if (!PACKAGE.test(name)) throw new Error(`invalid package "${name}"`);
  if (packages.length && !stack.usesPackages) {
    notes.push('OS packages are not installed: this image is a static nginx site.');
    packages = [];
  }

  let env = lineItems(opts.env ?? [], '\n').map((item) => {
    const [key, value] = keyValue(item, 'environment variable');
    if (value === undefined) throw new Error(`invalid environment variable "${item}": use NAME=value`);
    return [key, value];
  });
  if (env.length && !stack.backend) {
    notes.push('Runtime environment variables were ignored: a static site has no runtime. Use build args instead.');
    env = [];
  }

  let buildArgs = lineItems(opts.buildArgs ?? [], /[\n,]+/).map((item) => {
    const [name, value] = keyValue(item, 'build arg');
    return { name, value };
  });
  if (buildArgs.length && !stack.usesBuildArgs) {
    notes.push('Build args apply to Node and static-site images only and were ignored.');
    buildArgs = [];
  }
  if (healthcheck && ['dotnet', 'java', 'ruby'].includes(stack.id)) {
    notes.push(`${stack.id} images have no curl or wget, so the healthcheck only checks that the port accepts connections.`);
  }
  return { c: { healthcheck, packages, env, buildArgs }, notes };
}

function findStack(id) {
  const stack = STACKS.find((s) => s.id === id);
  if (!stack) throw new Error(`unknown stack "${id}"; choose one of: ${stackIds().join(', ')}`);
  return stack;
}

function resolveStack(dir, opts) {
  if (opts.isNew) {
    if (!opts.stack) throw new Error(`choose a stack for a new project: ${stackIds().join(', ')}`);
    const stack = findStack(opts.stack);
    if (opts.tool && !stack.tools.includes(opts.tool)) {
      throw new Error(
        stack.tools.length
          ? `${stack.id} supports --tool ${stack.tools.join(' | ')}`
          : `${stack.id} has no --tool option`,
      );
    }
    return { stack, info: stack.starter(opts), others: [] };
  }
  if (opts.stack) {
    const stack = findStack(opts.stack);
    const info = stack.detect(dir, opts);
    if (!info) throw new Error(`no ${stack.id} project found in ${dir}`);
    return { stack, info, others: [] };
  }
  const hits = STACKS.flatMap((stack) => {
    const info = stack.detect(dir, opts);
    return info ? [{ stack, info }] : [];
  });
  if (!hits.length) {
    throw new Error(`could not detect a supported project in ${dir}; pass --stack <${stackIds().join('|')}>`);
  }
  const others = hits.slice(1).filter((h) => !h.stack.fallback).map((h) => h.stack.id);
  return { ...hits[0], others };
}

/** Stack id detected in `dir`, or null when nothing (or an unusable project) is found. */
export function detectStack(dir) {
  try {
    return resolveStack(dir, {}).stack.id;
  } catch {
    return null;
  }
}

const oneOf = (what, values, allowed) => {
  const bad = values.find((v) => !allowed.includes(v));
  if (bad) throw new Error(`invalid ${what} "${bad}"; choose from: ${allowed.join(', ')}`);
};

function validate(opts) {
  const ci = opts.ci ?? 'github';
  if (ci !== 'none' && !CI_FILES[ci]) throw new Error(`unknown --ci "${ci}"; choose ${ciIds().join(', ')} or none`);
  for (const db of opts.db ?? []) {
    if (!DBS[db]) throw new Error(`unknown database "${db}"; choose from: ${dbIds().join(', ')}`);
  }
  const sql = (opts.db ?? []).filter((db) => ['postgres', 'mysql', 'mariadb'].includes(db));
  if (sql.length > 1) throw new Error(`--db ${sql.join(' and ')} would both define DATABASE_URL; pick one`);
  if (opts.port != null && !(Number.isInteger(opts.port) && opts.port > 0 && opts.port < 65536)) {
    throw new Error(`invalid --port "${opts.port}"`);
  }
  for (const [key, pattern] of Object.entries(SAFE)) {
    if (opts[key] != null && !pattern.test(opts[key])) throw new Error(`invalid ${key} "${opts[key]}"`);
  }
  if (ci === 'none' && opts.deploy && opts.deploy !== 'registry') {
    throw new Error('deploying needs a CI provider: choose github or gitlab, not none');
  }
  if (opts.ciSteps) oneOf('CI step', opts.ciSteps, ['lint', 'test', 'build', 'audit']);
  if (opts.extras) oneOf('extra file', opts.extras, EXTRAS);
  if (opts.include) {
    const unknown = opts.include.find((k) => !KINDS.includes(k));
    if (unknown) throw new Error(`unknown file group "${unknown}"; choose from: ${KINDS.join(', ')}`);
    if (!opts.include.length) throw new Error('select at least one file group');
  }
  return ci;
}

const CUSTOM_PATH = /^(?!.*\.\.)[\w.-]+(\/[\w.-]+)*$/;
const MAX_CUSTOM = 32 * 1024;

/**
 * Splits every file into blocks and applies the user's edits (see assemble in blocks.js). An edit for a path that
 * is not generated and only adds blocks becomes a new file of its own, so any file can be added.
 */
function applyEdits(generated, edits, notes) {
  if (typeof edits !== 'object' || edits === null || Array.isArray(edits)) throw new Error('edits must be an object keyed by file path');
  const files = [];
  for (const f of generated) {
    const r = assemble(f.blocks ?? splitBlocks(f.path, f.content), edits[f.path]);
    for (const id of r.unknown) notes.push(`Your edit of block "${id}" in ${f.path} no longer matches any generated block and was ignored.`);
    if (edits[f.path]?.disabled) continue;
    files.push({ kind: f.kind, path: f.path, content: r.content, blocks: r.blocks });
  }
  for (const [path, edit] of Object.entries(edits)) {
    if (generated.some((f) => f.path === path) || !edit?.add?.length) continue;
    if (!CUSTOM_PATH.test(path) || path.split('/').includes('.git')) throw new Error(`invalid custom file path "${path}"`);
    const r = assemble([], edit);
    if (r.content.length > MAX_CUSTOM) throw new Error(`custom file ${path} is too large`);
    files.push({ kind: 'custom', path, content: r.content, blocks: r.blocks });
  }
  return files;
}

/**
 * Pure: returns { stack, files: [{ kind, path, content }], notes }. Writes nothing.
 * With `opts.isNew` no project is read: the stack comes from `opts.stack` and its tool/runtime/name options,
 * and `dir` (optional) is only consulted for an existing compose file name.
 */
export function generate(dir, opts = {}) {
  const ci = validate(opts);
  const { stack, info, others } = resolveStack(dir, opts);
  const port = opts.port ?? stack.port;
  const dbs = stack.backend ? (opts.db ?? []) : [];
  const { c, notes: containerNotes } = containerOptions(opts, stack);

  const available = stack.ciSteps ?? [];
  const selected = opts.ciSteps ?? stack.ciDefaults?.(info) ?? [];
  const unavailable = selected.find((step) => !available.includes(step));
  if (unavailable) throw new Error(`the ${unavailable} CI step is not available for ${stack.id} (available: ${available.join(', ') || 'none'})`);

  const notes = [
    opts.isNew && `New project: these files assume ${stack.assumes(info)}, and a lockfile or dependency list that you commit.`,
    opts.isNew && selected.length > 0 && `The CI steps you enabled (${selected.join(', ')}) assume your project provides the matching scripts or tools.`,
    ...(stack.notes?.(info, port, c) ?? []),
    ...(stack.ciNotes?.(info, selected) ?? []),
    ...containerNotes,
    others.length && `Also matched: ${others.join(', ')}. Pass --stack to choose another.`,
    !stack.backend && opts.db?.length && 'Ignoring --db: static sites have no backend to connect to.',
    dbs.length && 'Service URLs are injected as DATABASE_URL / MONGO_URL / REDIS_URL / AMQP_URL / MEMCACHED_URL / ELASTICSEARCH_URL / SMTP_URL; map them to your framework\'s config.',
    ...dbs.flatMap((name) => DBS[name].note ?? []),
  ].filter(Boolean);

  const appName = appSlug(opts.isNew && opts.name ? opts.name : dir && basename(dir));
  const composePath = composeName(dir);
  const pipeline =
    ci === 'none'
      ? null
      : buildPipeline({ ...opts, ci }, { appName, port, composeFile: composePath, buildArgs: c.buildArgs.map((a) => a.name) });
  if (pipeline && (!opts.include || opts.include.includes('ci'))) {
    notes.push(...pipeline.notes);
    if (pipeline.codeScan && ci === 'github') {
      notes.push(
        stack.codeql
          ? 'CodeQL runs from its own workflow (.github/workflows/codeql.yml); results appear under Security > Code scanning.'
          : `CodeQL does not support ${stack.id}, so no CodeQL workflow was generated.`,
      );
    }
  }

  const extras = extraFiles(opts.extras ?? [], { stack, info, provider: ci, appName, port, composeFile: composePath });
  if (!opts.include || opts.include.includes('repo')) notes.push(...extras.notes);

  const env = envExample(dbs);
  const generated = [
    { kind: 'dockerfile', path: 'Dockerfile', content: stack.dockerfile(info, port, c) },
    { kind: 'dockerignore', path: '.dockerignore', content: lines(COMMON_IGNORE, stack.ignore) },
    {
      kind: 'compose',
      path: composePath,
      content: composeFile(port, dbs, { image: pipeline?.target.composeImage ? appName : null, buildArgs: c.buildArgs }),
    },
    env && { kind: 'compose', path: '.env.example', content: env },
    ...(stack.files?.(info, port) ?? []).map((f) => ({ kind: 'dockerfile', ...f })),
    pipeline && { kind: 'ci', path: CI_FILES[ci].path, blocks: CI_FILES[ci].render(pipeline, (v) => stack.ci(info, v, selected)) },
    ...(pipeline ? (CI_FILES[ci].extraFiles?.(pipeline, stack) ?? []) : []).map((f) => ({ kind: 'ci', ...f })),
    ...(pipeline?.target.files?.({ appName, port }) ?? []).map((f) => ({ kind: 'deploy', ...f })),
    ...extras.files,
  ].filter((f) => f && (!opts.include || opts.include.includes(f.kind)));

  const files = applyEdits(generated, opts.edits ?? {}, notes);
  return { stack: stack.id, files, notes, ci: { available, selected } };
}

/** Writes files under `dir`; existing files are kept unless `force`. Returns [{ path, status }]. */
export function writeFiles(dir, files, { force = false } = {}) {
  return files.map(({ path, content }) => {
    const target = join(dir, path);
    if (existsSync(target) && !force) return { path, status: 'skipped' };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return { path, status: 'written' };
  });
}
