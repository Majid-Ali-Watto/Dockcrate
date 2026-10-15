import { block, defaultBranch, dockerRunDeploy, healthCmd, serviceEnv, serviceUrl, shellPlan } from './common.js';
import { DBS } from '../compose.js';

const REF = ['REF_SLUG=$(printf "%s" "${BRANCH_NAME:-$TAG_NAME}" | tr -c "A-Za-z0-9_.\\n-" "-")'];

// Groovy single-quoted strings do no interpolation, so shell variables reach the shell untouched; only \ and ' are escaped.
const g = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const sh = (cmd, pad) => `${pad}sh '${g(cmd)}'`;
const shBlock = (lines, pad) => [`${pad}sh '''`, ...lines.map((l) => l.replace(/\\/g, '\\\\')), `${pad}'''`];
const envBlock = (entries, pad) => entries.length > 0 && [`${pad}environment {`, ...entries.map(([k, v]) => `${pad}  ${k} = ${v}`), `${pad}}`];
const credentials = (names) => names.map((n) => [n, `credentials('${n}')`]);

function render(p, ciSteps) {
  const { triggers: t } = p;
  const vars = { sha: 'GIT_COMMIT', refSlug: 'REF_SLUG', tag: 'TAG_NAME', version: '$VERSION', pre: REF, defaultBranchTest: `[ "$BRANCH_NAME" = "${defaultBranch(p)}" ]` };
  const plan = shellPlan(p, ciSteps, vars);
  const label = p.runner ? `label '${g(p.runner)}'` : null;
  const agent = (inner) => (label || inner ? ['agent {', inner ? `  ${inner}` : `  ${label}`, '}'] : ['agent any']);
  const blocks = [];

  const options = [
    p.timeout > 0 && `timeout(time: ${p.timeout}, unit: 'MINUTES')`,
    p.concurrency === 'queue' && 'disableConcurrentBuilds()',
    (p.concurrency === 'prs' || p.concurrency === 'always') && 'disableConcurrentBuilds(abortPrevious: true)',
  ].filter(Boolean);
  blocks.push(block('open', 'Pipeline', ['// ' + p.workflowName, 'pipeline {', '  agent none'], false));
  if (options.length) blocks.push(block('options', 'Options', ['  options {', options.map((o) => `    ${o}`), '  }'], false));
  if (t.schedule.length) blocks.push(block('triggers', 'Triggers: schedule', ['  triggers {', t.schedule.map((c) => `    cron('${g(c)}')`), '  }'], false));
  if (p.pipelineEnv.length) blocks.push(block('environment', 'Environment variables', envBlock(p.pipelineEnv.map(([k, v]) => [k, `'${g(v)}'`]), '  '), false));
  blocks.push(block('stages', 'Stages', '  stages {', false));

  const stage = (id, title, body) => blocks.push(block(`stage.${id}`, `Stage: ${title}`, body, blocks[blocks.length - 1].id !== 'stages'));
  const names = [];

  if (p.testJob) {
    const versions = p.versions.length ? p.versions : [null];
    versions.forEach((v) => {
      const tp = shellPlan({ ...p, versions: [] }, () => ciSteps(v ?? undefined), vars);
      const env = Object.fromEntries(p.services.map((n) => serviceUrl(n, 'localhost')));
      const cname = (n) => `shipkit-$BUILD_TAG-${n}`;
      const start = p.services.flatMap((n) => {
        const db = DBS[n];
        const envs = Object.entries(serviceEnv(n)).map(([k, val]) => `-e "${k}=${val}"`).join(' ');
        return [
          `docker run -d --name "${cname(n)}" --network host ${envs} --health-cmd "${healthCmd(n)}" --health-interval 5s --health-timeout 5s --health-retries 10 ${db.image}`,
          `for i in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' "${cname(n)}")" = healthy ] && break; sleep 2; done`,
        ];
      });
      const stop = p.services.map((n) => `"${cname(n)}"`).join(' ');
      const title = v ? `Test ${v}` : 'Test';
      const id = v ? `test-${v.replace(/\W/g, '')}` : 'test';
      names.push(id);
      stage(id, title.toLowerCase(), [
        `    stage('${title}') {`,
        agent().map((l) => `      ${l}`),
        envBlock(Object.entries(env).map(([k, val]) => [k, `'${g(val)}'`]), '      '),
        '      steps {',
        '        script {',
        p.services.length > 0 && shBlock(start, '          '),
        `          docker.image('${g(tp.testImage)}').inside('--network host') {`,
        tp.testCommands.length > 0 ? tp.testCommands.map((c) => sh(c, '            ')) : "            echo 'No test steps selected'",
        '          }',
        '        }',
        '      }',
        p.services.length > 0 && ['      post {', '        always {', `          sh 'docker rm -f ${stop} || true'`, '        }', '      }'],
        '    }',
      ]);
    });
  }
  if (p.lintDockerfile) {
    names.push('lint');
    stage('lint', 'lint dockerfile', [
      "    stage('Lint Dockerfile') {",
      agent(`docker { image 'hadolint/hadolint:latest-debian'${label ? `; ${label}` : ''}; args '--entrypoint=' }`).map((l) => `      ${l}`),
      '      steps {',
      sh(plan.lintDockerfile, '        '),
      '      }',
      '    }',
    ]);
  }
  if (plan.registry) {
    names.push('image');
    stage('image', 'image', [
      "    stage('Image') {",
      '      when { beforeAgent true; not { changeRequest() } }',
      agent(`docker { image 'docker:27-cli'; ${label ? `${label}; ` : ''}args '-v /var/run/docker.sock:/var/run/docker.sock --user root' }`).map((l) => `      ${l}`),
      envBlock(credentials(p.registryNeeds.secrets), '      '),
      '      steps {',
      shBlock([...plan.prelude, ...plan.login, ...plan.build, p.scan && plan.scan, plan.push].filter(Boolean), '        '),
      '      }',
      '    }',
    ]);
  }
  if (plan.deploy) {
    const when = {
      branch: `branch '${g(defaultBranch(p))}'`,
      tag: 'buildingTag()',
      manual: `branch '${g(defaultBranch(p))}'`,
    }[p.deployOn];
    stage('deploy', 'deploy', [
      "    stage('Deploy') {",
      `      when { beforeAgent true; ${when} }`,
      p.deployOn === 'manual' && ["      input { message 'Deploy to " + g(p.environment) + "?' }"],
      agent().map((l) => `      ${l}`),
      envBlock(credentials([...p.targetNeeds.secrets, ...p.registryNeeds.secrets]), '      '),
      '      steps {',
      shBlock([...plan.prelude, ...dockerRunDeploy(plan.deploy)], '        '),
      '      }',
      '    }',
    ]);
  }
  blocks.push(block('close', 'End of pipeline', ['  }', '}'], false));
  return blocks;
}

export const jenkins = {
  label: 'Jenkins',
  path: 'Jenkinsfile',
  builtinRegistry: false,
  secretsLocation: 'Jenkins (Manage Jenkins > Credentials: one "Secret text" credential per secret, with the same id; plain variables as global environment variables)',
  features: ['manual', 'schedule', 'services', 'timeout', 'runner'],
  notes: () => [
    'Jenkins decides which branches, tags and pull requests get built in the multibranch job (Branch Sources > Behaviours) and its webhook, not in the Jenkinsfile; the Jenkinsfile only filters stages (images are not pushed for pull requests, deploys follow the deploy rule).',
    'Needs the Docker Pipeline plugin, and agents with Docker access (the image and deploy stages mount /var/run/docker.sock). Test service containers use host networking, so two builds of the same project must not share an agent at the same time.',
  ],
  render,
};
