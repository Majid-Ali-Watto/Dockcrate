import { block, cmd, defaultBranch, dockerRunDeploy, mapLines, q, serviceEnv, serviceUrl, shellPlan } from './common.js';
import { DBS } from '../compose.js';

const REF = [
  'REF_SLUG=$(printf "%s" "${CIRCLE_BRANCH:-$CIRCLE_TAG}" | tr -c "A-Za-z0-9_.\\n-" "-")',
];

const run = (name, command) => (Array.isArray(command)
  ? [`      - run:`, `          name: ${q(name)}`, '          command: |', ...command.map((l) => `            ${l}`)]
  : ['      - run:', `          name: ${q(name)}`, `          command: ${cmd(command)}`]);

function render(p, ciSteps) {
  const { triggers: t } = p;
  const vars = { sha: 'CIRCLE_SHA1', refSlug: 'REF_SLUG', tag: 'CIRCLE_TAG', version: '<< parameters.version >>', pre: REF, defaultBranchTest: `[ "$CIRCLE_BRANCH" = "${defaultBranch(p)}" ]` };
  const plan = shellPlan(p, ciSteps, vars, { alpine: false });
  const machine = ['    machine:', '      image: ubuntu-2204:current'];
  const blocks = [block('version', 'Config version', 'version: 2.1', false)];
  const exportEnv = p.pipelineEnv.map(([k, v]) => `export ${k}=${JSON.stringify(v)}`);
  const jobs = ['jobs:'];
  const names = [];
  const add = (id, title, lines) => {
    names.push(id);
    blocks.push(block(`job.${id}`, `Job: ${title}`, lines, names.length > 1));
  };
  blocks.push(block('jobs', 'Jobs', jobs));

  if (p.testJob) {
    const tp = shellPlan(p, ciSteps, vars, { alpine: false });
    const env = Object.fromEntries(p.services.map((n) => serviceUrl(n, 'localhost')));
    add('test', 'test', [
      '  test:',
      p.versions.length > 0 && ['    parameters:', '      version:', '        type: string'],
      '    docker:',
      `      - image: ${tp.testImage}`,
      p.services.map((n) => [`      - image: ${DBS[n].image}`, Object.keys(serviceEnv(n)).length > 0 && ['        environment:', mapLines(serviceEnv(n), '          ')]]),
      Object.keys(env).length > 0 && ['    environment:', mapLines(env, '      ')],
      '    steps:',
      '      - checkout',
      tp.testCommands.length > 0 ? tp.testCommands.map((c, i) => run(c.slice(0, 50), [...exportEnv, c])) : run('No test steps selected', 'echo "No test steps selected"'),
    ]);
  }
  if (p.lintDockerfile) {
    add('lint-dockerfile', 'lint-dockerfile', ['  lint-dockerfile:', '    docker:', '      - image: hadolint/hadolint:latest-debian', '    steps:', '      - checkout', run('Hadolint', plan.lintDockerfile)]);
  }
  if (plan.registry) {
    add('image', 'image', [
      '  image:',
      machine,
      '    steps:',
      '      - checkout',
      run('Build, scan and push the image', [...exportEnv, ...plan.prelude, ...plan.login, ...plan.build, p.scan && plan.scan, plan.push].filter(Boolean)),
    ]);
  }
  if (plan.deploy) {
    add('deploy', 'deploy', ['  deploy:', machine, '    steps:', '      - checkout', run('Deploy', [...exportEnv, ...plan.prelude, ...dockerRunDeploy(plan.deploy)])]);
  }

  // workflows: which job runs on what
  const branchFilter = (only, ignore) => [only.length > 0 && `only: ${JSON.stringify(only)}`, ignore.length > 0 && `ignore: ${JSON.stringify(ignore)}`].filter(Boolean);
  const tagFilter = [t.tags.length > 0 && `only: ${JSON.stringify(t.tags.map((g) => `/^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*?/g, '.*')}$/`))}`, t.tagsIgnore.length > 0 && `ignore: ${JSON.stringify(t.tagsIgnore.map((g) => `/^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*?/g, '.*')}$/`))}`].filter(Boolean);
  const wf = (jobName, { requires = [], deploy = false, matrix = false, approval = false } = {}) => {
    const out = [`      - ${jobName}:`];
    if (matrix && p.versions.length) out.push('          matrix:', '            parameters:', `              version: ${JSON.stringify(p.versions)}`);
    if (requires.length) out.push('          requires: ' + JSON.stringify(requires));
    const kind = deploy && p.deployOn === 'tag' ? 'tag' : deploy && p.deployOn === 'branch' ? 'branch' : 'all';
    const branches = branchFilter(t.branches, t.branchesIgnore);
    const filters = [];
    if (kind === 'branch') filters.push('            branches:', `              only: ${JSON.stringify([defaultBranch(p)])}`);
    else if (kind === 'tag') filters.push('            branches:', '              ignore: /.*/');
    else if (branches.length) filters.push('            branches:', ...branches.map((l) => `              ${l}`));
    if (kind === 'branch' || (kind === 'all' && !tagFilter.length)) filters.push('            tags:', '              ignore: /.*/');
    else if (tagFilter.length) filters.push('            tags:', ...tagFilter.map((l) => `              ${l}`));
    if (filters.length) out.push('          filters:', ...filters);
    return out;
  };
  const wfJobs = [];
  if (p.testJob) wfJobs.push(wf('test', { matrix: true }));
  if (p.lintDockerfile) wfJobs.push(wf('lint-dockerfile'));
  const gates = [p.testJob && 'test', p.lintDockerfile && 'lint-dockerfile'].filter(Boolean);
  if (plan.registry) wfJobs.push(wf('image', { requires: gates }));
  if (plan.deploy) {
    const after = plan.registry ? ['image'] : gates;
    if (p.deployOn === 'manual') {
      wfJobs.push(['      - hold-deploy:', '          type: approval', after.length > 0 && `          requires: ${JSON.stringify(after)}`].filter(Boolean));
      wfJobs.push(wf('deploy', { requires: ['hold-deploy'] }));
    } else wfJobs.push(wf('deploy', { requires: after, deploy: true }));
  }
  const workflows = ['workflows:', '  ci:', '    jobs:', ...wfJobs.flat()];
  if (t.schedule.length) {
    workflows.push('  scheduled:', '    triggers:', ...t.schedule.flatMap((cron) => [`      - schedule:`, `          cron: ${q(cron)}`, '          filters:', '            branches:', `              only: ${JSON.stringify([defaultBranch(p)])}`]), '    jobs:', ...wfJobs.flat());
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
  notes: ({ triggers }) => [
    'CircleCI runs on every push to a branch, including pull-request branches; it has no separate pull-request trigger, so use branch filters to narrow it.',
    'CircleCI starts a workflow only for tags that a job explicitly allows: the tag filter above applies to every job.',
    triggers.schedule.length && 'Scheduled workflows run the same jobs on the default branch.',
  ].filter(Boolean),
  render,
};
