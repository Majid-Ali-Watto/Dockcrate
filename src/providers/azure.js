import { block, cmd, defaultBranch, dockerRunDeploy, mapLines, q, scalar, serviceEnv, serviceUrl, shellPlan } from './common.js';
import { DBS } from '../compose.js';

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

function render(p, ciSteps) {
  const { triggers: t } = p;
  const vars = { sha: 'BUILD_SOURCEVERSION', refSlug: 'REF_SLUG', tag: 'TAG_NAME', version: '$(VERSION)', pre: REF, defaultBranchTest: `[ "$BUILD_SOURCEBRANCHNAME" = "${defaultBranch(p)}" ]` };
  const plan = shellPlan(p, ciSteps, vars, { alpine: false });
  const vmImage = p.runner || 'ubuntu-latest';
  const timeout = p.timeout ? `    timeoutInMinutes: ${p.timeout}` : null;
  const registrySecrets = p.registryNeeds.secrets;
  const mapped = (names) => (names.length ? names.reduce((o, n) => ({ ...o, [n]: `$(${n})` }), {}) : null);
  const blocks = [];

  blocks.push(block('name', 'Run name', `name: ${q(`${p.workflowName} $(Date:yyyyMMdd)$(Rev:.r)`)}`, false));
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

  const gates = [p.testJob && 'test', p.lintDockerfile && 'lint_dockerfile'].filter(Boolean);
  const depends = (names) => (names.length ? `    dependsOn: [${names.join(', ')}]` : null);
  const notPr = "ne(variables['Build.Reason'], 'PullRequest')";

  if (p.testJob) {
    const matrix = {};
    const versions = p.versions.length ? p.versions : [null];
    const systems = p.os.length ? p.os : [null];
    for (const o of systems) for (const v of versions) matrix[`${(o ?? 'default').replace(/\W/g, '_')}${v ? `_${v.replace(/\W/g, '_')}` : ''}`] = { ...(o && { vmImage: o }), ...(v && { VERSION: v }) };
    const matrixed = p.os.length > 0 || p.versions.length > 0;
    const tp = shellPlan(p, ciSteps, vars, { alpine: false });
    const setup = tp.testSteps.flatMap((s) => (s.uses ? (toolStep(s) ? [toolStep(s)] : []) : [])).flatMap((l) => l);
    const urls = p.services.map((n) => serviceUrl(n, 'localhost'));
    const env = Object.fromEntries(urls);
    blocks.push(
      block('test.header', 'test: job settings', [
        '  - job: test',
        '    displayName: Test',
        '    pool:',
        `      vmImage: ${matrixed && p.os.length ? '$(vmImage)' : vmImage}`,
        timeout,
        matrixed && ['    strategy:', '      matrix:', Object.entries(matrix).map(([k, v]) => [`        ${k}:`, mapLines(v, '          ').map((l) => l.replace(/"/g, "'"))])],
        p.services.length > 0 && ['    services:', p.services.map((n) => `      ${n}: ${n}`)],
        '    steps:',
        '      - checkout: self',
      ], false),
      ...(setup.length ? [block('test.tools', 'test: install the toolchain', indent(setup, '      ').map((l, i) => l).map((l) => l), false)] : []),
      block('test.run', 'test: run the steps', indent(tp.testCommands.flatMap((c) => item(c, Object.keys(env).length ? env : null)), '      '), false),
    );
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
        '      - bash: docker run --rm -i hadolint/hadolint hadolint --failure-threshold error - < Dockerfile',
        '        displayName: Hadolint',
      ]),
    );
  }
  if (plan.registry) {
    blocks.push(
      block('image', 'image: job', [
        '  - job: image',
        '    displayName: Build and push image',
        depends(gates),
        `    condition: and(succeeded(), ${notPr})`,
        '    pool:',
        `      vmImage: ${vmImage}`,
        timeout,
        '    steps:',
        '      - checkout: self',
        indent(item([...plan.prelude, ...plan.login, ...plan.build, p.scan && plan.scan, plan.push].filter(Boolean), mapped(registrySecrets), 'Build, scan and push the image'), '      '),
      ].filter((l) => l !== undefined)),
    );
  }
  if (plan.deploy) {
    const d = plan.deploy;
    const cond = {
      branch: `eq(variables['Build.SourceBranch'], 'refs/heads/${defaultBranch(p)}')`,
      tag: "startsWith(variables['Build.SourceBranch'], 'refs/tags/')",
      manual: "eq(variables['Build.Reason'], 'Manual')",
    }[p.deployOn];
    blocks.push(
      block('deploy', 'deploy: job', [
        '  - deployment: deploy',
        '    displayName: Deploy',
        depends(plan.registry ? ['image'] : gates),
        `    condition: and(succeeded(), ${cond})`,
        `    environment: ${p.environment}`,
        '    pool:',
        `      vmImage: ${vmImage}`,
        timeout,
        '    strategy:',
        '      runOnce:',
        '        deploy:',
        '          steps:',
        '            - checkout: self',
        indent(item([...plan.prelude, dockerRunDeploy(d)].flat(), mapped([...p.targetNeeds.secrets, ...registrySecrets]), 'Deploy'), '            '),
      ]),
    );
  }
  return blocks;
}

export const azure = {
  label: 'Azure DevOps Pipelines',
  path: 'azure-pipelines.yml',
  builtinRegistry: false,
  secretsLocation: 'Azure DevOps (Pipelines > Library or the pipeline variables; mark the secrets as secret)',
  features: ['prBranches', 'manual', 'schedule', 'paths', 'os', 'services', 'runner', 'timeout', 'tagFilters', 'branchIgnore'],
  notes: () => [
    'Azure DevOps pull-request triggers apply to GitHub and Bitbucket repositories; for Azure Repos use a branch policy with this pipeline as the build validation.',
    'Azure DevOps has no run-cancellation setting in YAML, so the concurrency option is not applied.',
  ],
  render,
};
