import { block, changedLines, cmd, defaultBranch, deployPlan, dockerRunDeploy, isMulti, jobId, manualLabel, mapLines, q, scalar, serviceEnv, serviceUrl, shellPlan, x } from './common.js';
import { DBS } from '../compose.js';
import { VERSIONS } from '../tools.js';

// Azure exposes its predefined variables to scripts as upper-case environment variables.
const REF = [
  'REF_SLUG=$(printf "%s" "$BUILD_SOURCEBRANCHNAME" | tr -c "A-Za-z0-9_.\\n-" "-")',
  'TAG_NAME=$(case "$BUILD_SOURCEBRANCH" in refs/tags/*) printf "%s" "${BUILD_SOURCEBRANCH#refs/tags/}";; esac)',
];

/** The Azure task (or script) that does what a GitHub `uses:` setup step does; null when the hosted agent already has it. */
function toolStep(step) {
  const name = step.uses?.replace(/@.*$/, '');
  const w = step.with ?? {};
  switch (name) {
    case 'actions/setup-node': return ['- task: NodeTool@0', '  inputs:', `    versionSpec: ${q(w['node-version'])}`];
    case 'actions/setup-python': return ['- task: UsePythonVersion@0', '  inputs:', `    versionSpec: ${q(w['python-version'])}`];
    case 'actions/setup-java': return ['- task: JavaToolInstaller@0', '  inputs:', `    versionSpec: ${q(w['java-version'])}`, '    jdkArchitectureOption: x64', '    jdkSourceOption: PreInstalled'];
    case 'actions/setup-dotnet': return ['- task: UseDotNet@2', '  inputs:', '    packageType: sdk', `    version: ${q(w['dotnet-version'])}`];
    case 'actions/setup-go': return ['- task: GoTool@0', '  inputs:', `    version: ${q(w['go-version'])}`];
    case 'ruby/setup-ruby': return ['- task: UseRubyVersion@0', '  inputs:', `    versionSpec: ${q(w['ruby-version'])}`];
    case 'shivammathur/setup-php': return ['- bash: sudo update-alternatives --set php /usr/bin/php' + w['php-version'], '  displayName: Select PHP'];
    case 'dtolnay/rust-toolchain': return ['- bash: rustup toolchain install ' + w.toolchain + ' --profile minimal && rustup default ' + w.toolchain, '  displayName: Select Rust'];
    default: return null;
  }
}

const indent = (lines, pad) => lines.map((l) => pad + l);
const item = (c, env, name) => [
  `- bash: ${Array.isArray(c) ? '|' : cmd(c)}`,
  ...(Array.isArray(c) ? c.map((l) => `    ${l}`) : []),
  `  displayName: ${q(name ?? (Array.isArray(c) ? c[0] : c).slice(0, 60))}`,
  ...(env ? ['  env:', ...mapLines(env, '    ')] : []),
];

function render(p) {
  const { triggers: t } = p;
  // Parameters are filled in when the pipeline is compiled, so the shell sees a literal true or false.
  const vars = { stepOn: (step) => `[ "${x(`lower(parameters.${step})`)}" = true ]`, sha: 'BUILD_SOURCEVERSION', refSlug: 'REF_SLUG', tag: 'TAG_NAME', version: '$(VERSION)', pre: REF, defaultBranchTest: `[ "$BUILD_SOURCEBRANCHNAME" = "${defaultBranch(p)}" ]` };
  const multi = isMulti(p);
  const plans = p.apps.map((app) => ({ app, plan: shellPlan(p, app, vars, { alpine: false }) }));
  const registry = plans[0].plan.registry;
  const vmImage = p.runner || 'ubuntu-latest';
  const timeout = p.timeout ? `    timeoutInMinutes: ${p.timeout}` : null;
  const registrySecrets = p.registryNeeds.secrets;
  const mapped = (names) => (names.length ? names.reduce((o, n) => ({ ...o, [n]: `$(${n})` }), {}) : null);
  const blocks = [];

  blocks.push(block('name', 'Run name', `name: ${q(`${p.workflowName} $(Date:yyyyMMdd)$(Rev:.r)`)}`, false));
  if (p.manualSteps.length) {
    const param = (step) => [`  - name: ${step}`, `    displayName: ${q(manualLabel(step))}`, '    type: boolean', '    default: true'];
    blocks.push(block('parameters', 'Parameters: the steps a manual run runs', ['parameters:', p.manualSteps.flatMap(param)]));
  }
  const filter = (key, inc, exc) => (inc.length || exc.length ? [`  ${key}:`, inc.length > 0 && `    include: ${JSON.stringify(inc)}`, exc.length > 0 && `    exclude: ${JSON.stringify(exc)}`] : null);
  blocks.push(
    block('trigger', 'CI trigger (push)', t.push ? ['trigger:', filter('branches', t.branches, t.branchesIgnore), filter('tags', t.tags, t.tagsIgnore), filter('paths', t.paths, t.pathsIgnore)] : 'trigger: none'),
    block('pr', 'Pull request trigger', t.pullRequests ? ['pr:', '  branches:', `    include: ${JSON.stringify(t.prBranches.length ? t.prBranches : ['*'])}`, filter('paths', t.paths, t.pathsIgnore)] : 'pr: none'),
  );
  if (t.schedule.length) {
    blocks.push(
      block('schedules', 'Schedules', ['schedules:', t.schedule.flatMap((cron, i) => [`  - cron: ${q(cron)}`, `    displayName: Scheduled run ${i + 1}`, '    branches:', `      include: [${q(defaultBranch(p))}]`, '    always: true'])]),
    );
  }
  if (p.pipelineEnv.length) blocks.push(block('variables', 'Variables', ['variables:', p.pipelineEnv.map(([k, v]) => `  ${k}: ${q(v)}`)]));
  if (p.services.length) {
    blocks.push(
      block('resources', 'Service containers', [
        'resources:',
        '  containers:',
        p.services.flatMap((n) => [`    - container: ${n}`, `      image: ${DBS[n].image}`, `      ports: ["${DBS[n].port}:${DBS[n].port}"]`, Object.keys(serviceEnv(n)).length > 0 && ['      env:', mapLines(serviceEnv(n), '        ')]]),
      ]),
    );
  }
  blocks.push(block('jobs', 'Jobs', 'jobs:'));

  const changed = p.changedOnly;
  const testJobs = p.testJob ? p.apps.map((app) => jobId(p, app, 'test', '_')) : [];
  const gates = [changed && 'changes', ...testJobs, p.lintDockerfile && 'lint_dockerfile'].filter(Boolean);
  const depends = (names) => (names.length ? `    dependsOn: [${names.join(', ')}]` : null);
  const notPr = "ne(variables['Build.Reason'], 'PullRequest')";
  // The changes job publishes CHANGED (`,all,` or `,api,web,`); jobs of unchanged services are skipped by their condition.
  const CHANGED = "dependencies.changes.outputs['detect.changed']";
  const isChanged = (app) => `or(contains(${CHANGED}, ',all,'), contains(${CHANGED}, ',${app.id},'))`;
  // Skipped dependencies (unchanged services) must not stop the jobs that do run, only failed ones do.
  const ok = changed ? 'not(or(failed(), canceled()))' : 'succeeded()';
  if (changed) {
    const base = defaultBranch(p);
    blocks.push(
      block('changes', 'changes: job', [
        '  - job: changes',
        '    displayName: Detect changed services',
        '    pool:',
        `      vmImage: ${vmImage}`,
        '    steps:',
        '      - checkout: self',
        '        fetchDepth: 0',
        '      - bash: |',
        ...[
          ...changedLines(p, {
            ciPath: 'azure-pipelines.yml',
            setup: [
              'case "$BUILD_SOURCEBRANCH" in refs/tags/*) ALL=1;; esac',
              'case "$BUILD_REASON" in Schedule|Manual) ALL=1;; esac',
              'if [ "$BUILD_REASON" = PullRequest ]; then BASE=$(git merge-base "origin/$SYSTEM_PULLREQUEST_TARGETBRANCHNAME" HEAD || true)',
              `elif [ "$BUILD_SOURCEBRANCH" = "refs/heads/${base}" ]; then BASE=$(git rev-parse HEAD^ 2>/dev/null || true)`,
              `else BASE=$(git merge-base "origin/${base}" HEAD 2>/dev/null || true); fi`,
            ],
          }),
          'echo "##vso[task.setvariable variable=changed;isOutput=true]$CHANGED"',
        ].map((l) => `          ${l}`),
        '        name: detect',
        '        displayName: Find the changed services',
      ]),
    );
  }

  if (p.testJob) {
    for (const app of p.apps) {
      const id = jobId(p, app, 'test', '_');
      const matrix = {};
      const versions = app.versions.length ? app.versions : [null];
      const systems = p.os.length ? p.os : [null];
      for (const o of systems) for (const v of versions) matrix[`${(o ?? 'default').replace(/\W/g, '_')}${v ? `_${v.replace(/\W/g, '_')}` : ''}`] = { ...(o && { vmImage: o }), ...(v && { VERSION: v }) };
      const matrixed = p.os.length > 0 || app.versions.length > 0;
      const tp = plans.find((x) => x.app === app).plan;
      const setup = tp.testSteps.flatMap((s) => (s.uses ? (toolStep(s) ? [toolStep(s)] : []) : [])).flatMap((l) => l);
      const urls = p.services.map((n) => serviceUrl(n, 'localhost', p.services));
      const env = Object.fromEntries(urls);
      blocks.push(
        block(`${id}.header`, `${id}: job settings`, [
          `  - job: ${id}`,
          `    displayName: Test${multi ? ` ${app.id}` : ''}`,
          changed && '    dependsOn: changes',
          changed && `    condition: and(succeeded(), ${isChanged(app)})`,
          '    pool:',
          `      vmImage: ${matrixed && p.os.length ? '$(vmImage)' : vmImage}`,
          timeout,
          matrixed && ['    strategy:', '      matrix:', Object.entries(matrix).map(([k, v]) => [`        ${k}:`, mapLines(v, '          ').map((l) => l.replace(/"/g, "'"))])],
          p.services.length > 0 && ['    services:', p.services.map((n) => `      ${n}: ${n}`)],
          '    steps:',
          '      - checkout: self',
        ], false),
        ...(setup.length ? [block(`${id}.tools`, `${id}: install the toolchain`, indent(setup, '      '), false)] : []),
        block(`${id}.run`, `${id}: run the steps`, indent(tp.testCommands.flatMap((c, i) => item(c, Object.keys(env).length ? env : null, tp.testTitles[i])), '      '), false),
      );
    }
  }
  if (p.lintDockerfile) {
    blocks.push(
      block('lint-dockerfile', 'lint_dockerfile: job', [
        '  - job: lint_dockerfile',
        '    displayName: Lint Dockerfile',
        '    pool:',
        `      vmImage: ${vmImage}`,
        timeout,
        '    steps:',
        '      - checkout: self',
        ...p.apps.flatMap((app) => [`      - bash: docker run --rm -i ${VERSIONS.hadolintPlain} hadolint --failure-threshold error - < ${app.dir === '.' ? '' : `${app.dir}/`}Dockerfile`, `        displayName: ${q(`Hadolint${multi ? ` ${app.id}` : ''}`)}`]),
      ]),
    );
  }
  const imageJobs = [];
  if (registry) {
    for (const { app, plan } of plans) {
      const id = jobId(p, app, 'image', '_');
      imageJobs.push(id);
      blocks.push(
        block(id, `${id}: job`, [
          `  - job: ${id}`,
          `    displayName: Build and push image${multi ? ` ${app.id}` : ''}`,
          depends(gates),
          `    condition: and(${ok}, ${notPr}${changed ? `, ${isChanged(app)}` : ''})`,
          '    pool:',
          `      vmImage: ${vmImage}`,
          timeout,
          '    steps:',
          '      - checkout: self',
          indent(item([...plan.prelude, ...plan.login, ...plan.build, p.scan && plan.scan, plan.push].filter(Boolean), mapped(registrySecrets), 'Build, scan and push the image'), '      '),
        ].filter((l) => l !== undefined)),
      );
    }
  }
  if (p.target.script) {
    for (const dep of p.deployments) {
      const d = deployPlan(p, dep, vars, { alpine: false, changed: '$(changed)' });
      const ref = (kind) => {
        const prefix = dep.match?.endsWith('*');
        const value = dep.match?.replace(/\*$/, '');
        return prefix ? `startsWith(variables['Build.SourceBranch'], 'refs/${kind}/${value}')` : `eq(variables['Build.SourceBranch'], 'refs/${kind}/${value}')`;
      };
      const cond = {
        branch: dep.match ? ref('heads') : `eq(variables['Build.SourceBranch'], 'refs/heads/${defaultBranch(p)}')`,
        tag: dep.match ? ref('tags') : "startsWith(variables['Build.SourceBranch'], 'refs/tags/')",
        manual: "eq(variables['Build.Reason'], 'Manual')",
      }[dep.on];
      blocks.push(
        block(dep.id, `${dep.id}: job`, [
          `  - deployment: ${dep.id.replaceAll('-', '_')}`,
          `    displayName: Deploy${p.deployments.length > 1 ? ` ${dep.name}` : ''}`,
          depends(registry ? ['changes', ...imageJobs].filter((n) => changed || n !== 'changes') : gates),
          `    condition: and(${ok}, ${cond}${changed ? `, ne(${CHANGED}, ',')` : ''})`,
          `    environment: ${dep.name}`,
          changed && ['    variables:', `      changed: $[ ${CHANGED} ]`],
          '    pool:',
          `      vmImage: ${vmImage}`,
          timeout,
          '    strategy:',
          '      runOnce:',
          '        deploy:',
          '          steps:',
          '            - checkout: self',
          indent(item([...d.prelude, dockerRunDeploy(d)].flat(), mapped([...p.targetNeeds.secrets, ...registrySecrets]), 'Deploy'), '            '),
        ]),
      );
    }
  }
  return blocks;
}

export const azure = {
  label: 'Azure DevOps Pipelines',
  path: 'azure-pipelines.yml',
  builtinRegistry: false,
  secretsLocation: 'Azure DevOps (Pipelines > Library or the pipeline variables; mark the secrets as secret)',
  features: ['prBranches', 'manual', 'schedule', 'paths', 'os', 'services', 'runner', 'timeout', 'tagFilters', 'branchIgnore'],
  deploySecretsNote: ({ secrets, environments }) =>
    `Keep ${secrets} as secret variables in a variable group (Pipelines > Library) open to this pipeline only, and add approvals and checks to the ${environments} environment (Pipelines > Environments): the deploy job waits for them before it runs.`,
  notes: () => [
    'Azure DevOps pull-request triggers apply to GitHub and Bitbucket repositories; for Azure Repos use a branch policy with this pipeline as the build validation.',
    'Azure DevOps has no run-cancellation setting in YAML, so the concurrency option is not applied.',
  ],
  render,
};
