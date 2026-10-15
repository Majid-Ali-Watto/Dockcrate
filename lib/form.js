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
  concurrency: {
    prs: 'Cancel superseded pull-request runs (recommended)',
    always: 'Cancel every superseded run',
    queue: 'Queue runs, never cancel',
    off: 'No concurrency control',
  },
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
    mode: meta.hosted ? 'new' : 'existing', // the hosted site has no folders to read
    dirs: { existing: meta.cwd, new: '' }, // one folder per mode, so switching back keeps what you typed
    stack: meta.hosted ? 'node' : '', // a new project needs a stack up front
    tool: '',
    name: '',
    build: true,
    include: meta.kinds,
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
    // pipeline
    pipelineName: 'CI',
    branches: ['main'],
    branchesIgnore: [],
    tags: ['v*'],
    tagsIgnore: [],
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
    layerCache: true,
    edits: {}, // { [file path]: { disabled?, blocks: { [id]: { text?, disabled?, from? } }, add: [...] } }
    concurrency: 'prs',
    testVersions: [],
    testOs: [],
    permissions: [],
    platforms: ['linux/amd64'],
  };
}

/** Which controls apply to the current selection. Everything else is hidden rather than disabled. */
export function visibility(form, meta, result) {
  const isNew = form.mode === 'new';
  const stack = meta.stacks.find((s) => s.id === (form.stack || result?.stack));
  const target = meta.targets.find((t) => t.id === form.deploy);
  const ci = form.include.includes('ci');
  const provider = meta.providers.find((p) => p.id === form.ci) ?? meta.providers[0];
  const can = (feature) => provider.features.includes(feature);
  const github = form.ci === 'github';
  const backend = stack ? stack.backend : true;
  return {
    isNew,
    stack,
    target,
    ci,
    github,
    provider,
    can,
    backend,
    tool: isNew && Boolean(stack?.tools.length),
    name: isNew && Boolean(stack?.usesName),
    buildToggle: isNew && Boolean(stack?.usesBuild),
    buildDir: Boolean(stack) && !stack.backend,
    databases: backend,
    packages: Boolean(stack?.usesPackages),
    env: backend,
    buildArgs: Boolean(stack?.usesBuildArgs),
    extras: form.include.includes('repo'),
    registryChoice: ci && target?.registry === 'builtin',
    // A target that logs in again from the server (ssh) can only reuse username/token registries.
    registries: meta.registries.filter((r) => (!target?.serverLogin || r.serverLogin) && (r.id !== 'builtin' || provider.builtinRegistry)),
    imageSupply: ci && Boolean(target?.registry),
    deployConfig: ci && Boolean(target?.files),
    deployMore: ci && Boolean(target?.deploys),
    oidc: ci && github && Boolean(target?.oidc),
    ciSteps: result?.ci?.available ?? stack?.ciSteps ?? [],
  };
}

/** The request body for the current form, leaving out settings that are hidden. */
export function toBody(form, show) {
  const body = {
    mode: form.mode,
    dir: form.dirs[form.mode],
    stack: form.stack,
    tool: show.tool ? form.tool : '',
    name: show.name ? form.name : '',
    build: form.build,
    include: form.include.filter((k) => k !== 'deploy' || show.deployConfig),
    db: show.databases ? form.db : [],
    port: form.port,
    runtime: form.runtime,
    buildDir: show.buildDir ? form.buildDir : '',
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
    deployOn: show.deployMore ? form.deployOn : '',
    environment: show.deployMore ? form.environment : '',
    pipelineName: form.pipelineName,
    branches: form.branches,
    branchesIgnore: show.can('branchIgnore') ? form.branchesIgnore : [],
    tags: form.tags,
    tagsIgnore: show.can('tagFilters') ? form.tagsIgnore : [],
    pullRequests: form.pullRequests,
    prBranches: show.can('prBranches') ? form.prBranches : [],
    paths: show.can('paths') ? form.paths : [],
    pathsIgnore: show.can('paths') ? form.pathsIgnore : [],
    release: show.can('release') ? form.release : false,
    manual: form.manual,
    schedule: form.schedule,
    concurrency: form.concurrency,
    runner: show.can('runner') ? form.runner : '',
    timeout: show.can('timeout') ? form.timeout : '',
    failFast: form.failFast,
    testJob: form.testJob,
    pipelineEnv: form.pipelineEnv,
    imageTags: form.imageTags,
    scanSeverity: form.scanSeverity,
    depCache: form.depCache,
    layerCache: form.layerCache,
    testVersions: form.testVersions,
    testOs: show.can('os') ? form.testOs : [],
    permissions: show.can('permissions') ? form.permissions : [],
    platforms: show.can('platforms') && form.platforms.join() !== 'linux/amd64' ? form.platforms : [],
  };
}
