import { block, cmd, defaultBranch, dockerRunDeploy, mapLines, q, serviceEnv, serviceUrl, shellPlan } from './common.js';
import { DBS } from '../compose.js';

const REF = [
  'REF_SLUG=$(printf "%s" "${BITBUCKET_BRANCH:-$BITBUCKET_TAG}" | tr -c "A-Za-z0-9_.\\n-" "-")',
];

function render(p, ciSteps) {
  const { triggers: t } = p;
  const vars = { sha: 'BITBUCKET_COMMIT', refSlug: 'REF_SLUG', tag: 'BITBUCKET_TAG', version: '$VERSION', pre: REF, defaultBranchTest: `[ "$BITBUCKET_BRANCH" = "${defaultBranch(p)}" ]` };
  const plan = shellPlan(p, ciSteps, vars);
  const exportEnv = p.pipelineEnv.map(([k, v]) => `export ${k}=${JSON.stringify(v)}`);
  const timeout = p.timeout ? `        max-time: ${p.timeout}` : null;
  const blocks = [];
  blocks.push(block('image', 'Default image', 'image: atlassian/default-image:4', false));

  // services: databases for tests, plus docker for the image steps
  const defs = ['definitions:', '  services:', '    docker:', '      memory: 2048'];
  for (const n of p.services) {
    defs.push(`    ${n}:`, `      image: ${DBS[n].image}`);
    const env = serviceEnv(n);
    if (Object.keys(env).length) defs.push('      variables:', mapLines(env, '        '));
  }
  blocks.push(block('definitions', 'Definitions: services', defs));

  const steps = [];
  const step = (id, title, lines) => {
    steps.push(id);
    blocks.push(block(`step.${id}`, `Step: ${title}`, lines, false));
  };
  const header = (name, anchor, extra = []) => [`    - step: &${anchor}`, `        name: ${name}`, ...extra];
  // An array item is one multi-line command (a heredoc), written as a literal block so it stays a single command.
  const item = (c) => (Array.isArray(c) ? ['          - |', ...c.map((l) => `            ${l}`)] : [`          - ${cmd(c)}`]);
  const script = (cmds) => ['        script:', ...[...exportEnv, ...cmds].flatMap(item)];

  blocks.push(block('definitions.steps', 'Definitions: reusable steps', '  steps:', false));
  if (p.testJob) {
    const serviceEnvLines = p.services.map((n) => serviceUrl(n, 'localhost')).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`);
    const versions = p.versions.length ? p.versions : [null];
    versions.forEach((v) => {
      const planV = shellPlan({ ...p, versions: [] }, () => ciSteps(v ?? undefined), vars);
      const id = v ? `test-${v.replace(/[^\w]/g, '')}` : 'test';
      step(id, `test${v ? ` (${v})` : ''}`, [
        ...header(`Test${v ? ` ${v}` : ''}`, id, [`        image: ${planV.testImage}`, timeout, p.services.length > 0 && `        services: [${p.services.join(', ')}]`].filter(Boolean)),
        ...script([...serviceEnvLines, ...planV.testCommands]),
      ]);
    });
  }
  if (p.lintDockerfile) {
    step('lint', 'lint Dockerfile', [...header('Lint Dockerfile', 'lint', ['        image: hadolint/hadolint:latest-debian', timeout].filter(Boolean)), ...script([plan.lintDockerfile])]);
  }
  if (plan.registry) {
    step('image', 'build and push image', [
      ...header('Build and push image', 'image-step', ['        image: docker:27-cli', '        services: [docker]', timeout].filter(Boolean)),
      ...script([...plan.prelude, ...plan.login, ...plan.build, p.scan && plan.scan, plan.push].filter(Boolean)),
    ]);
  }
  if (plan.deploy) {
    const d = plan.deploy;
    step('deploy', 'deploy', [
      ...header('Deploy', 'deploy-step', ['        image: docker:27-cli', '        services: [docker]', `        deployment: ${p.environment}`, p.deployOn === 'manual' && '        trigger: manual', timeout].filter(Boolean)),
      ...script([...plan.prelude, dockerRunDeploy(d)]),
    ]);
  }

  const testRefs = p.testJob ? (p.versions.length ? [`    - parallel:`, ...p.versions.map((v) => `        - step: *test-${v.replace(/[^\w]/g, '')}`)] : ['    - step: *test']) : [];
  const flow = (extra) => [
    ...testRefs,
    ...(p.lintDockerfile ? ['    - step: *lint'] : []),
    ...extra,
  ];
  const pushFlow = flow([plan.registry && '    - step: *image-step', plan.deploy && p.deployOn !== 'tag' && '    - step: *deploy-step'].filter(Boolean));
  const tagFlow = flow([plan.registry && '    - step: *image-step', plan.deploy && p.deployOn === 'tag' && '    - step: *deploy-step'].filter(Boolean));

  const pipes = ['pipelines:'];
  if (t.pullRequests) pipes.push('  pull-requests:', `    '**':`, ...flow([]).map((l) => `  ${l}`));
  if (t.branches.length) {
    pipes.push('  branches:');
    for (const b of t.branches) pipes.push(`    ${q(b)}:`, ...pushFlow.map((l) => `  ${l}`));
  }
  if (t.tags.length) {
    pipes.push('  tags:');
    for (const g of t.tags) pipes.push(`    ${q(g)}:`, ...tagFlow.map((l) => `  ${l}`));
  }
  if (t.manual) {
    pipes.push('  custom:', '    manual:', ...pushFlow.map((l) => `  ${l}`));
  }
  blocks.push(block('pipelines', 'Pipelines: when each one runs', pipes));
  return blocks;
}

export const bitbucket = {
  label: 'Bitbucket Pipelines',
  path: 'bitbucket-pipelines.yml',
  builtinRegistry: false,
  secretsLocation: 'Bitbucket (Repository settings > Pipelines > Repository variables; mark the secrets as secured)',
  features: ['manual', 'services', 'timeout', 'schedule'],
  notes: ({ triggers }) => [
    'Bitbucket allows 4 steps per service total and 3 service containers (Docker counts as one) per step.',
    triggers.schedule.length && `Bitbucket schedules live in the UI: Pipelines > Schedules, with cron "${triggers.schedule[0]}".`,
    'Branch and tag patterns use Bitbucket glob syntax; path and ignore filters are not generated.',
  ].filter(Boolean),
  render,
};
