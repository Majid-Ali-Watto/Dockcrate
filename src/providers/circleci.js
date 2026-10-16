import { block, changedGuard, changedLines, cmd, defaultBranch, deployPlan, dockerRunDeploy, exportLine, isMulti, jobId, mapLines, matchRegex, q, serviceEnv, serviceUrl, shellPlan } from './common.js';
import { DBS } from '../compose.js';
import { VERSIONS } from '../tools.js';

const REF = [
  'REF_SLUG=$(printf "%s" "${CIRCLE_BRANCH:-$CIRCLE_TAG}" | tr -c "A-Za-z0-9_.\\n-" "-")',
];

const run = (name, command) => (Array.isArray(command)
  ? [`      - run:`, `          name: ${q(name)}`, '          command: |', ...command.map((l) => `            ${l}`)]
  : ['      - run:', `          name: ${q(name)}`, `          command: ${cmd(command)}`]);

function render(p) {
  const { triggers: t } = p;
  const vars = { sha: 'CIRCLE_SHA1', refSlug: 'REF_SLUG', tag: 'CIRCLE_TAG', version: '<< parameters.version >>', pre: REF, defaultBranchTest: `[ "$CIRCLE_BRANCH" = "${defaultBranch(p)}" ]` };
  const multi = isMulti(p);
  const plans = p.apps.map((app) => ({ app, plan: shellPlan(p, app, vars, { alpine: false }) }));
  const registry = plans[0].plan.registry;
  const machine = ['    machine:', `      image: ${VERSIONS.circleciMachine}`];
  const blocks = [block('version', 'Config version', 'version: 2.1', false)];
  const exportEnv = p.pipelineEnv.map(exportLine);
  const jobs = ['jobs:'];
  const names = [];
  const add = (id, title, lines) => {
    names.push(id);
    blocks.push(block(`job.${id}`, `Job: ${title}`, lines, names.length > 1));
  };
  blocks.push(block('jobs', 'Jobs', jobs));

  const changed = p.changedOnly;
  // The changes job leaves CHANGED in a workspace file; a service's jobs halt (successfully) when its folder did not change.
  const readChanged = ['      - attach_workspace:', '          at: /tmp/ws'];
  const guard = (app) => (changed ? [readChanged, run('Skip when unchanged', ['. /tmp/ws/changed.env', changedGuard(app).replace('exit 0', 'circleci-agent step halt')])] : []);
  if (changed) {
    const base = defaultBranch(p);
    add('changes', 'changes', [
      '  changes:',
      '    parameters:',
      '      all:',
      '        type: boolean',
      '        default: false',
      '    docker:',
      `      - image: ${VERSIONS.circleciBase}`,
      '    steps:',
      '      - checkout',
      run('Find the changed services', [
        'mkdir -p /tmp/ws',
        ...changedLines(p, {
          ciPath: '.circleci/config.yml',
          setup: [
            'if [ "<< parameters.all >>" = true ] || [ -n "$CIRCLE_TAG" ]; then ALL=1; fi',
            `git fetch --quiet origin "${base}" 2>/dev/null || true`,
            `if [ "$CIRCLE_BRANCH" = "${base}" ]; then BASE=$(git rev-parse HEAD^ 2>/dev/null || true); else BASE=$(git merge-base "origin/${base}" HEAD 2>/dev/null || true); fi`,
          ],
        }),
        'echo "CHANGED=$CHANGED" > /tmp/ws/changed.env',
      ]),
      '      - persist_to_workspace:',
      '          root: /tmp/ws',
      '          paths: [changed.env]',
    ]);
  }

  if (p.testJob) {
    for (const { app, plan: tp } of plans) {
      const env = Object.fromEntries(p.services.map((n) => serviceUrl(n, 'localhost', p.services)));
      const id = jobId(p, app, 'test');
      add(id, id, [
        `  ${id}:`,
        app.versions.length > 0 && ['    parameters:', '      version:', '        type: string'],
        '    docker:',
        `      - image: ${tp.testImage}`,
        p.services.map((n) => [`      - image: ${DBS[n].image}`, Object.keys(serviceEnv(n)).length > 0 && ['        environment:', mapLines(serviceEnv(n), '          ')]]),
        Object.keys(env).length > 0 && ['    environment:', mapLines(env, '      ')],
        '    steps:',
        '      - checkout',
        guard(app),
        tp.testCommands.length > 0 ? tp.testCommands.map((c, i) => run(tp.testTitles[i].slice(0, 50), [...exportEnv, c])) : run('No test steps selected', 'echo "No test steps selected"'),
      ]);
    }
  }
  if (p.lintDockerfile) {
    add('lint-dockerfile', 'lint-dockerfile', ['  lint-dockerfile:', '    docker:', `      - image: ${VERSIONS.hadolint}`, '    steps:', '      - checkout', plans.map(({ app, plan }) => run(`Hadolint${multi ? ` ${app.id}` : ''}`, plan.lintDockerfile))]);
  }
  if (registry) {
    for (const { app, plan } of plans) {
      const id = jobId(p, app, 'image');
      add(id, id, [
        `  ${id}:`,
        machine,
        '    steps:',
        '      - checkout',
        guard(app),
        run('Build, scan and push the image', [...exportEnv, ...plan.prelude, ...plan.login, ...plan.build, p.scan && plan.scan, plan.push].filter(Boolean)),
      ]);
    }
  }
  if (p.target.script) {
    for (const dep of p.deployments) {
      const deploy = deployPlan(p, dep, vars, { alpine: false });
      add(dep.id, dep.id, [`  ${dep.id}:`, machine, '    steps:', '      - checkout', changed && readChanged, run('Deploy', [...exportEnv, ...(changed ? ['. /tmp/ws/changed.env'] : []), ...deploy.prelude, ...dockerRunDeploy(deploy)])]);
    }
  }

  // workflows: which job runs on what
  const branchFilter = (only, ignore) => [only.length > 0 && `only: ${JSON.stringify(only)}`, ignore.length > 0 && `ignore: ${JSON.stringify(ignore)}`].filter(Boolean);
  const tagFilter = [t.tags.length > 0 && `only: ${JSON.stringify(t.tags.map((g) => `/^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*?/g, '.*')}$/`))}`, t.tagsIgnore.length > 0 && `ignore: ${JSON.stringify(t.tagsIgnore.map((g) => `/^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*?/g, '.*')}$/`))}`].filter(Boolean);
  const wf = (jobName, { requires = [], deploy = null, versions = [], all = false } = {}) => {
    const out = [`      - ${jobName}:`];
    if (all) out.push('          all: true');
    if (versions.length) out.push('          matrix:', '            parameters:', `              version: ${JSON.stringify(versions)}`);
    if (requires.length) out.push('          requires: ' + JSON.stringify(requires));
    const kind = deploy?.on === 'tag' ? 'tag' : deploy?.on === 'branch' ? 'branch' : 'all';
    const branches = branchFilter(t.branches, t.branchesIgnore);
    const filters = [];
    const onlyMatch = (match) => `/${matchRegex(match)}/`;
    if (kind === 'branch') filters.push('            branches:', `              only: ${JSON.stringify([deploy.match ? onlyMatch(deploy.match) : defaultBranch(p)])}`);
    else if (kind === 'tag') filters.push('            branches:', '              ignore: /.*/');
    else if (branches.length) filters.push('            branches:', ...branches.map((l) => `              ${l}`));
    if (kind === 'branch' || (kind === 'all' && !tagFilter.length)) filters.push('            tags:', '              ignore: /.*/');
    else if (kind === 'tag' && deploy.match) filters.push('            tags:', `              only: ${JSON.stringify([onlyMatch(deploy.match)])}`);
    else if (tagFilter.length) filters.push('            tags:', ...tagFilter.map((l) => `              ${l}`));
    if (filters.length) out.push('          filters:', ...filters);
    return out;
  };
  const wfJobs = changed ? [wf('changes')] : [];
  const testJobs = p.testJob ? p.apps.map((app) => jobId(p, app, 'test')) : [];
  if (p.testJob) for (const app of p.apps) wfJobs.push(wf(jobId(p, app, 'test'), { versions: app.versions, requires: changed ? ['changes'] : [] }));
  if (p.lintDockerfile) wfJobs.push(wf('lint-dockerfile'));
  const gates = [changed && 'changes', ...testJobs, p.lintDockerfile && 'lint-dockerfile'].filter(Boolean);
  const imageJobs = registry ? p.apps.map((app) => jobId(p, app, 'image')) : [];
  for (const id of imageJobs) wfJobs.push(wf(id, { requires: gates }));
  if (p.target.script) {
    const after = registry ? imageJobs : gates;
    for (const dep of p.deployments) {
      if (dep.on === 'manual') {
        const hold = `hold-${dep.id}`;
        wfJobs.push([`      - ${hold}:`, '          type: approval', after.length > 0 && `          requires: ${JSON.stringify(after)}`].filter(Boolean));
        wfJobs.push(wf(dep.id, { requires: [hold] }));
      } else wfJobs.push(wf(dep.id, { requires: after, deploy: dep }));
    }
  }
  const workflows = ['workflows:', '  ci:', '    jobs:', ...wfJobs.flat()];
  if (t.schedule.length) {
    workflows.push('  scheduled:', '    triggers:', ...t.schedule.flatMap((cron) => [`      - schedule:`, `          cron: ${q(cron)}`, '          filters:', '            branches:', `              only: ${JSON.stringify([defaultBranch(p)])}`]), '    jobs:', ...(changed ? [wf('changes', { all: true }), ...wfJobs.slice(1)] : wfJobs).flat());
  }
  blocks.push(block('workflows', 'Workflows: which jobs run when', workflows));
  return blocks;
}

export const circleci = {
  label: 'CircleCI',
  path: '.circleci/config.yml',
  builtinRegistry: false,
  secretsLocation: 'CircleCI (Project settings > Environment variables, or a context)',
  features: ['schedule', 'services', 'tagFilters', 'branchIgnore'],
  deploySecretsNote: ({ secrets }) =>
    `Keep ${secrets} in a restricted context (Organization Settings > Contexts, limited to a security group), not in project environment variables, and add \`context: <name>\` to the deploy job in the workflow, so other jobs and forked pull requests never get them.`,
  notes: ({ triggers }) => [
    'CircleCI runs on every push to a branch, including pull-request branches; it has no separate pull-request trigger, so use branch filters to narrow it.',
    'CircleCI starts a workflow only for tags that a job explicitly allows: the tag filter above applies to every job.',
    triggers.schedule.length && 'Scheduled workflows run the same jobs on the default branch.',
  ].filter(Boolean),
  render,
};
