export const STACK_ORDER = ['node', 'react', 'vue', 'angular', 'fastapi', 'django', 'dotnet', 'java', 'go', 'rust', 'php', 'ruby'];

export const LABELS = {
  kinds: {
    dockerfile: 'Dockerfile (+ nginx.conf for static sites)',
    dockerignore: '.dockerignore',
    compose: 'Docker Compose (+ .env.example)',
    ci: 'CI/CD pipeline',
    deploy: 'Deployment config (k8s manifests, fly.toml, ECS task definition)',
    repo: 'Extra project files (choose below; none by default)',
  },
  extras: {
    dependabot: 'Dependency updates (Dependabot, or Renovate off GitHub)',
    devcontainer: 'Dev container (.devcontainer/devcontainer.json)',
    makefile: 'Makefile with docker and compose shortcuts',
    editorconfig: '.editorconfig',
  },
  steps: { lint: 'Lint', test: 'Tests', build: 'Build', audit: 'Dependency audit' },
  imageTags: { branch: 'Branch name', tag: 'Git tag', semver: 'Semantic version from the tag (1.2.3, 1.2)', latest: 'latest (default branch)' },
  severities: { UNKNOWN: 'UNKNOWN', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' },
  cloudAuth: { oidc: 'OIDC: short-lived tokens, no stored keys (recommended)', keys: 'Stored keys in CI secrets' },
  concurrency: {
    prs: 'Cancel superseded pull-request runs (recommended)',
    always: 'Cancel every superseded run',
    queue: 'Queue runs, never cancel',
    off: 'No concurrency control',
  },
  envs: { dev: 'dev (Dockerfile.dev, source mounted, live reload)', qa: 'qa', staging: 'staging', prod: 'prod' },
  variants: { '': 'Default (each stack\'s own)', alpine: 'Alpine: smallest, musl libc', slim: 'Slim: Debian-based, most compatible' },
  stageModes: {
    production: 'Production only: a runtime image with production dependencies and no build tools',
    mixed: 'Build and production mixed: builds inside the image, simplest, bigger',
  },
  restart: { '': 'Default (unless-stopped)', 'unless-stopped': 'unless-stopped', always: 'always', 'on-failure': 'on-failure', no: 'no (never)' },
  deployOn: { branch: 'A push to the default branch', tag: 'A tag is pushed', manual: 'Manual run only' },
  permissions: {
    'contents-write': 'contents: write',
    'pull-requests-write': 'pull-requests: write',
    'packages-write': 'packages: write',
    'id-token-write': 'id-token: write (OIDC login to the cloud)',
  },
  nameHints: {
    angular: 'Used for the build output folder: dist/<name>/browser',
    django: 'The Django project package that contains wsgi.py (default: config)',
    dotnet: 'The .csproj and assembly name (default: App)',
  },
  namePlaceholders: { angular: 'app', django: 'config', dotnet: 'App' },
};

/** Runtime versions offered per stack, for the Runtime dropdown and the CI test matrix. */
export const RUNTIMES = {
  node: ['18', '20', '22', '24'], react: ['18', '20', '22', '24'], vue: ['18', '20', '22', '24'], angular: ['20', '22', '24'],
  fastapi: ['3.10', '3.11', '3.12', '3.13'], django: ['3.10', '3.11', '3.12', '3.13'],
  dotnet: ['8.0', '9.0', '10.0'], java: ['11', '17', '21', '25'], go: ['1.23', '1.24', '1.25'],
  rust: ['1'], php: ['8.2', '8.3', '8.4'], ruby: ['3.2', '3.3', '3.4'],
};

/** Runner / agent labels per provider: what an empty value means, and the common alternatives. */
export const RUNNERS = {
  github: { default: 'ubuntu-latest', options: ['ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-24.04-arm', 'self-hosted'] },
  azure: { default: 'ubuntu-latest', options: ['ubuntu-24.04', 'ubuntu-22.04'] },
  jenkins: { default: 'any agent', options: ['docker', 'linux'] },
};
RUNNERS.gitea = RUNNERS.github;

// Values must satisfy the generator's own checks (src/ci.js GLOB, CRON, NAME).
export const PRESETS = {
  ports: ['80', '3000', '4000', '5000', '8000', '8080', '8081', '9000'],
  healthchecks: ['/health', '/healthz', '/ready', '/ping', '/status', '/api/health', '/'],
  buildDirs: ['dist', 'build', 'out', 'public', '.output', 'www'],
  packages: ['curl', 'wget', 'ca-certificates', 'tini', 'bash', 'git', 'openssl', 'tzdata'],
  pipelineNames: ['CI', 'Build', 'Build and test', 'Docker', 'Test', 'Release'],
  branches: ['main', 'master', 'develop', 'staging', 'production', 'release/*', 'hotfix/*', 'feature/*'],
  branchesIgnore: ['gh-pages', 'dependabot/**', 'renovate/**', 'wip/*'],
  tags: ['v*', 'v*.*.*', '*.*.*', 'release-*'],
  tagsIgnore: ['v*-rc*', 'v*-beta*', 'v*-alpha*', '*-dev'],
  prBranches: ['main', 'master', 'develop', 'release/*'],
  paths: ['src/**', 'app/**', 'Dockerfile', 'package*.json', 'requirements*.txt', 'docker-compose*.yml'],
  pathsIgnore: ['**.md', 'docs/**', 'LICENSE', '.gitignore', '.editorconfig', '.vscode/**'],
  timeouts: ['5', '10', '15', '20', '30', '45', '60', '120'],
  environments: ['production', 'staging', 'development', 'preview', 'test'],
  schedules: [
    { value: '0 3 * * *', label: 'Every night at 03:00' },
    { value: '0 6 * * 1-5', label: 'Weekdays at 06:00' },
    { value: '0 3 * * 1', label: 'Every Monday at 03:00' },
    { value: '0 0 * * 0', label: 'Every Sunday at midnight' },
    { value: '0 */6 * * *', label: 'Every 6 hours' },
    { value: '0 0 1 * *', label: 'First day of the month' },
  ],
};

export function initialForm(meta) {
  return {
    stack: 'node',
    tool: '',
    name: '',
    build: true,
    include: meta.kinds,
    services: null, // null = what was detected; an array of { name, dir, stack, port?, db? } once the user edits the list
    envs: [], // compose environments: dev, qa, prod, ...
    networks: [], // compose networks: [{ name, internal, external }]; none = compose's default network
    appNetworks: [], // the ones every service joins; none = all declared
    dbNetworks: [], // the ones databases and queues join; none = all declared
    restart: '', // compose restart policy; '' = unless-stopped
    replicas: '', // Kubernetes replicas; '' = 2
    imageVariant: '', // '' = each stack's own base image, or alpine / slim
    multistage: true, // false: a single stage, see stageMode
    stageMode: 'production', // single stage only: production | mixed
    dbPerService: false, // several services: a database each on the shared server
    changedOnly: false, // several services: test, build and deploy only what changed
    sharedPaths: [], // paths that rebuild every service when changedOnly
    extras: [],
    db: [],
    port: '',
    runtime: '',
    buildDir: '',
    // container
    healthcheck: '',
    packages: [],
    env: '',
    buildArgs: '',
    // CI
    ci: 'github',
    ciSteps: null, // null = whatever the project defines; an array once the user touches a checkbox
    ciServices: [],
    scan: false,
    lintDockerfile: false,
    sbom: false,
    sign: false,
    codeScan: false,
    // deployment
    deploy: 'registry',
    registry: 'builtin',
    deployOn: 'branch',
    environment: '',
    deployTo: [], // several environments: [{ name, on, match? }]
    // pipeline
    pipelineName: 'CI',
    branches: ['main'],
    branchesIgnore: [],
    tags: ['v*'],
    tagsIgnore: [],
    pushEvent: true, // a push to a branch starts the pipeline
    tagEvent: true, // a pushed tag starts it
    scheduleEvent: false,
    pullRequests: true,
    prBranches: [],
    paths: [],
    pathsIgnore: [],
    release: false,
    manual: false,
    schedule: [],
    runner: '',
    timeout: '',
    failFast: false,
    testJob: true,
    pipelineEnv: '',
    imageTags: ['branch', 'tag', 'latest'],
    scanSeverity: ['HIGH', 'CRITICAL'],
    depCache: true,
    pinActions: true,
    layerCache: true,
    edits: {}, // { [file path]: { disabled?, blocks: { [id]: { text?, disabled?, from? } }, add: [...] } }
    concurrency: 'prs',
    cloudAuth: 'oidc',
    testVersions: [],
    testOs: [],
    permissions: [],
    platforms: ['linux/amd64'],
  };
}

/** Which controls apply to the current selection. Everything else is hidden rather than disabled. */
export function visibility(form, meta, result) {
  const stack = meta.stacks.find((s) => s.id === form.stack);
  const target = meta.targets.find((t) => t.id === form.deploy);
  const ci = form.include.includes('ci');
  const provider = meta.providers.find((p) => p.id === form.ci) ?? meta.providers[0];
  const can = (feature) => provider.features.includes(feature);
  const github = form.ci === 'github';
  // Several services: the user's list.
  const services = form.services?.length ? form.services : null;
  const multi = Boolean(services);
  const stackOf = (id) => meta.stacks.find((s) => s.id === id);
  const kinds = multi ? services.map((s) => stackOf(s.stack)).filter(Boolean) : stack ? [stack] : [];
  const some = (key) => kinds.some((s) => s[key]);
  const sameStack = new Set(services?.map((s) => s.stack)).size <= 1;
  const backend = multi ? true : stack ? stack.backend : true;
  // Flavors the selected stack(s) come in: a stack with only one (PHP runs Apache) has nothing to choose.
  const variants = [...new Set(kinds.flatMap((s) => s.variants ?? []))];
  return {
    variants,
    multi,
    services,
    sameStack,
    stack: multi ? undefined : stack,
    target,
    ci,
    github,
    provider,
    can,
    backend,
    tool: !multi && Boolean(stack?.tools.length),
    name: !multi && Boolean(stack?.usesName),
    // The project name names the images and deployed resources; stacks that also use it in their own files show it with their hint.
    projectName: multi || !stack?.usesName,
    buildToggle: !multi && Boolean(stack?.usesBuild),
    buildDir: !multi && Boolean(stack) && !stack.backend,
    databases: backend,
    packages: multi ? some('usesPackages') : Boolean(stack?.usesPackages),
    env: multi ? kinds.some((s) => s.backend) : backend,
    buildArgs: multi ? some('usesBuildArgs') : Boolean(stack?.usesBuildArgs),
    // Runtime versions are those of one stack: several services only share a list when they share a stack.
    versions: !multi || sameStack,
    versionStack: multi ? services[0]?.stack : stack?.id,
    compose: form.include.includes('compose') || form.include.includes('dockerfile'),
    extras: form.include.includes('repo'),
    registryChoice: ci && target?.registry === 'builtin',
    // A target that logs in again from the server (ssh) can only reuse username/token registries.
    registries: meta.registries.filter((r) => (!target?.serverLogin || r.serverLogin) && (r.id !== 'builtin' || provider.builtinRegistry)),
    imageSupply: ci && Boolean(target?.registry),
    deployConfig: ci && Boolean(target?.files),
    deployMore: ci && Boolean(target?.deploys),
    // GitHub signs in to a cloud with OIDC or a stored key: a cloud target, or a cloud registry picked for a generic one.
    oidc: ci && github && (Boolean(target?.oidc) || (target?.registry === 'builtin' && Boolean(meta.registries.find((r) => r.id === form.registry)?.oidc))),
    ciSteps: multi
      ? [...new Set(services.flatMap((s) => s.ci?.available ?? stackOf(s.stack)?.ciSteps ?? ['lint', 'test', 'build', 'audit']))]
      : (result?.ci?.available ?? stack?.ciSteps ?? []),
  };
}

/** The request body for the current form, leaving out settings that are hidden. */
export function toBody(form, show) {
  const several = show.multi;
  const body = {
    // With several services these belong to each service, so none of them is sent for the whole project.
    stack: several ? '' : form.stack,
    tool: show.tool ? form.tool : '',
    name: show.name || show.projectName ? form.name : '',
    build: form.build,
    include: form.include.filter((k) => k !== 'deploy' || show.deployConfig),
    db: show.databases ? form.db : [],
    port: several ? '' : form.port,
    runtime: several ? '' : form.runtime,
    buildDir: show.buildDir ? form.buildDir : '',
    imageVariant: show.variants.length > 1 ? form.imageVariant : '',
    ...(!form.multistage && { multistage: false, stageMode: form.stageMode }),
    dbPerService: several && show.databases ? form.dbPerService : false,
    envs: show.compose ? form.envs : [],
    restart: show.compose ? form.restart : '',
    ...(show.compose && form.networks.some((n) => n.name.trim()) && {
      networks: form.networks.filter((n) => n.name.trim()).map(({ name, internal, external }) => ({ name: name.trim(), internal, external })),
      appNetworks: form.appNetworks,
      dbNetworks: form.dbNetworks,
    }),
    ...(form.services?.length && { services: form.services.map(cleanService) }),
    healthcheck: form.healthcheck,
    packages: show.packages ? form.packages : [],
    env: show.env ? form.env : '',
    buildArgs: show.buildArgs ? form.buildArgs : '',
    extras: show.extras ? form.extras : [],
    ci: form.ci,
    edits: form.edits,
  };
  if (!show.ci) return body;
  return {
    ...body,
    ...(form.ciSteps && { ciSteps: form.ciSteps }),
    ciServices: form.ciServices,
    scan: form.scan,
    lintDockerfile: form.lintDockerfile,
    codeScan: form.codeScan,
    sbom: show.imageSupply && show.can('sbom') ? form.sbom : false,
    sign: show.imageSupply && show.can('sign') ? form.sign : false,
    registry: show.registryChoice && show.registries.some((r) => r.id === form.registry) ? form.registry : '',
    deploy: form.deploy,
    replicas: form.deploy === 'kubernetes' ? form.replicas : '',
    // Several environments replace the single deploy rule.
    ...(show.deployMore && form.deployTo.length > 0
      ? { deployTo: form.deployTo.map(({ name, on, match }) => ({ name, on, ...(match?.trim() && { match: match.trim() }) })) }
      : { deployOn: show.deployMore ? form.deployOn : '', environment: show.deployMore ? form.environment : '' }),
    pipelineName: form.pipelineName,
    changedOnly: several ? form.changedOnly : false,
    sharedPaths: several && form.changedOnly ? form.sharedPaths : [],
    // Every event is a choice: one that is switched off sends nothing, whatever its list still holds.
    branches: form.pushEvent ? form.branches : [],
    branchesIgnore: form.pushEvent && show.can('branchIgnore') ? form.branchesIgnore : [],
    tags: form.tagEvent ? form.tags : [],
    tagsIgnore: form.tagEvent && show.can('tagFilters') ? form.tagsIgnore : [],
    pullRequests: form.pullRequests,
    prBranches: form.pullRequests && show.can('prBranches') ? form.prBranches : [],
    paths: (form.pushEvent || form.pullRequests) && show.can('paths') ? form.paths : [],
    pathsIgnore: (form.pushEvent || form.pullRequests) && show.can('paths') ? form.pathsIgnore : [],
    release: show.can('release') ? form.release : false,
    manual: form.manual,
    schedule: form.scheduleEvent ? form.schedule : [],
    concurrency: form.concurrency,
    cloudAuth: show.oidc ? form.cloudAuth : 'oidc',
    runner: show.can('runner') ? form.runner : '',
    timeout: show.can('timeout') ? form.timeout : '',
    failFast: form.failFast,
    testJob: form.testJob,
    pipelineEnv: form.pipelineEnv,
    imageTags: form.imageTags,
    scanSeverity: form.scanSeverity,
    depCache: form.depCache,
    pinActions: form.pinActions,
    layerCache: form.layerCache,
    testVersions: show.versions ? form.testVersions : [],
    testOs: show.can('os') ? form.testOs : [],
    permissions: show.can('permissions') ? form.permissions : [],
    platforms: show.can('platforms') && form.platforms.join() !== 'linux/amd64' ? form.platforms : [],
  };
}

/**
 * A service of the form as the API takes it: blank fields left out, an own database list only when it was switched on. The
 * client-only `uid` (a stable React key) is never sent: the API rejects options it does not know.
 */
const cleanService = ({ name, dir, stack, port, runtime, tool, db, networks }) => ({
  name,
  dir,
  ...(stack && { stack }),
  // A port that is not a number goes as typed, so the API reports it instead of JSON turning NaN into nothing.
  ...(String(port ?? '').trim() && { port: Number.isFinite(Number(port)) ? Number(port) : String(port).trim() }),
  ...(String(runtime ?? '').trim() && { runtime: String(runtime).trim() }),
  ...(tool && { tool }),
  ...(Array.isArray(db) && { db }),
  ...(networks?.length && { networks }),
});

// ---- stable keys for the lists you can add to and remove from (services, networks, deployments)

let counter = 0;
/** A client-only id, used as the React key of a list item so focus and state follow the item, not its position. */
export const uid = () => `u${Date.now().toString(36)}${(counter++).toString(36)}`;
const withUid = (item) => (typeof item.uid === 'string' && item.uid ? item : { ...item, uid: uid() });

// ---- the form kept in this browser between visits

/** localStorage key of the saved form; bump the version when the shape changes in a way restoreForm cannot repair. */
export const STORAGE_KEY = 'dockcrate-form-v1';

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null);

/** One service, network, deployment or file edit from storage, or null when its shape is not one this UI can render. */
const SHAPES = {
  services: (s) =>
    isObject(s) && typeof s.name === 'string' && typeof s.dir === 'string'
      ? {
          name: s.name,
          dir: s.dir,
          stack: typeof s.stack === 'string' ? s.stack : 'node',
          ...(['string', 'number'].includes(typeof s.port) && { port: String(s.port) }),
          ...(typeof s.runtime === 'string' && { runtime: s.runtime }),
          ...(typeof s.tool === 'string' && { tool: s.tool }),
          ...(strings(s.db) && { db: strings(s.db) }),
          ...(strings(s.networks) && { networks: strings(s.networks) }),
          ...(typeof s.uid === 'string' && { uid: s.uid }),
        }
      : null,
  networks: (n) => (isObject(n) && typeof n.name === 'string' ? { name: n.name, internal: n.internal === true, external: n.external === true, ...(typeof n.uid === 'string' && { uid: n.uid }) } : null),
  deployTo: (d) =>
    isObject(d) && typeof d.name === 'string' && typeof d.on === 'string'
      ? { name: d.name, on: d.on, ...(typeof d.match === 'string' && { match: d.match }), ...(typeof d.uid === 'string' && { uid: d.uid }) }
      : null,
};

function restoreEdits(raw) {
  if (!isObject(raw)) return {};
  const edits = {};
  for (const [path, e] of Object.entries(raw)) {
    if (!isObject(e)) continue;
    const blocks = isObject(e.blocks) ? Object.fromEntries(Object.entries(e.blocks).filter(([, b]) => isObject(b))) : {};
    const add = Array.isArray(e.add) ? e.add.filter((a) => isObject(a) && typeof a.id === 'string' && typeof (a.text ?? '') === 'string') : [];
    edits[path] = { ...(e.disabled === true && { disabled: true }), blocks, add };
  }
  return edits;
}

/**
 * A saved form, checked against the current defaults: every key keeps the type of its default, choices that no longer exist
 * fall back to the default, and unknown keys are dropped. Anything that cannot be read gives the defaults; this never throws.
 */
export function restoreForm(saved, meta) {
  const base = initialForm(meta);
  if (!isObject(saved)) return base;
  const form = { ...base };
  for (const [key, def] of Object.entries(base)) {
    const v = saved[key];
    if (v === undefined) continue;
    if (key === 'edits') form.edits = restoreEdits(v);
    else if (SHAPES[key] || key === 'services') {
      if (key === 'services' && v === null) form.services = null;
      else if (Array.isArray(v)) {
        const list = v.map(SHAPES[key]).filter(Boolean).map(withUid);
        form[key] = key === 'services' && !list.length ? null : list;
      }
    } else if (key === 'ciSteps') form.ciSteps = v === null ? null : (strings(v) ?? null);
    else if (Array.isArray(def)) form[key] = strings(v) ?? def;
    else if (typeof v === typeof def) form[key] = v;
  }
  const ids = (list) => list.map((x) => x.id);
  if (!ids(meta.stacks).includes(form.stack)) form.stack = base.stack;
  if (!ids(meta.providers).includes(form.ci)) form.ci = base.ci;
  if (!ids(meta.targets).includes(form.deploy)) form.deploy = base.deploy;
  form.include = form.include.filter((k) => meta.kinds.includes(k));
  if (!form.include.length) form.include = base.include;
  return form;
}

/** Reads the saved form, or null; storage that is missing, blocked or holds garbage counts as nothing saved. */
export function loadForm(meta) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? restoreForm(JSON.parse(raw), meta) : null;
  } catch {
    return null;
  }
}

export function saveForm(form) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
  } catch {}
}

export function clearForm() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// ---- generator errors, told in the words of the form

/**
 * The form's fields by the CLI flag and the generator's wording that name them: `key` is the field (the `field` prop of its
 * control), `label` its text in the UI, `flags` the CLI flags (from `bin/dockcrate.js`) a message may quote, and `match` the
 * messages about it that quote no flag. Order matters: the first match wins.
 */
export const FIELDS = [
  { key: 'stack', label: 'Stack', flags: ['--stack'] },
  { key: 'tool', label: 'Package manager', flags: ['--tool'] },
  { key: 'name', label: 'Project name', flags: ['--name'], match: [/^invalid name "/] },
  { key: 'port', label: 'Port', flags: ['--port'], match: [/^invalid (--)?port "/] },
  { key: 'runtime', label: 'Runtime', flags: ['--runtime'], match: [/^invalid runtime "/] },
  { key: 'buildDir', label: 'Build output folder', flags: ['--build-dir'], match: [/^invalid buildDir "/] },
  { key: 'db', label: 'Services in compose', flags: ['--db'], match: [/^unknown database "/] },
  { key: 'dbPerService', label: 'A database per service', flags: ['--db-per-service'], match: [/^redis has \d+ databases/] },
  { key: 'envs', label: 'Environments', flags: ['--envs'], match: [/^invalid environment "[^"]*": lowercase/, /^an environment is listed twice/] },
  { key: 'imageVariant', label: 'Base image', flags: ['--image'], match: [/^invalid image variant "/] },
  { key: 'multistage', label: 'Multi-stage build', flags: ['--no-multistage'] },
  { key: 'stageMode', label: 'One stage', flags: ['--single-stage'], match: [/^invalid single-stage mode "/] },
  { key: 'restart', label: 'Compose restart policy', flags: ['--restart'], match: [/^invalid restart policy "/] },
  { key: 'healthcheck', label: 'Healthcheck path', flags: ['--healthcheck'], match: [/^invalid healthcheck path "/] },
  { key: 'packages', label: 'OS packages', flags: ['--packages'], match: [/^invalid package "/] },
  { key: 'env', label: 'Environment variables', flags: ['--env'], match: [/^invalid environment variable "/] },
  { key: 'buildArgs', label: 'Build args', flags: ['--build-arg'], match: [/^invalid build arg "/] },
  { key: 'include', label: 'Files to generate', flags: ['--only'], match: [/^select at least one file group/, /^unknown file group "/] },
  { key: 'extras', label: 'Extra project files', flags: ['--extras'], match: [/^invalid extra file "/] },
  { key: 'ci', label: 'Provider', flags: ['--ci'] },
  { key: 'pipelineName', label: 'Pipeline name', flags: ['--pipeline-name'], match: [/^invalid pipeline name "/] },
  { key: 'changedOnly', label: 'Only what changed', flags: ['--changed-only'] },
  { key: 'sharedPaths', label: 'Paths that rebuild every service', flags: ['--shared-paths'], match: [/^invalid shared path "/] },
  { key: 'testJob', label: 'Test job', flags: ['--no-test-job'] },
  { key: 'ciSteps', label: 'Steps in the test job', flags: ['--ci-steps'], match: [/CI step is not available/, /^invalid CI step "/] },
  { key: 'testVersions', label: 'Runtime versions to test', flags: ['--test-versions'], match: [/^invalid test version "/] },
  { key: 'testOs', label: 'Test on operating systems', flags: ['--test-os'], match: [/^invalid test OS "/, /need Linux runners/] },
  { key: 'ciServices', label: 'Service containers for tests', flags: ['--ci-services'], match: [/^invalid CI service "/] },
  { key: 'branches', label: 'Branches', flags: ['--branches', '--no-push'], match: [/^invalid branches "/] },
  { key: 'branchesIgnore', label: 'Never run for branches', flags: ['--branches-ignore'], match: [/^invalid branchesIgnore "/] },
  { key: 'tags', label: 'Tags', flags: ['--tags', '--no-tags'], match: [/^invalid tags "/] },
  { key: 'tagsIgnore', label: 'Never run for tags', flags: ['--tags-ignore'], match: [/^invalid tagsIgnore "/] },
  { key: 'prBranches', label: 'Pull requests targeting', flags: ['--pr-branches', '--no-pr'], match: [/^invalid prBranches "/] },
  { key: 'paths', label: 'Only when these paths change', flags: ['--paths'], match: [/^invalid paths "/] },
  { key: 'pathsIgnore', label: 'Ignore changes to', flags: ['--paths-ignore'], match: [/^invalid pathsIgnore "/] },
  { key: 'manual', label: 'A manual run', flags: ['--manual'] },
  { key: 'release', label: 'A release is published', flags: ['--release'] },
  { key: 'schedule', label: 'Schedules', flags: ['--schedule'], match: [/^invalid schedule/] },
  { key: 'cloudAuth', label: 'Cloud login', flags: ['--cloud-auth'], match: [/^invalid cloud auth/] },
  { key: 'concurrency', label: 'Concurrency', flags: ['--concurrency'], match: [/^invalid concurrency "/] },
  { key: 'runner', label: 'Runner / agent', flags: ['--runner'], match: [/^invalid runner "/] },
  { key: 'timeout', label: 'Job timeout', flags: ['--timeout'], match: [/^invalid timeout "/] },
  { key: 'pipelineEnv', label: 'Pipeline environment variables', flags: ['--pipeline-env'], match: [/^invalid pipeline variable "/] },
  { key: 'permissions', label: 'Token permissions', flags: ['--permissions'], match: [/^invalid permission "/] },
  { key: 'imageTags', label: 'Image tags', flags: ['--image-tags'], match: [/^invalid image tag "/] },
  { key: 'platforms', label: 'Image platforms', flags: ['--platforms'], match: [/^invalid platform "/] },
  { key: 'scanSeverity', label: 'Fail the scan on', flags: ['--scan-severity'], match: [/^invalid scan severity "/] },
  { key: 'registry', label: 'Image registry', flags: ['--registry'], match: [/has no built-in container registry/, /logs in to the registry from the server/, /^invalid registry "/] },
  { key: 'deploy', label: 'Deploy to', flags: ['--deploy'], match: [/^unknown deploy target "/, /^deploying needs a CI provider/] },
  { key: 'replicas', label: 'Replicas', flags: ['--replicas'], match: [/^invalid replicas "/] },
  { key: 'deployOn', label: 'Deploy when', flags: ['--deploy-on'], match: [/^invalid deploy-on "/] },
  { key: 'environment', label: 'Environment', flags: ['--environment'] },
  { key: 'deployTo', label: 'Deploy environments', flags: ['--deploy-to'] },
  { key: 'appNetworks', label: 'The service joins', flags: ['--app-network'] },
  { key: 'dbNetworks', label: 'Databases and queues join', flags: ['--db-network'], match: [/^the databases joins the network "/] },
  { key: 'networks', label: 'Networks', flags: ['--network'] },
  { key: 'services', label: 'Services', flags: ['--service', '--services'] },
];

const FLAG_LABELS = Object.fromEntries(FIELDS.flatMap((f) => (f.flags ?? []).map((flag) => [flag, f.label])));
const labelOf = (key) => FIELDS.find((f) => f.key === key)?.label ?? key;

const cap = (text) => {
  const t = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?*]$/.test(t) ? t : `${t}.`;
};
/** The message with every CLI flag replaced by the label of its field. */
const unflag = (text) => text.replace(/--[a-z][a-z-]*/g, (flag) => (FLAG_LABELS[flag] ? `“${FLAG_LABELS[flag]}”` : flag));
/** `invalid <what> "value"<rest>` said as `<label>: "value" is not valid; <rest>`; anything else keeps its wording. */
function say(message, label) {
  const m = /^invalid [^"]*?("[^"]*")\s*(?:for service \S+)?\s*[:;]?\s*(.*)$/.exec(message);
  if (m && label) return cap(`${label}: ${m[1]} is not valid${m[2] ? `; ${unflag(m[2])}` : ''}`);
  return cap(unflag(message));
}

/**
 * Where a generator error belongs in the form: `{ key, label, text }`. `key` names the control (the `field` prop of a control
 * in the sidebar: a form key, or `service:<name>:<field>`, `deploy:<name>:<field>`, `network:<name>` for one item of a list)
 * or is '' when no single field is to blame; `text` is the message in the UI's words, without CLI flags.
 */
export function describeError(raw, form) {
  if (!raw) return { key: '', label: '', text: '' };
  // A port that is not a number reaches the generator as NaN: quote what was typed instead.
  const typed = (svc) => String((svc ? form?.services?.find((s) => s.name === svc)?.port : form?.port) ?? '').trim();
  const message = raw.replace(/^invalid (--)?port "NaN"( for service (\S+))?/, (all, flag, tail, svc) => (typed(svc) ? `invalid ${flag ?? ''}port "${typed(svc)}"${tail ?? ''}` : all));
  const services = form?.services ?? [];
  const at = (key, label, text) => ({ key, label, text });
  let m;
  // One service of several.
  if ((m = /^invalid port "[^"]*" for service (\S+)$/.exec(message))) return at(`service:${m[1]}:port`, `Port of ${m[1]}`, say(message, `Port of ${m[1]}`));
  if ((m = /^invalid service name "([^"]*)"/.exec(message))) return at(`service:${m[1]}:name`, 'Service name', say(message, 'Service name'));
  if ((m = /^invalid service folder "([^"]*)"/.exec(message))) {
    const svc = services.find((s) => s.dir === m[1]);
    return at(svc ? `service:${svc.name}:dir` : 'services', 'Service folder', say(message, 'Service folder'));
  }
  if ((m = /^two services are called "([^"]*)"/.exec(message))) return at(`service:${m[1]}:name`, 'Service name', cap(message));
  if ((m = /^services "[^"]*" and "([^"]*)" both point at/.exec(message))) return at(`service:${m[1]}:dir`, 'Service folder', cap(message));
  if ((m = /^service (\S+) joins the network "/.exec(message))) {
    return services.some((s) => s.name === m[1]) ? at(`service:${m[1]}:networks`, `Networks of ${m[1]}`, cap(message)) : at('appNetworks', labelOf('appNetworks'), cap(message));
  }
  if ((m = /^service (\S+): (.*)$/.exec(message))) {
    const [, name, inner] = m;
    const field = /^invalid runtime /.test(inner) ? 'runtime' : /^choose a stack/.test(inner) ? 'stack' : '';
    const label = { runtime: `Runtime of ${name}`, stack: `Stack of ${name}` }[field];
    return at(field ? `service:${name}:${field}` : 'services', label ?? 'Services', label ? say(inner, label) : `Service ${name}: ${say(inner)}`);
  }
  // The tool belongs to a service when there are several, to the project otherwise.
  if ((m = /^(\S+) (supports --tool (.*)|has no --tool option)$/.exec(message))) {
    const text = m[3] ? `Package manager: ${m[1]} supports ${m[3].split(' | ').join(', ')}.` : `Package manager: ${m[1]} has none to choose.`;
    const svc = services.find((s) => s.stack === m[1] && s.tool);
    return at(svc ? `service:${svc.name}:tool` : 'tool', 'Package manager', text);
  }
  if ((m = /^--db (\S+) and (\S+) both listen on port (\d+)/.exec(message))) {
    return at('db', labelOf('db'), `Services in compose: ${m[1]} and ${m[2]} both listen on port ${m[3]}; pick one.`);
  }
  // One network or deployment of several.
  if ((m = /^invalid network name "([^"]*)"/.exec(message))) return at(`network:${m[1]}`, 'Network name', say(message, 'Network name'));
  if ((m = /^network (\S+) (is declared twice|cannot be both)/.exec(message))) return at(`network:${m[1]}`, 'Network name', cap(message));
  if (/^"default" is the network/.test(message)) return at('network:default', 'Network name', message);
  if ((m = /^environment (\S+) is listed twice/.exec(message))) return at(`deploy:${m[1]}:name`, 'Environment', cap(message));
  if ((m = /^environment (\S+): (.*)$/.exec(message))) return at(`deploy:${m[1]}:match`, 'Branch or tags', `Environment ${m[1]}: ${m[2]}.`);
  if ((m = /^invalid environment "([^"]*)"$/.exec(message))) {
    return form?.deployTo?.length ? at(`deploy:${m[1]}:name`, 'Environment', say(message, 'Environment')) : at('environment', 'Environment', say(message, 'Environment'));
  }
  const field = FIELDS.find((f) => f.match?.some((re) => re.test(message))) ?? FIELDS.find((f) => f.flags?.some((flag) => new RegExp(`^(invalid |unknown )?${flag}\\b`).test(message)));
  if (field) return at(field.key, field.label, say(message, field.label));
  return at('', '', say(message));
}
