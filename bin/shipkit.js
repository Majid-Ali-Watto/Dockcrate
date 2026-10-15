#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  generate,
  writeFiles,
  stackIds,
  dbIds,
  ciIds,
  targetIds,
  PERMISSIONS,
  TEST_OS,
  PLATFORMS,
  CONCURRENCY,
  DEPLOY_ON,
  REGISTRY_CHOICES,
  EXTRAS,
} from '../src/generate.js';

const HELP = `shipkit - generate Dockerfile, docker-compose and CI/CD files for an existing or a new project

Usage: shipkit [dir] [options]

  dir                  project directory (default: current directory)
  --new                new project: no folder is read; you choose the stack and tools (needs --stack)
  --stack <id>         ${stackIds().join(' | ')} (default: auto-detect)
  --tool <name>        package manager / build tool for --new: npm|yarn|pnpm, pip|uv|poetry, maven|gradle
  --name <name>        project name for --new (angular output folder, django project, .NET project)
  --no-build           --new node server without a build step (plain JavaScript)
  --only <list>        only these file groups: dockerfile, dockerignore, compose, ci, deploy, repo
  --extras <list>      extra repo files: ${EXTRAS.join(', ')} (dependabot falls back to Renovate on GitLab)
  --ci <kind>          ${ciIds().join(' | ')} | none (default: github)

  Deployment:
  --deploy <target>    ${targetIds().join(' | ')} (default: registry = just push the image)
  --deploy-on <when>   ${DEPLOY_ON.join(' | ')} (default: branch = the default branch)
  --environment <name> GitHub/GitLab environment for the deploy job (default: production)

  Pipeline:
  --pipeline-name <n>  name of the pipeline / workflow (default: CI)
  --branches <list>    push triggers, comma-separated globs, or "none" (default: main)
  --branches-ignore <l> branches that never trigger a run
  --tags <list|none>   tag triggers, comma-separated globs (default: v*)
  --tags-ignore <list> tags that never trigger a run
  --no-pr              do not run on pull / merge requests
  --pr-branches <list> only pull requests targeting these branches
  --paths <list>       only run when these paths change (globs); --paths-ignore for the opposite
  --release            run when a GitHub release is published
  --manual             allow manual runs (workflow_dispatch / web)
  --schedule "<cron>"  scheduled runs, 5-field cron (repeatable; GitLab/Bitbucket: also create the schedule in the UI)
  --runner <label>     runner / agent / pool image (GitHub runs-on, Azure vmImage, Jenkins agent label)
  --timeout <minutes>  job timeout
  --fail-fast          cancel the rest of a test matrix when one entry fails
  --no-test-job        do not generate a test job
  --pipeline-env N=v   pipeline-wide environment variable (repeatable)
  --image-tags <list>  image tags besides the commit sha: branch, tag, semver, latest (default: branch,tag,latest)
  --scan-severity <l>  Trivy severities that fail the scan (default: HIGH,CRITICAL)
  --no-dep-cache       do not cache dependencies in CI (GitHub)
  --no-layer-cache     do not use the Docker layer cache (GitHub)
  --edits <file.json>  your edits to generated blocks: { "<file>": { "blocks": { "<id>": { "text"?, "disabled"? } }, "add": [...] } }
  --concurrency <m>    ${CONCURRENCY.join(' | ')}: which superseded runs to cancel (default: prs)
  --permissions <list> extra GitHub token permissions: ${PERMISSIONS.join(', ')}
  --test-versions <l>  run tests on these runtime versions, comma-separated (matrix)
  --test-os <list>     GitHub test runners: ${TEST_OS.join(', ')}
  --platforms <list>   image platforms: ${PLATFORMS.join(', ')}

  CI steps and services:
  --ci-steps <list>    steps to run: lint, test, build, audit, or "none" (default: what the project defines)
  --ci-services <list> service containers for the test job: ${dbIds().join(', ')}
  --scan               scan the pushed image with Trivy (fails on HIGH/CRITICAL)
  --lint-dockerfile    lint the Dockerfile with Hadolint (fails on errors)
  --sbom               attach SBOM + provenance attestations to the image (GitHub)
  --sign               sign the pushed image with cosign, keyless (GitHub)
  --code-scan          static analysis: CodeQL workflow (GitHub) or the SAST template (GitLab)
  --registry <name>    ${REGISTRY_CHOICES.join(' | ')}: where the image is pushed (builtin = GHCR/GitLab; default builtin).
                       Cloud deploy targets (cloudrun, ecs, azure) always use their own registry; ssh needs a username/token registry

  Container:
  --healthcheck <path> add a HEALTHCHECK probing this path, e.g. /health
  --packages <list>    OS packages to install in the runtime image (apk/apt names)
  --env NAME=value     runtime ENV in the image (repeatable; no secrets)
  --build-arg NAME[=v] build-time ARG/ENV for Node and static sites, e.g. VITE_API_URL (repeatable)

  --db <list>          comma-separated: ${dbIds().join(', ')}
  --port <n>           port the app listens on inside the container
  --runtime <version>  override the detected runtime version (node 22, python 3.12, dotnet 8.0, java 17, go 1.25)
  --build-dir <dir>    static site build output (react/vue/angular)
  --force              overwrite files that already exist
  --dry-run            print the files instead of writing them
  serve, --serve       start the web UI (default http://localhost:4173; change with --listen <port>)
                       (to generate for a folder literally named "serve", pass ./serve)
  -h, --help           show this help
`;

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Newest modification time under `paths` (files or folders). */
function newestMtime(paths) {
  let newest = 0;
  const visit = (path) => {
    if (!existsSync(path)) return;
    const stat = statSync(path);
    newest = Math.max(newest, stat.mtimeMs);
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name));
  };
  paths.forEach((p) => visit(join(ROOT, p)));
  return newest;
}

/** Runs the Next.js UI (building it first when missing or older than its sources) and stays in the foreground. */
function serve(port) {
  let next;
  try {
    next = createRequire(import.meta.url).resolve('next/dist/bin/next');
  } catch {
    throw new Error(`the web UI needs its dependencies: run "npm install" in ${ROOT}`);
  }
  const built = join(ROOT, '.next/BUILD_ID');
  const sources = ['app', 'components', 'lib', 'src', 'proxy.js', 'next.config.mjs', 'package.json'];
  if (!existsSync(built) || newestMtime(sources) > statSync(built).mtimeMs) {
    console.log('Building the UI…');
    const build = spawnSync(process.execPath, [next, 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (build.status !== 0) throw new Error('the UI build failed');
  }
  console.log(`shipkit UI: http://localhost:${port}  (Ctrl+C to stop)`);
  const child = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, SHIPKIT_CWD: process.cwd() }, // the UI opens on the folder you launched it from
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  return new Promise(() => {});
}

const csv = (text) => text?.split(',').map((s) => s.trim()).filter(Boolean);

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      new: { type: 'boolean' },
      stack: { type: 'string' },
      tool: { type: 'string' },
      name: { type: 'string' },
      'no-build': { type: 'boolean' },
      only: { type: 'string' },
      deploy: { type: 'string' },
      'deploy-on': { type: 'string' },
      environment: { type: 'string' },
      branches: { type: 'string' },
      tags: { type: 'string' },
      'branches-ignore': { type: 'string' },
      'tags-ignore': { type: 'string' },
      'pr-branches': { type: 'string' },
      paths: { type: 'string' },
      'paths-ignore': { type: 'string' },
      release: { type: 'boolean' },
      'pipeline-name': { type: 'string' },
      runner: { type: 'string' },
      timeout: { type: 'string' },
      'fail-fast': { type: 'boolean' },
      'no-test-job': { type: 'boolean' },
      'pipeline-env': { type: 'string', multiple: true },
      'image-tags': { type: 'string' },
      'scan-severity': { type: 'string' },
      'no-dep-cache': { type: 'boolean' },
      'no-layer-cache': { type: 'boolean' },
      edits: { type: 'string' },
      'no-pr': { type: 'boolean' },
      manual: { type: 'boolean' },
      schedule: { type: 'string', multiple: true },
      concurrency: { type: 'string' },
      permissions: { type: 'string' },
      'test-versions': { type: 'string' },
      'test-os': { type: 'string' },
      platforms: { type: 'string' },
      'ci-steps': { type: 'string' },
      'ci-services': { type: 'string' },
      scan: { type: 'boolean' },
      'lint-dockerfile': { type: 'boolean' },
      sbom: { type: 'boolean' },
      sign: { type: 'boolean' },
      'code-scan': { type: 'boolean' },
      registry: { type: 'string' },
      extras: { type: 'string' },
      healthcheck: { type: 'string' },
      packages: { type: 'string' },
      env: { type: 'string', multiple: true },
      'build-arg': { type: 'string', multiple: true },
      ci: { type: 'string' },
      db: { type: 'string', multiple: true },
      port: { type: 'string' },
      runtime: { type: 'string' },
      'build-dir': { type: 'string' },
      force: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      serve: { type: 'boolean' },
      listen: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (values.serve || positionals[0] === 'serve') {
    await serve(Number(values.listen ?? 4173));
  }

  const dir = resolve(positionals[0] ?? '.');
  const { stack, files, notes } = generate(dir, {
    isNew: values.new,
    tool: values.tool,
    name: values.name,
    build: values['no-build'] ? false : undefined,
    include: csv(values.only),
    deploy: values.deploy,
    deployOn: values['deploy-on'],
    environment: values.environment,
    branches: values.branches === 'none' ? [] : csv(values.branches),
    tags: values.tags === 'none' ? [] : csv(values.tags),
    branchesIgnore: csv(values['branches-ignore']),
    tagsIgnore: csv(values['tags-ignore']),
    prBranches: csv(values['pr-branches']),
    paths: csv(values.paths),
    pathsIgnore: csv(values['paths-ignore']),
    release: values.release,
    pipelineName: values['pipeline-name'],
    runner: values.runner,
    timeout: values.timeout,
    failFast: values['fail-fast'],
    testJob: values['no-test-job'] ? false : undefined,
    pipelineEnv: values['pipeline-env'],
    imageTags: csv(values['image-tags']),
    scanSeverity: csv(values['scan-severity']),
    depCache: values['no-dep-cache'] ? false : undefined,
    layerCache: values['no-layer-cache'] ? false : undefined,
    edits: values.edits ? JSON.parse(readFileSync(resolve(values.edits), 'utf8')) : undefined,
    pullRequests: values['no-pr'] ? false : undefined,
    manual: values.manual,
    schedule: values.schedule,
    concurrency: values.concurrency,
    permissions: csv(values.permissions),
    testVersions: csv(values['test-versions']),
    testOs: csv(values['test-os']),
    platforms: csv(values.platforms),
    ciSteps: values['ci-steps'] === 'none' ? [] : csv(values['ci-steps']),
    ciServices: csv(values['ci-services']),
    scan: values.scan,
    lintDockerfile: values['lint-dockerfile'],
    sbom: values.sbom,
    sign: values.sign,
    codeScan: values['code-scan'],
    registry: values.registry,
    extras: csv(values.extras),
    healthcheck: values.healthcheck,
    packages: csv(values.packages),
    env: values.env,
    buildArgs: values['build-arg'],
    stack: values.stack,
    ci: values.ci,
    db: values.db?.flatMap((v) => v.split(',')).filter(Boolean),
    port: values.port && Number(values.port),
    runtime: values.runtime,
    buildDir: values['build-dir'],
  });

  console.log(values.new ? `New ${stack} project` : `Detected stack: ${stack}`);
  if (values['dry-run']) {
    for (const { path, content } of files) console.log(`\n--- ${path} ---\n${content}`);
  } else {
    for (const { path, status } of writeFiles(dir, files, { force: values.force })) {
      console.log(status === 'written' ? `  wrote    ${path}` : `  skipped  ${path} (exists, use --force)`);
    }
  }
  if (notes.length) console.log(`\nNotes:\n${notes.map((n) => `  - ${n}`).join('\n')}`);
} catch (err) {
  console.error(`shipkit: ${err.message}`);
  process.exit(1);
}
