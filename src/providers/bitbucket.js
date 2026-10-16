import { block, changedGuard, changedLines, cmd, defaultBranch, deployPlan, dockerRunDeploy, exportLine, isClassicDeploy, isMulti, mapLines, q, serviceEnv, serviceUrl, shellPlan, switchOn, switchVar } from './common.js';
import { DBS } from '../compose.js';
import { VERSIONS } from '../tools.js';

const REF = [
  'REF_SLUG=$(printf "%s" "${BITBUCKET_BRANCH:-$BITBUCKET_TAG}" | tr -c "A-Za-z0-9_.\\n-" "-")',
];

function render(p) {
  const { triggers: t } = p;
  const vars = { stepOn: switchOn, sha: 'BITBUCKET_COMMIT', refSlug: 'REF_SLUG', tag: 'BITBUCKET_TAG', version: '$VERSION', pre: REF, defaultBranchTest: `[ "$BITBUCKET_BRANCH" = "${defaultBranch(p)}" ]` };
  const multi = isMulti(p);
  const plans = p.apps.map((app) => ({ app, plan: shellPlan(p, app, vars) }));
  const registry = plans[0].plan.registry;
  const several = p.deployments.length > 1;
  const deployAnchor = (d) => (several ? `deploy-step-${d.name}` : 'deploy-step');
  const anchor = (base, app) => (multi ? `${base}-${app.id}` : base);
  const exportEnv = p.pipelineEnv.map(exportLine);
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
  const changed = p.changedOnly;
  // Steps share CHANGED through an artifact: the first step writes it, every later one reads it before doing anything.
  const readChanged = ['. ./changed.env'];
  const guard = (app) => (changed ? [[...readChanged, changedGuard(app)]] : []);
  if (changed) {
    const base = defaultBranch(p);
    step('changes', 'detect the changed services', [
      ...header('Detect changed services', 'changes', ['        clone:', '          depth: full']),
      ...script([
        [
          ...changedLines(p, {
            ciPath: 'bitbucket-pipelines.yml',
            setup: [
              'if [ -n "$BITBUCKET_TAG" ]; then ALL=1; fi',
              `git fetch --quiet origin "${base}" 2>/dev/null || true`,
              'if [ -n "$BITBUCKET_PR_DESTINATION_BRANCH" ]; then BASE=$(git merge-base "origin/$BITBUCKET_PR_DESTINATION_BRANCH" HEAD || true)',
              `elif [ "$BITBUCKET_BRANCH" = "${base}" ]; then BASE=$(git rev-parse HEAD^ 2>/dev/null || true)`,
              `else BASE=$(git merge-base "origin/${base}" HEAD 2>/dev/null || true); fi`,
            ],
          }),
          'echo "CHANGED=$CHANGED" > changed.env',
        ],
      ]),
      '        artifacts:',
      '          - changed.env',
    ]);
    // Manual pipelines do everything.
    step('changes-all', 'every service', [...header('Every service', 'changes-all'), ...script(['echo "CHANGED=,all," > changed.env']), '        artifacts:', '          - changed.env']);
  }
  const testIds = [];
  if (p.testJob) {
    const serviceEnvLines = p.services.map((n) => serviceUrl(n, 'localhost', p.services)).map(exportLine);
    for (const app of p.apps) {
      const versions = app.versions.length ? app.versions : [null];
      versions.forEach((v) => {
        const planV = shellPlan(p, app, vars, { version: v ?? undefined });
        const id = anchor('test', app) + (v ? `-${v.replace(/[^\w]/g, '')}` : '');
        testIds.push(id);
        const label = [multi && app.id, v].filter(Boolean).join(' ');
        step(id, `test${label ? ` (${label})` : ''}`, [
          ...header(`Test${label ? ` ${label}` : ''}`, id, [`        image: ${planV.testImage}`, timeout, p.services.length > 0 && `        services: [${p.services.join(', ')}]`].filter(Boolean)),
          ...script([...guard(app), ...serviceEnvLines, ...planV.testCommands]),
        ]);
      });
    }
  }
  if (p.lintDockerfile) {
    step('lint', 'lint Dockerfile', [...header('Lint Dockerfile', 'lint', [`        image: ${VERSIONS.hadolint}`, timeout].filter(Boolean)), ...script(plans.map(({ plan }) => plan.lintDockerfile))]);
  }
  if (registry) {
    for (const { app, plan } of plans) {
      step(anchor('image', app), `build and push image${multi ? ` (${app.id})` : ''}`, [
        ...header(`Build and push image${multi ? ` ${app.id}` : ''}`, anchor('image-step', app), ['        image: docker:27-cli', '        services: [docker]', timeout].filter(Boolean)),
        ...script([...guard(app), ...plan.prelude, ...plan.login, ...plan.build, p.scan && plan.scan, plan.push].filter(Boolean)),
      ]);
    }
  }
  if (p.target.script) {
    for (const dep of p.deployments) {
      const d = deployPlan(p, dep, vars);
      step(dep.id, dep.id.replace('-', ' '), [
        ...header(`Deploy${several ? ` ${dep.name}` : ''}`, deployAnchor(dep), ['        image: docker:27-cli', '        services: [docker]', `        deployment: ${dep.name}`, dep.on === 'manual' && '        trigger: manual', timeout].filter(Boolean)),
        ...script([...(changed ? readChanged : []), ...d.prelude, dockerRunDeploy(d)]),
      ]);
    }
  }

  // Bitbucket names a step by its YAML anchor; every test step runs side by side.
  const testStepRef = (id) => `*${id}`;
  const testRefs = p.testJob ? (testIds.length > 1 ? ['    - parallel:', ...testIds.map((id) => `        - step: ${testStepRef(id)}`)] : [`    - step: ${testStepRef(testIds[0])}`]) : [];
  const imageRefs = registry ? plans.map(({ app }) => `    - step: *${anchor('image-step', app)}`) : [];
  const flow = (extra, { all = false } = {}) => [
    ...(changed ? [`    - step: *${all ? 'changes-all' : 'changes'}`] : []),
    ...testRefs,
    ...(p.lintDockerfile ? ['    - step: *lint'] : []),
    ...extra,
  ];
  // Bitbucket starts a pipeline per branch or tag pattern, so each deployment goes into the pipelines it belongs to.
  const refOf = (d) => `    - step: *${deployAnchor(d)}`;
  const branchPipes = new Map(t.branches.map((b) => [b, []]));
  const tagPipes = new Map(t.tags.map((g) => [g, []]));
  const manualDeploys = [];
  const put = (map, key, ref) => map.set(key, [...(map.get(key) ?? []), ref]);
  if (p.target.script) {
    for (const d of p.deployments) {
      if (d.on === 'tag') for (const key of d.match ? [d.match] : t.tags) put(tagPipes, key, refOf(d));
      else if (isClassicDeploy(p)) {
        for (const key of t.branches) put(branchPipes, key, refOf(d));
        manualDeploys.push(refOf(d));
      } else if (d.on === 'manual') manualDeploys.push(refOf(d));
      else put(branchPipes, d.match ?? defaultBranch(p), refOf(d));
    }
  }
  const pushFlow = (deploys, opts) => flow([...imageRefs, ...deploys], opts);
  const tagFlow = (deploys) => flow([...imageRefs, ...deploys]);

  const pipes = ['pipelines:'];
  if (t.pullRequests) pipes.push('  pull-requests:', `    '**':`, ...flow([]).map((l) => `  ${l}`));
  if (branchPipes.size) {
    pipes.push('  branches:');
    for (const [b, deploys] of branchPipes) pipes.push(`    ${q(b)}:`, ...pushFlow(deploys).map((l) => `  ${l}`));
  }
  if (tagPipes.size) {
    pipes.push('  tags:');
    for (const [g, deploys] of tagPipes) pipes.push(`    ${q(g)}:`, ...tagFlow(deploys).map((l) => `  ${l}`));
  }
  if (t.manual) {
    const variables = p.manualSteps.flatMap((step) => [`            - name: ${switchVar(step)}`, '              default: "true"', '              allowed-values: ["true","false"]']);
    pipes.push('  custom:', '    manual:', variables.length > 0 && ['      - variables:', variables], ...pushFlow(manualDeploys, { all: true }).map((l) => `  ${l}`));
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
  deploySecretsNote: ({ secrets, environments }) =>
    `Keep ${secrets} as secured deployment variables of ${environments} (Repository settings > Deployments), not repository variables: only the deploy step, which names the deployment, sees them. Restrict who and which branches can deploy to it (deployment permissions, on Premium).`,
  notes: ({ triggers }) => [
    'Bitbucket allows 4 steps per service total and 3 service containers (Docker counts as one) per step.',
    triggers.schedule.length && `Bitbucket schedules live in the UI: Pipelines > Schedules, with cron "${triggers.schedule[0]}".`,
    'Branch and tag patterns use Bitbucket glob syntax; path and ignore filters are not generated.',
  ].filter(Boolean),
  render,
};
