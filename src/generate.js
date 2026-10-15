import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { STACKS } from './stacks/index.js';
import { CI_FILES, CI_STEPS, buildPipeline, parseDeploySpec } from './ci.js';
import { TARGETS } from './deploy.js';
import { DBS, RESTART_POLICIES, assignDatabases, networksOf, parseNetworks, assignHostPorts, composeFile, composeOverride, dbInitFiles, envExample, isDevEnv, overrideName, usedDbs } from './compose.js';
import { deployApps } from './deploy.js';
import { appSlug, findStack, normalizeServices, parseServiceSpec, stackIds } from './services.js';
import { lines } from './fsutil.js';
import { EXTRAS, extraFiles } from './extras.js';
import { assemble, splitBlocks } from './blocks.js';
import { MODES, VARIANTS } from './container.js';

export { parseDeploySpec, parseServiceSpec, stackIds };
export { MODES, RESTART_POLICIES, VARIANTS };
export const STAGE_MODES = ['production', 'mixed'];

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

export const dbIds = () => Object.keys(DBS);
export const ciIds = () => Object.keys(CI_FILES);

export const stackInfo = () =>
  STACKS.map(({ id, port, backend, tools, usesName = false, usesBuild = false, usesBuildArgs = false, usesPackages = false, ciSteps, variants = [], defaultVariant = null }) => ({
    id,
    variants,
    defaultVariant,
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
function containerOptions(opts, stack, build) {
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
  const tcp = stack.healthKind ? stack.healthKind(build) === 'tcp' : ['dotnet', 'java', 'ruby'].includes(stack.id);
  if (healthcheck && tcp) {
    notes.push(`${stack.id} images have no curl or wget, so the healthcheck only checks that the port accepts connections.`);
  }
  return { c: { healthcheck, packages, env, buildArgs }, notes };
}

function checkTool(stack, opts) {
  if (opts.tool && !stack.tools.includes(opts.tool)) {
    throw new Error(
      stack.tools.length ? `${stack.id} supports --tool ${stack.tools.join(' | ')}` : `${stack.id} has no --tool option`,
    );
  }
}

// ---- services

/** Options that describe one service; anything else in a service object is a typo. */
const SERVICE_KEYS = ['name', 'dir', 'stack', 'port', 'runtime', 'tool', 'buildDir', 'project', 'healthcheck', 'packages', 'env', 'buildArgs', 'db', 'ciSteps', 'testVersions', 'imageVariant', 'multistage', 'stageMode', 'networks'];
/** Global options that only make sense for one service; with several they must be set per service. */
const SINGLE_ONLY = { port: '--port', runtime: '--runtime', tool: '--tool', buildDir: '--build-dir' };

const csvList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);

/**
 * What to generate for: [{ name, dir, stack, info, spec, opts }]. One service at the root of the project is the classic case
 * (named `app`, from `opts.stack`); several come from `opts.services`. Nothing is read from disk: every service names its stack
 * and its info is the stack's starter for the options.
 */
function resolveServices(opts) {
  if (opts.services?.length && opts.stack) throw new Error('--stack picks the stack of a single project; with several services give each one its own stack');
  if (!opts.services?.length) {
    if (!opts.stack) throw new Error(`choose a stack: ${stackIds().join(', ')}`);
    const stack = findStack(opts.stack);
    checkTool(stack, opts);
    return { multi: false, services: [{ name: 'app', dir: '.', stack, info: stack.starter(opts), spec: {}, opts }] };
  }
  for (const [key, flag] of Object.entries(SINGLE_ONLY)) {
    if (opts[key] != null) throw new Error(`${flag} applies to one service: with several services set it per service`);
  }
  const services = normalizeServices(opts.services).map((spec) => {
    const unknown = Object.keys(spec).find((k) => !SERVICE_KEYS.includes(k));
    if (unknown) throw new Error(`service ${spec.name}: unknown option "${unknown}"`);
    const o = { ...opts, ...Object.fromEntries(SERVICE_KEYS.filter((k) => spec[k] != null && k !== 'name' && k !== 'dir').map((k) => [k, spec[k]])), name: spec.project };
    delete o.services;
    for (const [key, pattern] of Object.entries(SAFE)) {
      if (o[key] != null && !pattern.test(o[key])) throw new Error(`service ${spec.name}: invalid ${key === 'name' ? 'project' : key} "${o[key]}"`);
    }
    if (!spec.stack) throw new Error(`service ${spec.name}: choose a stack (${stackIds().join(', ')})`);
    const stack = findStack(spec.stack);
    checkTool(stack, o);
    return { name: spec.name, dir: spec.dir, stack, info: stack.starter(o), spec, opts: o };
  });
  return { multi: true, services };
}

const oneOf = (what, values, allowed) => {
  const bad = values.find((v) => !allowed.includes(v));
  if (bad) throw new Error(`invalid ${what} "${bad}"; choose from: ${allowed.join(', ')}`);
};

function checkDbs(list) {
  for (const db of list) {
    if (!DBS[db]) throw new Error(`unknown database "${db}"; choose from: ${dbIds().join(', ')}`);
  }
  // Both are MySQL servers on port 3306: they would collide on the published port in development and in CI.
  if (list.includes('mysql') && list.includes('mariadb')) throw new Error('--db mysql and mariadb both listen on port 3306; pick one');
}

const ENV_NAME = /^[a-z][a-z0-9-]*$/;

function validate(opts) {
  const ci = opts.ci ?? 'github';
  if (ci !== 'none' && !CI_FILES[ci]) throw new Error(`unknown --ci "${ci}"; choose ${ciIds().join(', ')} or none`);
  checkDbs(opts.db ?? []);
  if (opts.port != null && !(Number.isInteger(opts.port) && opts.port > 0 && opts.port < 65536)) {
    throw new Error(`invalid --port "${opts.port}"`);
  }
  for (const [key, pattern] of Object.entries(SAFE)) {
    if (opts[key] != null && !pattern.test(opts[key])) throw new Error(`invalid ${key} "${opts[key]}"`);
  }
  if (ci === 'none' && opts.deploy && opts.deploy !== 'registry') {
    throw new Error('deploying needs a CI provider: choose github or gitlab, not none');
  }
  if (opts.ciSteps) oneOf('CI step', opts.ciSteps, Object.keys(CI_STEPS));
  if (opts.extras) oneOf('extra file', opts.extras, EXTRAS);
  if (opts.restart) oneOf('restart policy', [opts.restart], RESTART_POLICIES);
  if (opts.replicas != null && !(Number.isInteger(opts.replicas) && opts.replicas >= 1 && opts.replicas <= 100)) throw new Error(`invalid replicas "${opts.replicas}": 1-100`);
  if (opts.imageVariant) oneOf('image variant', [opts.imageVariant], VARIANTS);
  if (opts.stageMode) oneOf('single-stage mode', [opts.stageMode], STAGE_MODES);
  for (const env of opts.envs ?? []) {
    if (!ENV_NAME.test(env)) throw new Error(`invalid environment "${env}": lowercase letters, digits and dashes, for example dev, qa, prod`);
  }
  if (new Set(opts.envs ?? []).size !== (opts.envs ?? []).length) throw new Error('an environment is listed twice');
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

const portOk = (port) => Number.isInteger(port) && port > 0 && port < 65536;

/**
 * How the image is built: its flavor (`alpine` or `slim`, the stack's own default unless asked) and its mode: multi-stage (the
 * default), or one stage that is `production` only (runtime and what was built) or `mixed` (build tools and app together).
 */
function buildOf(stack, o) {
  const notes = [];
  const mode = o.multistage === false ? (o.stageMode === 'mixed' ? 'mixed' : 'production') : 'multi';
  let variant = stack.defaultVariant ?? null;
  if (o.imageVariant) {
    if (!stack.variants || stack.variants.includes(o.imageVariant)) variant = o.imageVariant;
    else notes.push(`${stack.id} has no ${o.imageVariant} image (${stack.variantNote ?? `only ${stack.variants.join(' and ')}`}), so ${variant} is used.`);
  }
  if (o.multistage !== false && o.stageMode) notes.push(`The ${o.stageMode} single-stage mode was ignored: multi-stage builds are on.`);
  return { build: { variant, mode }, notes };
}

/** Everything one service contributes, worked out from its own options (the global ones are its defaults). */
function buildUnit({ name, dir, stack, info, spec, opts: o }, { multi, envs }) {
  const port = o.port ?? stack.port;
  if (!portOk(port)) throw new Error(`invalid port "${o.port}"${multi ? ` for service ${name}` : ''}`);
  const dbList = o.db ?? [];
  if (spec.db) checkDbs(dbList);
  const dbs = stack.backend ? dbList : [];
  const build = buildOf(stack, o);
  const { c, notes: containerNotes } = containerOptions(o, stack, build.build);

  const available = stack.ciSteps ?? [];
  const requested = o.ciSteps ?? stack.ciDefaults?.(info) ?? [];
  const unavailable = requested.filter((step) => !available.includes(step));
  // A step list given for the whole project is trimmed per service; one given for a service must fit it.
  const strict = !multi || Boolean(spec.ciSteps);
  if (unavailable.length && strict) {
    throw new Error(`the ${unavailable[0]} CI step is not available for ${stack.id} (available: ${available.join(', ') || 'none'})`);
  }
  const selected = requested.filter((step) => available.includes(step));
  const versions = csvList(o.testVersions);

  const dev = envs.some(isDevEnv) ? stack.dev?.(info, port, c) : null;
  const notes = [
    `These files assume ${stack.assumes(info)}, and a lockfile or dependency list that you commit.`,
    selected.length > 0 && `The CI steps you enabled (${selected.join(', ')}) assume your project provides the matching scripts or tools.`,
    ...(stack.notes?.(info, port, c) ?? []),
    ...(stack.buildNotes?.(info, build.build) ?? []),
    ...build.notes,
    ...(stack.ciNotes?.(info, selected) ?? []),
    ...containerNotes,
    unavailable.length > 0 && `The ${unavailable.join(', ')} CI step${unavailable.length > 1 ? 's are' : ' is'} not available for ${stack.id} and ${unavailable.length > 1 ? 'were' : 'was'} left out.`,
    !stack.backend && (multi ? spec.db : o.db)?.length && 'Ignoring --db: static sites have no backend to connect to.',
    ...dbs.flatMap((db) => DBS[db].note ?? []),
    envs.some(isDevEnv) && !dev && `${stack.id} has no development Dockerfile, so the dev environment uses the production image.`,
    dev?.mode === 'watch' && `Development restarts ${name} through compose watch (docker compose ... watch, Compose 2.23+) instead of a bind mount: ${stack.id} is compiled.`,
  ].filter(Boolean);
  return {
    id: name,
    name,
    dir,
    prefix: dir === '.' ? '' : `${dir}/`,
    stack,
    info,
    port,
    c,
    dbs,
    selected,
    available,
    versions,
    spec,
    dev,
    build: build.build,
    notes: multi ? notes.map((n) => `${name}: ${n}`) : notes,
  };
}

const ENV_ALIASES = { production: ['prod'], staging: ['stage'] };
/** The compose environment the pipeline deploys: the one that carries the pipeline's environment name (or its usual short form). */
const deployEnvironment = (envs, environment) => envs.find((e) => !isDevEnv(e) && (e === environment || ENV_ALIASES[environment]?.includes(e)));

/**
 * Pure: returns { stack, files: [{ kind, path, content }], notes, services }. Writes nothing.
 * Nothing is read from a project: the stack comes from `opts.stack` (or each service's) and its tool/runtime/name options.
 * `dir`, the folder the files are going to be written to, is optional and only consulted for an existing compose file name.
 * One project can hold several services (see resolveServices): each gets its own Dockerfile, the compose file and the
 * pipeline cover all of them, and `opts.envs` adds a compose override (and a Dockerfile.dev) per environment.
 */
export function generate(dir, opts = {}) {
  const ci = validate(opts);
  const resolved = resolveServices(opts);
  const { multi } = resolved;
  const envs = opts.envs ?? [];
  const units = resolved.services.map((svc) => buildUnit(svc, { multi, envs }));
  if (multi && csvList(opts.testVersions).length && new Set(units.map((u) => u.stack.id)).size > 1 && units.some((u) => !u.spec.testVersions)) {
    throw new Error('--test-versions lists the runtime versions of one stack: with mixed stacks set testVersions per service');
  }
  const stacks = units.map((u) => u.stack);

  const notes = [
    ...units.flatMap((u) => u.notes),
    units.some((u) => u.dbs.length) &&
      'Service URLs are injected as DATABASE_URL / MONGO_URL / REDIS_URL / AMQP_URL / MEMCACHED_URL / ELASTICSEARCH_URL / SMTP_URL; map them to your framework\'s config.',
  ].filter(Boolean);

  const appName = appSlug(opts.name ?? (dir && basename(dir)));
  const composePath = composeName(dir);
  // The compose files a deployment to `environment` layers: the base, plus the override of the same name when there is one.
  const composeFor = (environment) => {
    const env = deployEnvironment(envs, environment);
    return [composePath, ...(env ? [overrideName(composePath, env)] : [])];
  };

  const base = units.map((u) => ({
    id: u.name,
    dir: u.dir,
    file: 'Dockerfile',
    port: u.port,
    backend: u.stack.backend,
    dbs: u.dbs,
    buildArgs: u.c.buildArgs,
    healthcheck: u.c.healthcheck,
    versions: u.versions,
    selected: u.selected,
    stackId: u.stack.id,
    ci: (v) => u.stack.ci(u.info, v, u.selected),
    dev: u.dev,
  }));
  const perService = Boolean(opts.dbPerService) && units.length > 1;
  if (opts.dbPerService && units.length < 2) notes.push('A database per service was ignored: there is a single service.');
  // Networks: none declared keeps compose's single default network. Declared ones are joined by name; a service lists its own
  // (`networks`), else the project-wide `appNetworks`, else all of them. Databases and queues join `dbNetworks`, else all.
  const networks = parseNetworks(opts.networks ?? []);
  const withNetworks = base.map((a, i) => ({
    ...a,
    ...(networks.length > 0 && { networks: networksOf(units[i].spec.networks ?? opts.appNetworks, networks, `service ${a.id}`) }),
  }));
  const dbNetworks = networks.length > 0 ? networksOf(opts.dbNetworks, networks, 'the databases') : [];
  if (!networks.length && (opts.appNetworks?.length || opts.dbNetworks?.length || units.some((u) => u.spec.networks?.length))) {
    notes.push('Networks were chosen but none is declared, so compose keeps its single default network.');
  }
  const outside = networks.filter((n) => n.external).map((n) => n.name);
  if (outside.length) notes.push(`Compose does not create the external network${outside.length > 1 ? 's' : ''} ${outside.join(', ')}: create ${outside.length > 1 ? 'them' : 'it'} first (docker network create ${outside[0]}).`);
  const internal = new Set(networks.filter((n) => n.internal).map((n) => n.name));
  for (const a of withNetworks) {
    if (a.networks?.length && a.networks.every((n) => internal.has(n))) {
      notes.push(`${a.id} is only on internal networks, so the port it publishes is not reachable from the host: add a network that is not internal to publish it.`);
    }
  }
  const apps = deployApps(appName, assignDatabases(assignHostPorts(withNetworks), perService));
  if (perService) {
    notes.push(
      `Each service has its own database on the shared server (${apps.filter((a) => a.dbs.length).map((a) => `${a.id} -> ${a.dbName}`).join(', ')}); SQL ones are created by db/<engine>/init.sql, which only runs when the data volume is first created, so add CREATE DATABASE by hand for a service added later (or recreate the volume). Redis services use separate numbered databases.`,
    );
  }
  if (multi) {
    for (const app of apps) if (app.hostPort !== app.port) notes.push(`${app.id}: port ${app.port} is already used by another service, so compose publishes it on host port ${app.hostPort}.`);
    notes.push(`Services reach each other by name inside compose: ${apps.map((a) => `http://${a.id}:${a.port}`).join(', ')}.`);
  }

  const pipeline =
    ci === 'none'
      ? null
      : buildPipeline({ ...opts, ci }, { appName, composeFile: composePath, composeFor, apps });
  if (pipeline && (!opts.include || opts.include.includes('ci'))) {
    notes.push(...pipeline.notes);
    if (pipeline.codeScan && ci === 'github') {
      const unsupported = stacks.filter((s) => !s.codeql).map((s) => s.id);
      if (unsupported.length === stacks.length) notes.push(`CodeQL does not support ${[...new Set(unsupported)].join(', ')}, so no CodeQL workflow was generated.`);
      else {
        notes.push('CodeQL runs from its own workflow (.github/workflows/codeql.yml); results appear under Security > Code scanning.');
        if (unsupported.length) notes.push(`CodeQL does not support ${[...new Set(unsupported)].join(', ')}, which it skips.`);
      }
    }
  }

  const dbs = usedDbs(apps);
  if (pipeline?.targetId === 'kubernetes' && dbs.length && (!opts.include || opts.include.includes('deploy'))) {
    notes.push(`Kubernetes does not get the compose services (${dbs.join(', ')}): run them in the cluster or use managed ones, then put their URLs (DATABASE_URL, REDIS_URL, ...) in the ${apps.map((a) => `${a.name}-env`).join(' / ')} Secret${apps.length > 1 ? 's' : ''}.`);
  }
  if (envs.length) {
    notes.push(
      `Environments are compose files layered over ${composePath}: ${envs.map((e) => `docker compose -f ${composePath} -f ${overrideName(composePath, e)} up`).join('; ')}.`,
    );
    if (envs.some((e) => !isDevEnv(e))) notes.push('Environments other than dev read an optional .env.<name> next to the compose file (it is never copied into an image).');
    for (const d of pipeline?.deployments ?? []) {
      const files = d.composeFiles;
      if (files.length > 1 && pipeline.target.composeImage) notes.push(`The ssh deploy to ${d.name} uses ${files[1]} on top of ${files[0]}.`);
    }
  }

  const extras = extraFiles(opts.extras ?? [], {
    units,
    provider: ci,
    appName,
    composeFile: composePath,
    envs,
  });
  if (!opts.include || opts.include.includes('repo')) notes.push(...extras.notes);

  const env = envExample(dbs);
  const generated = [
    ...units.flatMap((u) => [
      { kind: 'dockerfile', path: `${u.prefix}Dockerfile`, content: u.stack.dockerfile(u.info, u.port, u.c, u.build) },
      { kind: 'dockerignore', path: `${u.prefix}.dockerignore`, content: lines(COMMON_IGNORE, envs.length > 0 && 'Dockerfile.*', typeof u.stack.ignore === 'function' ? u.stack.ignore(u.build, u.info) : u.stack.ignore) },
    ]),
    {
      kind: 'compose',
      path: composePath,
      content: composeFile(apps, { appName, image: pipeline?.target.composeImage ? appName : null, perService, restart: opts.restart, networks, dbNetworks }),
    },
    ...(perService ? dbInitFiles(apps).map((f) => ({ kind: 'compose', ...f })) : []),
    env && { kind: 'compose', path: '.env.example', content: env },
    ...envs.map((e) => ({ kind: 'compose', path: overrideName(composePath, e), content: composeOverride(e, apps) })),
    ...units.flatMap((u) => [
      ...(u.stack.files?.(u.info, u.port, u.build) ?? []).map((f) => ({ kind: 'dockerfile', ...f, path: `${u.prefix}${f.path}` })),
      ...(u.dev ? envs.filter(isDevEnv).map((e) => ({ kind: 'dockerfile', path: `${u.prefix}Dockerfile.${e}`, content: u.dev.dockerfile })) : []),
    ]),
    pipeline && { kind: 'ci', path: CI_FILES[ci].path, blocks: CI_FILES[ci].render(pipeline) },
    ...(pipeline ? (CI_FILES[ci].extraFiles?.(pipeline, stacks) ?? []) : []).map((f) => ({ kind: 'ci', ...f })),
    ...(pipeline?.target.files?.({ appName, apps: pipeline.apps, replicas: opts.replicas }) ?? []).map((f) => ({ kind: 'deploy', ...f })),
    ...extras.files,
  ].filter((f) => f && (!opts.include || opts.include.includes(f.kind)));

  const files = applyEdits(generated, opts.edits ?? {}, notes);
  const first = units[0];
  return {
    stack: first.stack.id,
    files,
    notes,
    ci: { available: first.available, selected: first.selected },
    multi,
    services: units.map((u, i) => ({
      name: u.name,
      dir: u.dir,
      stack: u.stack.id,
      port: u.port,
      hostPort: apps[i].hostPort,
      backend: u.stack.backend,
      db: u.dbs,
      ci: { available: u.available, selected: u.selected },
    })),
  };
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
