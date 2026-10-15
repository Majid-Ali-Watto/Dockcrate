import { block, cmd, mapLines, q, scalar, serviceEnv, serviceUrl, shellPlan, when } from './common.js';
import { DBS } from '../compose.js';

const globToRegex = (glob) => glob.replace(/[.+^${}()|[\]\\/]/g, '\\$&').replace(/\*\*?/g, '.*');
const anyOf = (globs) => `/^(${globs.map(globToRegex).join('|')})$/`;

const VARS = { sha: 'CI_COMMIT_SHA', refSlug: 'CI_COMMIT_REF_SLUG', tag: 'CI_COMMIT_TAG', version: '$VERSION', defaultBranchTest: '[ "$CI_COMMIT_REF_NAME" = "$CI_DEFAULT_BRANCH" ]' };

function render(p, ciSteps) {
  const { triggers: t, target } = p;
  const plan = shellPlan(p, ciSteps, VARS);
  const registry = plan.registry;
  const deploys = Boolean(target.script);
  const cancels = p.concurrency === 'prs' || p.concurrency === 'always';
  const timeout = p.timeout ? `  timeout: ${p.timeout}m` : null;
  const interruptible = cancels && '  interruptible: true';
  const deployRules = {
    branch: ['- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'],
    tag: ['- if: $CI_COMMIT_TAG'],
    manual: ['- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH', '  when: manual'],
  }[p.deployOn];

  const blocks = [];
  if (p.codeScan) blocks.push(block('include', 'Include: GitLab SAST', ['include:', '  - template: Security/SAST.gitlab-ci.yml'], false));

  const branchRule =
    (t.branches.length || t.branchesIgnore.length) &&
    `    - if: $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH${t.branches.length ? ` =~ ${anyOf(t.branches)}` : ''}${t.branchesIgnore.length ? ` && $CI_COMMIT_BRANCH !~ ${anyOf(t.branchesIgnore)}` : ''}`;
  blocks.push(
    block('workflow', 'Workflow: name, cancelling and trigger rules', [
      'workflow:',
      `  name: ${scalar(p.workflowName)}`,
      cancels && ['  auto_cancel:', '    on_new_commit: interruptible'],
      '  rules:',
      t.pullRequests && '    - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
      branchRule,
      (t.tags.length || t.tagsIgnore.length) &&
        `    - if: $CI_COMMIT_TAG${t.tags.length ? ` =~ ${anyOf(t.tags)}` : ''}${t.tagsIgnore.length ? ` && $CI_COMMIT_TAG !~ ${anyOf(t.tagsIgnore)}` : ''}`,
      t.schedule.length > 0 && '    - if: $CI_PIPELINE_SOURCE == "schedule"',
      t.manual && '    - if: $CI_PIPELINE_SOURCE == "web"',
    ]),
  );

  const hasBuild = Boolean(registry);
  blocks.push(block('stages', 'Stages', `stages: [${[p.testJob && 'test', hasBuild && 'build', deploys && 'deploy'].filter(Boolean).join(', ')}]`));
  const variables = { ...(registry && { IMAGE_REPO: plan.repo }), ...Object.fromEntries(p.pipelineEnv) };
  if (Object.keys(variables).length) blocks.push(block('variables', 'Variables', ['variables:', mapLines(variables, '  ')]));

  if (p.testJob) {
    const commands = plan.testCommands;
    blocks.push(
      block('test', 'Job: test', [
        'test:',
        '  stage: test',
        `  image: ${plan.testImage}`,
        interruptible,
        timeout,
        when(p.versions.length, '  parallel:', '    matrix:', `      - VERSION: ${JSON.stringify(p.versions)}`),
        when(
          p.services.length,
          '  services:',
          p.services.map((n) => [`    - name: ${DBS[n].image}`, `      alias: ${n}`]),
          '  variables:',
          p.services.map((n) => {
            const [key, url] = serviceUrl(n, n);
            return mapLines({ ...serviceEnv(n), [key]: url }, '    ');
          }),
        ),
        '  script:',
        // GitLab rejects a job without commands, so a test job with no steps selected still prints something.
        commands.length ? commands.map((c) => `    - ${cmd(c)}`) : '    - echo "No test steps selected"',
      ]),
    );
  }
  if (p.lintDockerfile) {
    blocks.push(
      block('lint-dockerfile', 'Job: lint-dockerfile', [
        'lint-dockerfile:',
        '  stage: test',
        '  image: hadolint/hadolint:latest-debian',
        interruptible,
        timeout,
        '  script:',
        `    - ${plan.lintDockerfile}`,
      ]),
    );
  }
  if (hasBuild) {
    blocks.push(
      block('build-image', 'Job: build-image', [
        'build-image:',
        '  stage: build',
        '  image: docker:27',
        '  services:',
        '    - docker:27-dind',
        '  variables:',
        '    DOCKER_TLS_CERTDIR: "/certs"',
        interruptible,
        timeout,
        '  before_script:',
        plan.login.map((l) => `    - ${cmd(l)}`),
        '  script:',
        plan.build.map((l) => `    - ${cmd(l)}`),
        p.scan && `    - ${cmd(plan.scan)}`,
        `    - ${plan.push}`,
        '  rules:',
        '    - if: $CI_PIPELINE_SOURCE != "merge_request_event"',
      ]),
    );
  }
  if (deploys) {
    const d = plan.deploy;
    const image = d.image;
    blocks.push(
      block('deploy', 'Job: deploy', [
        'deploy:',
        '  stage: deploy',
        typeof image === 'string' ? `  image: ${image}` : ['  image:', `    name: ${image.name}`, `    entrypoint: ${JSON.stringify(image.entrypoint)}`],
        `  needs: [${(registry ? ['build-image'] : [p.testJob && 'test', p.lintDockerfile && 'lint-dockerfile']).filter(Boolean).join(', ')}]`,
        p.environment && `  environment: ${p.environment}`,
        `  resource_group: ${p.environment || p.appName}`,
        timeout,
        '  variables:',
        Object.entries(d.env).map(([k, v]) => `    ${k}: ${q(v)}`),
        when(d.setup.length, '  before_script:', d.setup.map((l) => `    - ${cmd(l)}`)),
        '  script:',
        '    - |',
        d.script.map((l) => `      ${l}`),
        '  rules:',
        deployRules.map((l) => `    ${l}`),
      ]),
    );
  }
  return blocks;
}

export const gitlab = {
  label: 'GitLab CI',
  path: '.gitlab-ci.yml',
  builtinRegistry: true,
  variablesName: 'GitLab CI/CD variables',
  secretsLocation: 'GitLab (Settings > CI/CD > Variables; mask the secrets)',
  features: ['manual', 'schedule', 'services', 'timeout', 'tagFilters', 'branchIgnore', 'codeScan'],
  notes: ({ triggers }) => (triggers.schedule.length ? [`GitLab schedules live in the UI: add a pipeline schedule with cron "${triggers.schedule[0]}" under CI/CD > Schedules.`] : []),
  render,
};
