import { block, changedGuard, changedLines, cmd, deployPlan, isMulti, jobId, manualLabel, mapLines, matchRegex, q, scalar, serviceEnv, serviceUrl, shellPlan, switchOn, switchVar, when } from './common.js';
import { DBS } from '../compose.js';
import { VERSIONS } from '../tools.js';

const globToRegex = (glob) => glob.replace(/[.+^${}()|[\]\\/]/g, '\\$&').replace(/\*\*?/g, '.*');
const anyOf = (globs) => `/^(${globs.map(globToRegex).join('|')})$/`;

const VARS = { stepOn: switchOn, sha: 'CI_COMMIT_SHA', refSlug: 'CI_COMMIT_REF_SLUG', tag: 'CI_COMMIT_TAG', version: '$VERSION', defaultBranchTest: '[ "$CI_COMMIT_REF_NAME" = "$CI_DEFAULT_BRANCH" ]' };

function render(p) {
  const { triggers: t, target } = p;
  const multi = isMulti(p);
  const plans = p.apps.map((app) => ({ app, plan: shellPlan(p, app, VARS) }));
  const registry = plans[0].plan.registry;
  const deploys = Boolean(target.script);
  const cancels = p.concurrency === 'prs' || p.concurrency === 'always';
  const timeout = p.timeout ? `  timeout: ${p.timeout}m` : null;
  const interruptible = cancels && '  interruptible: true';
  const regex = (variable, match) => (match.endsWith('*') ? `- if: ${variable} =~ /${matchRegex(match)}/` : `- if: ${variable} == ${q(match)}`);
  const deployRules = (d) =>
    ({
      branch: [d.match ? regex('$CI_COMMIT_BRANCH', d.match) : '- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'],
      tag: [d.match ? regex('$CI_COMMIT_TAG', d.match) : '- if: $CI_COMMIT_TAG'],
      manual: ['- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH', '  when: manual'],
    })[d.on];

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
  const variables = { ...(registry && !multi && { IMAGE_REPO: plans[0].plan.repo }), ...Object.fromEntries(p.pipelineEnv) };
  // The checkboxes of a manual run are variables with a description and options, which GitLab pre-fills on the Run pipeline page.
  const inputVars = p.manualSteps.flatMap((step) => [`  ${switchVar(step)}:`, `    description: ${q(manualLabel(step))}`, '    value: "true"', '    options: ["true","false"]']);
  if (Object.keys(variables).length || inputVars.length) blocks.push(block('variables', 'Variables', ['variables:', Object.keys(variables).length > 0 && mapLines(variables, '  '), inputVars]));

  const changed = p.changedOnly;
  if (changed) {
    // A job of its own on a small image: later jobs read CHANGED from its dotenv artifact, so none of them needs git.
    blocks.push(
      block('changes', 'Job: changes', [
        'changes:',
        '  stage: .pre',
        `  image: ${VERSIONS.alpine}`,
        '  variables:',
        '    GIT_DEPTH: "0"',
        '  script:',
        '    - apk add --no-cache git',
        '    - |',
        changedLines(p, {
          ciPath: gitlab.path,
          setup: [
            'if [ -n "$CI_COMMIT_TAG" ] || [ "$CI_PIPELINE_SOURCE" = schedule ] || [ "$CI_PIPELINE_SOURCE" = web ]; then ALL=1; fi',
            'BASE="${CI_MERGE_REQUEST_DIFF_BASE_SHA:-$CI_COMMIT_BEFORE_SHA}"',
          ],
        }).map((l) => `      ${l}`),
        '      echo "CHANGED=$CHANGED" > changed.env',
        '  artifacts:',
        '    reports:',
        '      dotenv: changed.env',
      ]),
    );
  }
  const testJobs = [];
  if (p.testJob) {
    for (const { app, plan } of plans) {
      const id = jobId(p, app, 'test');
      const commands = plan.testCommands;
      testJobs.push(id);
      blocks.push(
        block(id, `Job: ${id}`, [
          `${id}:`,
          '  stage: test',
          `  image: ${plan.testImage}`,
          interruptible,
          timeout,
          when(app.versions.length, '  parallel:', '    matrix:', `      - VERSION: ${JSON.stringify(app.versions)}`),
          when(
            p.services.length,
            '  services:',
            p.services.map((n) => [`    - name: ${DBS[n].image}`, `      alias: ${n}`]),
            '  variables:',
            p.services.map((n) => {
              const [key, url] = serviceUrl(n, n, p.services);
              return mapLines({ ...serviceEnv(n), [key]: url }, '    ');
            }),
          ),
          '  script:',
          changed && `    - ${cmd(changedGuard(app))}`,
          // GitLab rejects a job without commands, so a test job with no steps selected still prints something.
          commands.length ? commands.map((c) => `    - ${cmd(c)}`) : '    - echo "No test steps selected"',
        ]),
      );
    }
  }
  if (p.lintDockerfile) {
    blocks.push(
      block('lint-dockerfile', 'Job: lint-dockerfile', [
        'lint-dockerfile:',
        '  stage: test',
        `  image: ${VERSIONS.hadolint}`,
        interruptible,
        timeout,
        '  script:',
        plans.map(({ plan }) => `    - ${plan.lintDockerfile}`),
      ]),
    );
  }
  const buildJobs = [];
  if (hasBuild) {
    for (const { app, plan } of plans) {
      const id = jobId(p, app, 'build-image');
      buildJobs.push(id);
      blocks.push(
        block(id, `Job: ${id}`, [
          `${id}:`,
          '  stage: build',
          '  image: docker:27',
          '  services:',
          '    - docker:27-dind',
          '  variables:',
          '    DOCKER_TLS_CERTDIR: "/certs"',
          multi && `    IMAGE_REPO: ${q(plan.repo)}`,
          interruptible,
          timeout,
          '  before_script:',
          changed && `    - ${cmd(changedGuard(app))}`,
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
  }
  if (deploys) {
    for (const dep of p.deployments) {
      const d = deployPlan(p, dep, VARS);
      const image = d.image;
      blocks.push(
        block(dep.id, `Job: ${dep.id}`, [
          `${dep.id}:`,
          '  stage: deploy',
          typeof image === 'string' ? `  image: ${image}` : ['  image:', `    name: ${image.name}`, `    entrypoint: ${JSON.stringify(image.entrypoint)}`],
          `  needs: [${[changed && 'changes', ...(registry ? buildJobs : [...testJobs, p.lintDockerfile && 'lint-dockerfile'])].filter(Boolean).join(', ')}]`,
          `  environment: ${dep.name}`,
          `  resource_group: ${dep.name}`,
          timeout,
          '  variables:',
          Object.entries(d.env).map(([k, v]) => `    ${k}: ${q(v)}`),
          when(d.setup.length, '  before_script:', d.setup.map((l) => `    - ${cmd(l)}`)),
          '  script:',
          '    - |',
          d.script.map((l) => `      ${l}`),
          '  rules:',
          deployRules(dep).map((l) => `    ${l}`),
        ]),
      );
    }
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
  deploySecretsNote: ({ secrets, environments }) =>
    `Mark ${secrets} Protected and Masked and set their environment scope to ${environments}: only pipelines on protected branches and tags, in the deploy job of that environment, get them. Protect the branches and tags that deploy (Settings > Repository) and the environments themselves (Settings > CI/CD > Protected environments) to require an approval.`,
  notes: ({ triggers }) => (triggers.schedule.length ? [`GitLab schedules live in the UI: add a pipeline schedule with cron "${triggers.schedule[0]}" under CI/CD > Schedules.`] : []),
  render,
};
