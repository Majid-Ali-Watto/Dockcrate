import { block, manualGate, manualLabel, mapLines, q, scalar, uniqueKeys, stepTitle, when, withoutDepCache, x } from './common.js';
import { changedLines, healthCmd, imageRepo, inApp, isMulti, serviceEnv, serviceUrl, stepsInDir } from './common.js';
import { DBS } from '../compose.js';
import { REGISTRIES } from '../deploy.js';
import { pinAction } from './pins.js';

const NOT_PR = "github.event_name != 'pull_request'";
/** No job keeps the token in .git/config after checkout: nothing later in a job needs git credentials. */
const CHECKOUT = { key: 'checkout', uses: 'actions/checkout@v4', with: { 'persist-credentials': false } };

const runLines = (run) => {
  const text = Array.isArray(run) ? run.join('\n') : run;
  return text.includes('\n') ? ['run: |', ...text.split('\n').map((l) => `  ${l}`)] : [`run: ${scalar(text)}`];
};

/** One step as YAML list-item lines. `key` and `title` only name the block; they are not part of the YAML. */
function stepLines({ id, if: cond, uses, with: params, run, env, dir }, pin) {
  const fields = [
    id && `id: ${id}`,
    cond && `if: ${q(cond)}`,
    uses && `uses: ${pin(uses)}`,
    run && runLines(run),
    dir && `working-directory: ${dir}`,
    params && ['with:', mapLines(params, '  ')],
    env && ['env:', mapLines(env, '  ')],
  ]
    .filter(Boolean)
    .flat(Infinity);
  return fields.map((line, i) => `${i ? '        ' : '      - '}${line}`);
}

/** Step blocks for a job; ids come from what each step does (`image.build-push-action`). `pin` rewrites `uses` values. */
const renderSteps = (pin, job, steps) => {
  const list = steps.filter(Boolean);
  const keys = uniqueKeys(list);
  return list.map((s, i) => block(`${job}.${keys[i]}`, `${job}: ${s.title ?? stepTitle(s)}`, stepLines(s, pin), false));
};

/** Actions are referenced by full commit SHA (with the tag as a comment) unless the user turned pinning off. */
const stepper = (p) => (job, steps) => renderSteps(p.pinActions ? pinAction : (uses) => uses, job, steps);

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

/** The `if` of a deploy job: the default branch, a branch or branch prefix, a tag or tag prefix, or a manual run of that environment. */
function deployCondition(p, d) {
  const ref = (kind) => {
    const prefix = d.match?.endsWith('*');
    const value = d.match?.replace(/\*$/, '');
    return prefix ? `startsWith(github.ref, 'refs/${kind}/${value}')` : `github.ref == 'refs/${kind}/${value}'`;
  };
  if (d.on === 'branch') return d.match ? ref('heads') : "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)";
  if (d.on === 'tag') return d.match ? ref('tags') : "startsWith(github.ref, 'refs/tags/')";
  // Several manual environments share one trigger: the run asks which one.
  return manualEnvs(p).length > 1 ? `github.event_name == 'workflow_dispatch' && inputs.environment == '${d.name}'` : "github.event_name == 'workflow_dispatch'";
}

const manualEnvs = (p) => p.deployments.filter((d) => d.on === 'manual');

/** The inputs of a manual run: the environment to deploy when there are several manual ones, then a checkbox per CI step. */
function dispatchInputs(p) {
  const envs = manualEnvs(p).map((d) => d.name);
  const inputs = [
    envs.length > 1 && ['      environment:', '        description: "Environment to deploy"', '        required: false', '        type: choice', `        options: ${JSON.stringify(envs)}`],
    ...p.manualSteps.map((step) => [`      ${step}:`, `        description: ${q(manualLabel(step))}`, '        required: false', '        type: boolean', '        default: true']),
  ].filter(Boolean);
  return inputs.length ? ['    inputs:', inputs] : null;
}

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

/**
 * Apps whose test job is identical share one job with a matrix over the apps; the rest get a job of their own. Jobs are called
 * `test` for a single app, `test-<service>` for a lone app and `test-<stack>` for a group.
 */
function testGroups(p) {
  const groups = new Map();
  for (const app of p.apps) {
    const test = app.ci(app.versions.length ? x('matrix.version') : undefined);
    // A manual run skips the steps whose checkbox is not ticked; every other event runs them all.
    const gated = (step) => {
      const gate = manualGate(p, step, (n) => `inputs.${n}`);
      return gate ? { ...step, if: ["github.event_name != 'workflow_dispatch'", ...gate].join(' || ') } : step;
    };
    const steps = (p.depCache ? test.steps : withoutDepCache(test.steps)).filter(Boolean).map(gated);
    const key = JSON.stringify([stepsInDir(steps, app.dir === '.' ? '.' : '@dir'), app.versions]);
    if (!groups.has(key)) groups.set(key, { apps: [], steps, versions: app.versions });
    groups.get(key).apps.push(app);
  }
  const used = new Set();
  return [...groups.values()].map((g) => {
    let id = !isMulti(p) ? 'test' : g.apps.length === 1 ? `test-${g.apps[0].id}` : `test-${g.apps[0].stackId}`;
    for (let n = 2; used.has(id); n += 1) id = `${id.replace(/-\d+$/, '')}-${n}`;
    used.add(id);
    return { ...g, id };
  });
}

function render(p) {
  const stepBlocks = stepper(p);
  const { triggers: t, target, appName } = p;
  const registry = p.registryId ? REGISTRIES[p.registryId].github : null;
  const deploys = Boolean(target.script);
  const auth = target.github?.auth?.(p.oidc) ?? [];
  const imageAuth = p.authTarget.github?.auth?.(p.oidc) ?? [];
  const runner = p.runner || 'ubuntu-latest';
  const timeout = p.timeout ? `    timeout-minutes: ${p.timeout}` : null;

  // The workflow default is read-only. The extra permissions asked for go only to the jobs that publish or deploy (image,
  // deploy), never to the ones that run the pushed or pull-request code (changes, test, lint); id-token and packages are
  // granted per job where they are needed.
  const base = { contents: 'read' };
  const extra = tokenPermissions(p.permissions);
  const jobPermissions = (more = {}) => ({ ...base, ...extra, ...more });

  const blocks = [];
  blocks.push(block('name', 'Workflow name', `name: ${scalar(p.workflowName)}`, false));

  const push = when(t.push, '  push:', filter('branches', t.branches, t.branchesIgnore, '    '), filter('tags', t.tags, t.tagsIgnore, '    '), filter('paths', t.paths, t.pathsIgnore, '    '));
  blocks.push(
    block('on', 'Triggers', [
      'on:',
      push,
      t.pullRequests && ['  pull_request:', filter('branches', t.prBranches, [], '    '), filter('paths', t.paths, t.pathsIgnore, '    ')],
      t.release && ['  release:', '    types: [published]'],
      t.manual && ['  workflow_dispatch:', dispatchInputs(p)],
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

  // -- changes: which services' folders changed, as outputs the other jobs build their matrices from
  const multi = isMulti(p);
  const changed = p.changedOnly;
  const jobIds = [];
  const groups = p.testJob ? testGroups(p) : [];
  const out = (key) => x(`needs.changes.outputs.${key}`);
  const listOf = (key) => x(`fromJSON(needs.changes.outputs.${key})`);
  const some = (key) => `needs.changes.outputs.${key} != '[]'`;
  const changedApp = (app) => `contains(needs.changes.outputs.changed, ',all,') || contains(needs.changes.outputs.changed, ',${app.id},')`;
  const argNames = (app) => app.buildArgs.join(' ');
  const withArgs = p.apps.some((a) => a.buildArgs.length);
  if (changed) {
    const lists = [
      ...groups.filter((g) => g.apps.length > 1).map((g) => ({ key: g.id, apps: g.apps, item: (a) => `"${a.dir}"` })),
      ...(p.lintDockerfile ? [{ key: 'lint', apps: p.apps, item: (a) => JSON.stringify({ service: a.id, dockerfile: inApp(a, 'Dockerfile') }) }] : []),
      ...(p.registryId ? [{ key: 'images', apps: p.apps, item: (a) => JSON.stringify({ service: a.id, dir: a.dir, ...(withArgs && { args: argNames(a) }) }) }] : []),
    ];
    const run = [
      'set -eu',
      ...changedLines(p, {
        ciPath: github.path,
        setup: [
          'case "$EVENT_NAME" in',
          '  push) case "$GITHUB_REF" in refs/tags/*) ALL=1;; *) BASE="$BEFORE";; esac;;',
          '  pull_request) BASE=$(git merge-base "origin/$BASE_REF" HEAD || true);;',
          '  *) ALL=1;;',
          'esac',
        ],
      }),
      'hit() { case "$CHANGED" in *,all,*|*,"$1",*) return 0;; *) return 1;; esac; }',
      'echo "changed=$CHANGED" >> "$GITHUB_OUTPUT"',
      'if [ "$CHANGED" = "," ]; then echo "any=false" >> "$GITHUB_OUTPUT"; else echo "any=true" >> "$GITHUB_OUTPUT"; fi',
      ...lists.flatMap((l, n) => [
        `list${n}=""`,
        ...l.apps.map((a) => `if hit ${a.id}; then list${n}="\${list${n}:+$list${n},}"'${l.item(a)}'; fi`),
        `echo "${l.key}=[$list${n}]" >> "$GITHUB_OUTPUT"`,
      ]),
    ];
    blocks.push(
      block('changes.header', 'changes: job settings', ['  changes:', `    runs-on: ${runner}`, timeout, '    outputs:', ['any', 'changed', ...lists.map((l) => l.key)].map((k) => `      ${k}: ${x(`steps.diff.outputs.${k}`)}`), '    steps:'], false),
      ...stepBlocks('changes', [
        { ...CHECKOUT, with: { 'fetch-depth': 0, ...CHECKOUT.with } },
        { key: 'diff', id: 'diff', title: 'Find the changed services', run, env: { EVENT_NAME: x('github.event_name'), BEFORE: x('github.event.before'), BASE_REF: x('github.base_ref') } },
      ]),
    );
  }

  // -- test: one job per group of apps that run the same steps, a matrix over the apps in a group
  for (const group of groups) {
    jobIds.push(group.id);
    const grouped = group.apps.length > 1;
    const matrix = {
      ...(p.os.length && { os: p.os }),
      ...(group.versions.length && { version: group.versions }),
      ...(grouped && !changed && { service: group.apps.map((a) => a.id), include: group.apps.map((a) => ({ service: a.id, dir: a.dir })) }),
    };
    const matrixLines = [...Object.entries(matrix).map(([k, v]) => `        ${k}: ${JSON.stringify(v)}`), grouped && changed && `        dir: ${listOf(group.id)}`].filter(Boolean);
    const steps = stepsInDir(group.steps, grouped ? x('matrix.dir') : group.apps[0].dir);
    blocks.push(
      block(
        `${group.id}.header`,
        `${group.id}: job settings`,
        [
          `  ${group.id}:`,
          changed && '    needs: changes',
          changed && `    if: ${q(grouped ? some(group.id) : changedApp(group.apps[0]))}`,
          `    runs-on: ${p.os.length ? x('matrix.os') : runner}`,
          timeout,
          matrixLines.length > 0 && ['    strategy:', `      fail-fast: ${p.failFast}`, '      matrix:', matrixLines],
          p.os.some((o) => !o.startsWith('ubuntu')) && ['    defaults:', '      run:', '        shell: bash'],
          when(p.services.length, '    services:', p.services.flatMap(service)),
          when(p.services.length, '    env:', mapLines(Object.fromEntries(p.services.map((n) => serviceUrl(n, 'localhost', p.services))), '      ')),
          '    steps:',
        ],
        false,
      ),
      ...stepBlocks(group.id, [CHECKOUT, ...steps]),
    );
  }

  // -- lint-dockerfile
  if (p.lintDockerfile) {
    blocks.push(
      block('lint-dockerfile.header', 'lint-dockerfile: job settings', [
        '  lint-dockerfile:',
        changed && '    needs: changes',
        changed && `    if: ${q(some('lint'))}`,
        `    runs-on: ${runner}`,
        timeout,
        multi && ['    strategy:', '      fail-fast: false', '      matrix:', `        include: ${changed ? listOf('lint') : JSON.stringify(p.apps.map((a) => ({ service: a.id, dockerfile: inApp(a, 'Dockerfile') })))}`],
        '    steps:',
      ]),
      ...stepBlocks('lint-dockerfile', [
        CHECKOUT,
        { key: 'hadolint', uses: 'hadolint/hadolint-action@v3.1.0', with: { dockerfile: multi ? x('matrix.dockerfile') : inApp(p.apps[0], 'Dockerfile'), 'failure-threshold': 'error' } },
      ]),
    );
  }
  const gates = [changed && 'changes', ...jobIds, p.lintDockerfile && 'lint-dockerfile'].filter(Boolean);
  const needsLine = (jobs) => (jobs.length ? `    needs: ${jobs.length > 1 ? `[${jobs.join(', ')}]` : jobs[0]}` : null);

  // -- image
  const multiArch = p.platforms.length > 1 || p.platforms.some((pl) => pl !== 'linux/amd64');
  // With several services the image job is a matrix and every per-service value comes from the matrix entry.
  const matrixApp = { id: x('matrix.service') };
  const imageName = (template) => imageRepo(template, p, multi ? matrixApp : p.apps[0]);
  if (registry) {
    // What both builds of the image share: the folder and the build args.
    const build = {
      context: multi ? x('matrix.dir') : p.apps[0].dir,
      ...(withArgs && { 'build-args': multi ? x('steps.args.outputs.value') : p.apps[0].buildArgs.map((n) => `${n}=${x(`vars.${n}`)}`).join('\n') }),
    };
    const tags = [...p.imageTags.filter((k) => k !== 'latest').flatMap((k) => IMAGE_TAGS[k]), 'type=sha,format=long', ...(p.imageTags.includes('latest') ? IMAGE_TAGS.latest : [])];
    blocks.push(
      block('image.header', 'image: job settings', [
        '  image:',
        needsLine(gates),
        // Tests that were skipped because nothing changed must not stop the image jobs that did.
        changed && `    if: ${q(`!cancelled() && !failure() && ${some('images')}`)}`,
        `    runs-on: ${runner}`,
        timeout,
        permissionLines(jobPermissions({ ...(p.registryId === 'builtin' && { packages: 'write' }), ...((p.oidc || p.sign) && { 'id-token': 'write' }) }), '    '),
        multi
          ? [
              '    strategy:',
              '      fail-fast: false',
              '      matrix:',
              `        include: ${changed ? listOf('images') : JSON.stringify(p.apps.map((a) => ({ service: a.id, dir: a.dir, ...(withArgs && { args: argNames(a) }) })))}`,
            ]
          : ['    outputs:', `      image: ${x('steps.ref.outputs.image')}`],
        '    steps:',
      ]),
      ...stepBlocks('image', [
        CHECKOUT,
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
          env: { IMAGE_NAME: imageName(registry.image) },
        },
        // Each service passes its own build args: the matrix names them, the step reads their values from the variables.
        multi && withArgs && {
          key: 'build-args',
          title: 'Collect the build args',
          id: 'args',
          run: ['{', "  echo 'value<<DOCKCRATE_EOF'", '  for n in $ARG_NAMES; do printf \'%s=%s\\n\' "$n" "${!n}"; done', "  echo 'DOCKCRATE_EOF'", '} >> "$GITHUB_OUTPUT"'],
          env: { ARG_NAMES: x('matrix.args'), ...Object.fromEntries([...new Set(p.apps.flatMap((a) => a.buildArgs))].map((n) => [n, x(`vars.${n}`)])) },
        },
        {
          key: 'metadata',
          id: 'meta',
          uses: 'docker/metadata-action@v5',
          with: { images: x('steps.ref.outputs.name'), tags: tags.join('\n') },
        },
        // With a scan, the image is built for one platform and loaded into the runner's Docker first, scanned, and only pushed
        // (every platform, from the layer cache) and signed when the scan passed. Pull requests are built and scanned, never pushed.
        p.scan && {
          key: 'build-scan',
          title: 'Build the image to scan',
          uses: 'docker/build-push-action@v6',
          with: {
            ...build,
            ...(p.platforms.length && { platforms: p.platforms[0] }),
            load: 'true',
            push: 'false',
            provenance: 'false',
            tags: x('steps.ref.outputs.image'),
            ...(p.layerCache && { 'cache-from': 'type=gha', 'cache-to': 'type=gha,mode=max' }),
          },
        },
        p.scan && {
          key: 'trivy',
          uses: 'aquasecurity/trivy-action@0.35.0',
          with: { 'image-ref': x('steps.ref.outputs.image'), severity: p.scanSeverity.join(','), 'ignore-unfixed': 'true', 'exit-code': '1' },
        },
        {
          key: 'build-push',
          id: 'build',
          ...(p.scan && { title: 'Build and push the image', if: NOT_PR }),
          uses: 'docker/build-push-action@v6',
          with: {
            ...build,
            ...(p.sbom && { sbom: 'true', provenance: 'mode=max' }),
            ...(p.platforms.length && { platforms: p.platforms.join(',') }),
            push: p.scan ? 'true' : x(NOT_PR),
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
      ]),
    );
  }

  // -- deploy
  if (deploys) {
    const deployEnv = {
      APP: appName,
      ...(!multi && { PORT: p.apps[0].port }),
      // A matrix job has no single output, so with several services the deploy job works the image names out itself.
      ...(registry && !multi && { IMAGE: x('needs.image.outputs.image') }),
      ...(target.usesRegistryEnv && registry.env),
      ...(changed && { DEPLOY_SERVICES: out('changed') }),
    };
    const imageRefs = registry && multi && {
      key: 'image-refs',
      title: 'Compute the image names',
      run: p.apps.flatMap((a) => [
        `name=$(printf '%s' "$IMAGE_NAME_${a.key}" | tr '[:upper:]' '[:lower:]')`,
        `echo "${a.imageEnv}=$name:sha-$GITHUB_SHA" >> "$GITHUB_ENV"`,
      ]),
      env: Object.fromEntries(p.apps.map((a) => [`IMAGE_NAME_${a.key}`, imageRepo(registry.image, p, a)])),
    };
    const needs = target.needs?.({ platform: 'github', oidc: p.oidc }) ?? { secrets: [], vars: [] };
    for (const name of needs.secrets) deployEnv[name] = x(`secrets.${name}`);
    for (const raw of needs.vars) {
      const name = raw.replace(/\?$/, '');
      deployEnv[name] = x(`vars.${name}`);
    }
    for (const d of p.deployments) {
      blocks.push(
        block(`${d.id}.header`, `${d.id}: job settings`, [
          `  ${d.id}:`,
          needsLine(registry ? [...(changed ? ['changes'] : []), 'image'] : gates),
          `    if: ${q(changed ? `(${deployCondition(p, d)}) && !cancelled() && !failure() && needs.changes.outputs.any == 'true'` : deployCondition(p, d))}`,
          `    runs-on: ${runner}`,
          timeout,
          `    environment: ${d.name}`,
          '    concurrency:',
          `      group: deploy-${d.name}`,
          '      cancel-in-progress: false',
          permissionLines(jobPermissions({ ...(target.usesRegistryEnv && !extra.packages && { packages: 'read' }), ...(p.oidc && { 'id-token': 'write' }) }), '    '),
          '    steps:',
        ]),
        ...stepBlocks(d.id, [
          CHECKOUT,
          ...auth.map((s) => ({ key: 'cloud-login', ...s })),
          ...(target.github?.prepare ?? []).map((s) => ({ key: 'prepare', ...s })),
          imageRefs,
          { key: 'deploy', title: 'Deploy', run: target.script({ appName, port: p.apps[0].port, composeFile: p.composeFile, composeFiles: d.composeFiles, apps: p.apps, ...(changed && { changedOnly: true }) }), env: deployEnv },
        ]),
      );
    }
  }
  return blocks;
}

/** CodeQL gets its own workflow file; with several languages the analysis is a matrix over them. */
function codeqlFiles(p, stacks) {
  const stepBlocks = stepper(p);
  const languages = [...new Set(stacks.map((s) => s.codeql).filter(Boolean))];
  if (!p.codeScan || !languages.length) return [];
  const t = p.triggers;
  const several = languages.length > 1;
  const buildMode = (language) => (language === 'go' ? 'autobuild' : 'none');
  const language = several ? x('matrix.language') : languages[0];
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
        block('analyze.header', 'analyze: job settings', [
          '  analyze:',
          `    runs-on: ${p.runner || 'ubuntu-latest'}`,
          several && ['    strategy:', '      fail-fast: false', '      matrix:', `        include: ${JSON.stringify(languages.map((l) => ({ language: l, 'build-mode': buildMode(l) })))}`],
          '    permissions:',
          '      contents: read',
          '      security-events: write',
          '    steps:',
        ], false),
        ...stepBlocks('analyze', [
          CHECKOUT,
          { key: 'init', uses: 'github/codeql-action/init@v3', with: { languages: language, 'build-mode': several ? x("matrix['build-mode']") : buildMode(languages[0]) } },
          { key: 'analyze', uses: 'github/codeql-action/analyze@v3', with: { category: `/language:${language}` } },
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
  deploySecretsNote: ({ secrets, environments }) =>
    `Keep ${secrets} as environment secrets of ${environments} (Settings > Environments), not repository secrets, and protect each environment (required reviewers, deployment branches and tags limited to the ones that deploy): only the deploy job, which names the environment, can read them then. The image job has no environment, so the registry login stays in repository secrets.`,
  features: [...COMMON, 'release', 'sbom', 'sign', 'codeScan', 'pinActions'],
  render,
  extraFiles: codeqlFiles,
};

/** Gitea and Forgejo run GitHub Actions workflows, from .gitea/workflows; they have no GitHub token or OIDC. */
export const gitea = {
  label: 'Gitea / Forgejo Actions',
  path: '.gitea/workflows/ci.yml',
  builtinRegistry: false,
  secretsLocation: 'Gitea (Settings > Actions > Secrets and Variables)',
  features: ['prBranches', 'manual', 'schedule', 'paths', 'os', 'services', 'runner', 'timeout', 'tagFilters', 'branchIgnore', 'depCache', 'layerCache', 'platforms', 'pinActions'],
  notes: () => ['Gitea Actions needs a registered act runner; actions are pulled from github.com by default and pinned to full commit SHAs.'],
  deploySecretsNote: ({ secrets }) =>
    `Gitea has no protected environments: every workflow of the repository can read ${secrets}, so limit who can push workflows (branch protection, write access) and give these credentials the least access that deploys (a deploy-only SSH user, a namespaced Kubernetes ServiceAccount, a deploy token).`,
  render,
};
