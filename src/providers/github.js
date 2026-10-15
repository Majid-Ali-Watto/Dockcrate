import { block, mapLines, q, scalar, uniqueKeys, stepTitle, when, withoutDepCache, x } from './common.js';
import { healthCmd, serviceEnv, serviceUrl } from './common.js';
import { DBS } from '../compose.js';
import { REGISTRIES } from '../deploy.js';

const NOT_PR = "github.event_name != 'pull_request'";

const runLines = (run) => {
  const text = Array.isArray(run) ? run.join('\n') : run;
  return text.includes('\n') ? ['run: |', ...text.split('\n').map((l) => `  ${l}`)] : [`run: ${scalar(text)}`];
};

/** One step as YAML list-item lines. `key` and `title` only name the block; they are not part of the YAML. */
function stepLines({ id, if: cond, uses, with: params, run, env }) {
  const fields = [
    id && `id: ${id}`,
    cond && `if: ${q(cond)}`,
    uses && `uses: ${uses}`,
    run && runLines(run),
    params && ['with:', mapLines(params, '  ')],
    env && ['env:', mapLines(env, '  ')],
  ]
    .filter(Boolean)
    .flat(Infinity);
  return fields.map((line, i) => `${i ? '        ' : '      - '}${line}`);
}

/** Step blocks for a job; ids come from what each step does (`image.build-push-action`). */
const stepBlocks = (job, steps) => {
  const list = steps.filter(Boolean);
  const keys = uniqueKeys(list);
  return list.map((s, i) => block(`${job}.${keys[i]}`, `${job}: ${s.title ?? stepTitle(s)}`, stepLines(s), false));
};

const permissionLines = (perms, pad = '') => [`${pad}permissions:`, ...Object.entries(perms).map(([k, v]) => `${pad}  ${k}: ${v}`)];

/** `contents-write` -> ['contents', 'write']; write beats read when both are listed. */
function tokenPermissions(list) {
  const out = {};
  for (const perm of list) {
    if (perm === 'id-token-write') continue; // granted per job, where the OIDC login happens
    const [, name, level] = perm.match(/^(.+)-(read|write)$/);
    if (out[name] !== 'write') out[name] = level;
  }
  return out;
}

const DEPLOY_CONDITION = {
  branch: "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
  tag: "startsWith(github.ref, 'refs/tags/')",
  manual: "github.event_name == 'workflow_dispatch'",
};

/** Include patterns, then the ignored ones as `!pattern` (GitHub forbids `x` and `x-ignore` together). */
const filter = (key, include, ignore, pad) => {
  if (include.length) return `${pad}${key}: ${JSON.stringify([...include, ...ignore.map((g) => `!${g}`)])}`;
  if (ignore.length) return `${pad}${key}-ignore: ${JSON.stringify(ignore)}`;
  return null;
};

function service(name) {
  const db = DBS[name];
  const options = `--health-cmd "${healthCmd(name)}" --health-interval 5s --health-timeout 5s --health-retries 10`;
  return [
    `      ${name}:`,
    `        image: ${db.image}`,
    Object.keys(serviceEnv(name)).length > 0 && ['        env:', mapLines(serviceEnv(name), '          ')],
    '        ports:',
    `          - "${db.port}:${db.port}"`,
    `        options: ${q(options)}`,
  ];
}

const IMAGE_TAGS = {
  branch: ['type=ref,event=branch'],
  tag: ['type=ref,event=tag'],
  semver: ['type=semver,pattern={{version}}', 'type=semver,pattern={{major}}.{{minor}}'],
  latest: ['type=raw,value=latest,enable={{is_default_branch}}'],
};

function render(p, ciSteps) {
  const { triggers: t, target, appName } = p;
  const registry = p.registryId ? REGISTRIES[p.registryId].github : null;
  const deploys = Boolean(target.script);
  const auth = target.github?.auth?.(p.oidc) ?? [];
  const imageAuth = p.authTarget.github?.auth?.(p.oidc) ?? [];
  const runner = p.runner || 'ubuntu-latest';
  const timeout = p.timeout ? `    timeout-minutes: ${p.timeout}` : null;

  // Workflow-wide permissions; id-token and packages are granted per job where they are needed.
  const base = { contents: 'read', ...tokenPermissions(p.permissions) };
  const jobPermissions = (extra = {}) => ({ ...base, ...extra });

  const matrix = { ...(p.os.length && { os: p.os }), ...(p.versions.length && { version: p.versions }) };
  const matrixed = Object.keys(matrix).length > 0;
  const test = ciSteps(p.versions.length ? x('matrix.version') : undefined);
  const testSteps = p.depCache ? test.steps : withoutDepCache(test.steps);

  const blocks = [];
  blocks.push(block('name', 'Workflow name', `name: ${scalar(p.workflowName)}`, false));

  const push = when(t.push, '  push:', filter('branches', t.branches, t.branchesIgnore, '    '), filter('tags', t.tags, t.tagsIgnore, '    '), filter('paths', t.paths, t.pathsIgnore, '    '));
  blocks.push(
    block('on', 'Triggers', [
      'on:',
      push,
      t.pullRequests && ['  pull_request:', filter('branches', t.prBranches, [], '    '), filter('paths', t.paths, t.pathsIgnore, '    ')],
      t.release && ['  release:', '    types: [published]'],
      t.manual && '  workflow_dispatch:',
      when(t.schedule.length, '  schedule:', t.schedule.map((cron) => `    - cron: ${q(cron)}`)),
    ]),
  );
  blocks.push(block('permissions', 'Token permissions', permissionLines(base)));
  if (p.pipelineEnv.length > 0) blocks.push(block('env', 'Workflow environment variables', ['env:', mapLines(Object.fromEntries(p.pipelineEnv), '  ')]));
  const cancel = { prs: x("github.event_name == 'pull_request'"), always: 'true', queue: 'false' }[p.concurrency];
  if (p.concurrency !== 'off') {
    blocks.push(
      block('concurrency', 'Concurrency', ['concurrency:', `  group: ${x('github.workflow')}-${x('github.ref')}`, `  cancel-in-progress: ${cancel}`]),
    );
  }
  blocks.push(block('jobs', 'Jobs', 'jobs:'));

  // -- test
  if (p.testJob) blocks.push(
    block(
      'test.header',
      'test: job settings',
      [
        '  test:',
        `    runs-on: ${matrixed && p.os.length ? x('matrix.os') : runner}`,
        timeout,
        matrixed && [
          '    strategy:',
          `      fail-fast: ${p.failFast}`,
          '      matrix:',
          Object.entries(matrix).map(([k, v]) => `        ${k}: ${JSON.stringify(v)}`),
        ],
        p.os.some((o) => !o.startsWith('ubuntu')) && ['    defaults:', '      run:', '        shell: bash'],
        when(p.services.length, '    services:', p.services.flatMap(service)),
        when(p.services.length, '    env:', mapLines(Object.fromEntries(p.services.map((n) => serviceUrl(n, 'localhost'))), '      ')),
        '    steps:',
      ],
      false,
    ),
    ...stepBlocks('test', [{ key: 'checkout', uses: 'actions/checkout@v4' }, ...testSteps]),
  );

  // -- lint-dockerfile
  if (p.lintDockerfile) {
    blocks.push(
      block('lint-dockerfile.header', 'lint-dockerfile: job settings', ['  lint-dockerfile:', `    runs-on: ${runner}`, timeout, '    steps:']),
      ...stepBlocks('lint-dockerfile', [
        { key: 'checkout', uses: 'actions/checkout@v4' },
        { key: 'hadolint', uses: 'hadolint/hadolint-action@v3.1.0', with: { dockerfile: 'Dockerfile', 'failure-threshold': 'error' } },
      ]),
    );
  }
  const gates = [p.testJob && 'test', p.lintDockerfile && 'lint-dockerfile'].filter(Boolean);
  const needsLine = (jobs) => (jobs.length ? `    needs: ${jobs.length > 1 ? `[${jobs.join(', ')}]` : jobs[0]}` : null);

  // -- image
  const multiArch = p.platforms.length > 1 || p.platforms.some((pl) => pl !== 'linux/amd64');
  if (registry) {
    const tags = [...p.imageTags.filter((k) => k !== 'latest').flatMap((k) => IMAGE_TAGS[k]), 'type=sha,format=long', ...(p.imageTags.includes('latest') ? IMAGE_TAGS.latest : [])];
    blocks.push(
      block('image.header', 'image: job settings', [
        '  image:',
        needsLine(gates),
        `    runs-on: ${runner}`,
        timeout,
        permissionLines(jobPermissions({ ...(p.registryId === 'builtin' && { packages: 'write' }), ...((p.oidc || p.sign) && { 'id-token': 'write' }) }), '    '),
        '    outputs:',
        `      image: ${x('steps.ref.outputs.image')}`,
        '    steps:',
      ]),
      ...stepBlocks('image', [
        { key: 'checkout', uses: 'actions/checkout@v4' },
        multiArch && { key: 'qemu', uses: 'docker/setup-qemu-action@v3' },
        { key: 'buildx', uses: 'docker/setup-buildx-action@v3' },
        ...imageAuth.map((s) => ({ key: 'cloud-login', ...s, if: NOT_PR })),
        ...registry.login(p.oidc).map((s, i) => ({ key: i ? `registry-login-${i + 1}` : 'registry-login', ...s })),
        {
          key: 'image-ref',
          title: 'Compute the image name',
          id: 'ref',
          run: [
            'name=$(printf \'%s\' "$IMAGE_NAME" | tr \'[:upper:]\' \'[:lower:]\')',
            'echo "name=$name" >> "$GITHUB_OUTPUT"',
            'echo "image=$name:sha-$GITHUB_SHA" >> "$GITHUB_OUTPUT"',
          ],
          env: { IMAGE_NAME: registry.image.replace('{app}', appName) },
        },
        {
          key: 'metadata',
          id: 'meta',
          uses: 'docker/metadata-action@v5',
          with: { images: x('steps.ref.outputs.name'), tags: tags.join('\n') },
        },
        {
          key: 'build-push',
          id: 'build',
          uses: 'docker/build-push-action@v6',
          with: {
            context: '.',
            ...(p.sbom && { sbom: 'true', provenance: 'mode=max' }),
            ...(p.platforms.length && { platforms: p.platforms.join(',') }),
            ...(p.buildArgs.length && { 'build-args': p.buildArgs.map((n) => `${n}=${x(`vars.${n}`)}`).join('\n') }),
            push: x(NOT_PR),
            tags: x('steps.meta.outputs.tags'),
            labels: x('steps.meta.outputs.labels'),
            ...(p.layerCache && { 'cache-from': 'type=gha', 'cache-to': 'type=gha,mode=max' }),
          },
        },
        p.sign && { key: 'cosign-install', if: NOT_PR, uses: 'sigstore/cosign-installer@v3' },
        p.sign && {
          key: 'cosign-sign',
          title: 'Sign the image',
          if: NOT_PR,
          run: 'cosign sign --yes "$IMAGE@$DIGEST"',
          env: { IMAGE: x('steps.ref.outputs.name'), DIGEST: x('steps.build.outputs.digest') },
        },
        p.scan && {
          key: 'trivy',
          if: NOT_PR,
          uses: 'aquasecurity/trivy-action@0.28.0',
          with: { 'image-ref': x('steps.ref.outputs.image'), severity: p.scanSeverity.join(','), 'ignore-unfixed': 'true', 'exit-code': '1' },
        },
      ]),
    );
  }

  // -- deploy
  if (deploys) {
    const deployEnv = {
      APP: appName,
      PORT: p.port,
      ...(registry && { IMAGE: x('needs.image.outputs.image') }),
      ...(target.usesRegistryEnv && registry.env),
    };
    const needs = target.needs?.({ platform: 'github', oidc: p.oidc }) ?? { secrets: [], vars: [] };
    for (const name of needs.secrets) deployEnv[name] = x(`secrets.${name}`);
    for (const raw of needs.vars) {
      const name = raw.replace(/\?$/, '');
      deployEnv[name] = x(`vars.${name}`);
    }
    blocks.push(
      block('deploy.header', 'deploy: job settings', [
        '  deploy:',
        needsLine(registry ? ['image'] : gates),
        `    if: ${q(DEPLOY_CONDITION[p.deployOn])}`,
        `    runs-on: ${runner}`,
        timeout,
        p.environment && `    environment: ${p.environment}`,
        '    concurrency:',
        `      group: deploy-${p.environment || appName}`,
        '      cancel-in-progress: false',
        permissionLines(jobPermissions({ ...(target.usesRegistryEnv && !base.packages && { packages: 'read' }), ...(p.oidc && { 'id-token': 'write' }) }), '    '),
        '    steps:',
      ]),
      ...stepBlocks('deploy', [
        { key: 'checkout', uses: 'actions/checkout@v4' },
        ...auth.map((s) => ({ key: 'cloud-login', ...s })),
        ...(target.github?.prepare ?? []).map((s) => ({ key: 'prepare', ...s })),
        { key: 'deploy', title: 'Deploy', run: target.script({ appName, port: p.port, composeFile: p.composeFile }), env: deployEnv },
      ]),
    );
  }
  return blocks;
}

/** CodeQL gets its own workflow file. */
function codeqlFiles(p, stack) {
  if (!p.codeScan || !stack.codeql) return [];
  const t = p.triggers;
  return [
    {
      path: '.github/workflows/codeql.yml',
      blocks: [
        block('name', 'Workflow name', 'name: CodeQL', false),
        block('on', 'Triggers', [
          'on:',
          when(t.branches.length, '  push:', `    branches: ${JSON.stringify(t.branches)}`),
          t.pullRequests && '  pull_request:',
          '  schedule:',
          '    - cron: "17 4 * * 1"',
        ]),
        block('permissions', 'Token permissions', ['permissions:', '  contents: read']),
        block('jobs', 'Jobs', 'jobs:'),
        block('analyze.header', 'analyze: job settings', ['  analyze:', `    runs-on: ${p.runner || 'ubuntu-latest'}`, '    permissions:', '      contents: read', '      security-events: write', '    steps:'], false),
        ...stepBlocks('analyze', [
          { key: 'checkout', uses: 'actions/checkout@v4' },
          { key: 'init', uses: 'github/codeql-action/init@v3', with: { languages: stack.codeql, 'build-mode': stack.codeql === 'go' ? 'autobuild' : 'none' } },
          { key: 'analyze', uses: 'github/codeql-action/analyze@v3', with: { category: `/language:${stack.codeql}` } },
        ]),
      ],
    },
  ];
}

const COMMON = ['prBranches', 'manual', 'schedule', 'paths', 'permissions', 'os', 'platforms', 'services', 'runner', 'timeout', 'tagFilters', 'branchIgnore', 'depCache', 'layerCache'];

export const github = {
  label: 'GitHub Actions',
  path: '.github/workflows/ci.yml',
  builtinRegistry: true,
  secretsLocation: 'GitHub (Settings > Secrets and variables > Actions)',
  variablesName: 'GitHub repository variables',
  features: [...COMMON, 'release', 'sbom', 'sign', 'codeScan'],
  render,
  extraFiles: codeqlFiles,
};

/** Gitea and Forgejo run GitHub Actions workflows, from .gitea/workflows; they have no GitHub token or OIDC. */
export const gitea = {
  label: 'Gitea / Forgejo Actions',
  path: '.gitea/workflows/ci.yml',
  builtinRegistry: false,
  secretsLocation: 'Gitea (Settings > Actions > Secrets and Variables)',
  features: ['prBranches', 'manual', 'schedule', 'paths', 'os', 'services', 'runner', 'timeout', 'tagFilters', 'branchIgnore', 'depCache', 'layerCache', 'platforms'],
  notes: () => ['Gitea Actions needs a registered act runner; actions are pulled from github.com by default.'],
  render,
};
