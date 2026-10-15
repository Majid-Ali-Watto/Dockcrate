import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { execFileSync } from 'node:child_process';
import { switchOn } from '../src/providers/common.js';
import { lines } from '../src/fsutil.js';
import { getMeta, handleGenerate } from '../src/api.js';

const gen = (opts) => generate(null, { stack: 'node', pinActions: false, ...opts });
const ci = (opts, path = '.github/workflows/ci.yml') => gen(opts).files.find((f) => f.path === path)?.content;
const on = (opts) => ci(opts).match(/^on:\n([\s\S]*?)\n\npermissions:/m)[1];

test('lines() names the function that was passed instead of a bare "undefined"', () => {
  assert.throws(() => lines('a', function ignore() {}), /got a function \(ignore\); call it or pass its result/);
  assert.throws(() => lines('a', () => 'x'), /got a function/);
  assert.throws(() => lines('a', 0), /unexpected number part 0/);
  assert.equal(lines('a', [false, null, ['b']]), 'a\nb\n');
});

test('every stack builds with every option that used to hand a function to lines()', () => {
  for (const stack of ['node', 'react', 'vue', 'angular', 'fastapi', 'django', 'dotnet', 'java', 'go', 'rust', 'php', 'ruby']) {
    for (const imageVariant of ['', 'alpine', 'slim']) {
      for (const opts of [{}, { multistage: false }, { multistage: false, stageMode: 'mixed' }]) {
        assert.doesNotThrow(() => generate(null, { stack, imageVariant, ...opts, envs: ['dev', 'prod'], extras: ['makefile', 'dependabot'], deploy: 'kubernetes', healthcheck: '/h', packages: ['curl'] }), `${stack} ${imageVariant} ${JSON.stringify(opts)}`);
      }
    }
  }
});

test('a push, a tag, a pull request, a manual run, a release and a schedule are each their own choice', () => {
  const all = on({ branches: ['main'], tags: ['v*'], pullRequests: true, manual: true, release: true, schedule: ['0 3 * * *'] });
  for (const event of ['push:', 'pull_request:', 'workflow_dispatch:', 'release:', 'schedule:']) assert.ok(all.includes(event), event);
  assert.match(all, /branches: \["main"\]\n {4}tags: \["v\*"\]/);
  // push for one, pull requests for the other
  assert.match(on({ branches: ['main'], tags: [], pullRequests: false }), /^ {2}push:\n {4}branches: \["main"\]$/);
  assert.doesNotMatch(on({ branches: ['main'], tags: [], pullRequests: false }), /pull_request|tags/);
  assert.equal(on({ branches: [], tags: [], pullRequests: true }), '  pull_request:');
  // no tag event: the pipeline still runs for branches, and the tag trigger is simply absent
  const noTags = on({ branches: ['main'], tags: [], pullRequests: true });
  assert.doesNotMatch(noTags, /tags/);
  assert.match(noTags, /push:\n {4}branches/);
  // a manual-only pipeline needs no push at all
  assert.equal(on({ branches: [], tags: [], pullRequests: false, manual: true, ciSteps: [] }), '  workflow_dispatch:');
  assert.throws(() => gen({ branches: [], tags: [], pullRequests: false }), /enable at least one pipeline trigger/);
});

const manualOf = (opts) => on({ branches: [], tags: [], pullRequests: false, manual: true, ...opts });

test('a manual run asks which CI steps to run, one checkbox each (GitHub)', () => {
  assert.equal(
    manualOf({ ciSteps: ['lint', 'test'] }),
    [
      '  workflow_dispatch:',
      '    inputs:',
      '      lint:',
      '        description: "Run lint"',
      '        required: false',
      '        type: boolean',
      '        default: true',
      '      test:',
      '        description: "Run tests"',
      '        required: false',
      '        type: boolean',
      '        default: true',
    ].join('\n'),
  );
  const workflow = ci({ manual: true, ciSteps: ['lint', 'test', 'build'] });
  assert.match(workflow, /- if: "github.event_name != 'workflow_dispatch' \|\| inputs.lint"\n {8}run: npm run lint/);
  assert.match(workflow, /- if: "github.event_name != 'workflow_dispatch' \|\| inputs.build"\n {8}run: npm run build/);
  assert.doesNotMatch(workflow, /inputs.audit/, 'only the steps the pipeline has');
  assert.doesNotMatch(workflow, /- if: .*\n {8}run: npm ci/, 'the setup always runs');
  // every other event runs everything: no manual run, no checkbox, no condition
  assert.doesNotMatch(ci({ manual: false, ciSteps: ['lint', 'test'] }), /inputs\.|workflow_dispatch/);
  // no test job, nothing to tick
  assert.equal(manualOf({ testJob: false }), '  workflow_dispatch:');
  // a step that belongs to several (the .NET build serves build and test) runs while any of them is ticked
  assert.match(ci({ stack: 'dotnet', manual: true, ciSteps: ['build', 'test'] }), /- if: "github.event_name != 'workflow_dispatch' \|\| inputs.build \|\| inputs.test"\n {8}run: dotnet build/);
});

test('the checkboxes of a manual run are written for every provider in its own syntax', () => {
  const base = { manual: true, ciSteps: ['lint', 'test'] };
  const gitlab = ci({ ...base, ci: 'gitlab' }, '.gitlab-ci.yml');
  assert.match(gitlab, /^variables:\n(?: {2}\w+: .*\n)* {2}RUN_LINT:\n {4}description: "Run lint"\n {4}value: "true"\n {4}options: \["true","false"\]\n {2}RUN_TEST:/m);
  assert.match(gitlab, /^ {4}- if \[ "\$\{RUN_LINT:-true\}" = true \]; then npm run lint; fi$/m);
  const jenkins = ci({ ...base, ci: 'jenkins' }, 'Jenkinsfile');
  assert.match(jenkins, /parameters \{\n {4}booleanParam\(name: 'RUN_LINT', defaultValue: true, description: 'Run lint'\)\n {4}booleanParam\(name: 'RUN_TEST', defaultValue: true, description: 'Run tests'\)\n {2}\}/);
  assert.match(jenkins, /sh 'if \[ "\$\{RUN_TEST:-true\}" = true \]; then npm test; fi'/);
  const bitbucket = ci({ ...base, ci: 'bitbucket' }, 'bitbucket-pipelines.yml');
  assert.match(bitbucket, /custom:\n {4}manual:\n {6}- variables:\n {12}- name: RUN_LINT\n {14}default: "true"\n {14}allowed-values: \["true","false"\]\n {12}- name: RUN_TEST\n/);
  assert.match(bitbucket, /- if \[ "\$\{RUN_LINT:-true\}" = true \]; then npm run lint; fi/);
  const azure = ci({ ...base, ci: 'azure' }, 'azure-pipelines.yml');
  assert.match(azure, /^parameters:\n {2}- name: lint\n {4}displayName: "Run lint"\n {4}type: boolean\n {4}default: true\n {2}- name: test/m);
  assert.match(azure, /- bash: if \[ "\$\{\{ lower\(parameters\.lint\) \}\}" = true \]; then npm run lint; fi\n {8}displayName: "npm run lint"/);
  // CircleCI has no manual trigger here, and without one there is nothing to ask
  assert.doesNotMatch(ci({ ...base, ci: 'circleci' }, '.circleci/config.yml'), /parameters:|RUN_LINT/);
  // the gitea workflow is the GitHub one
  assert.match(ci({ ...base, ci: 'gitea' }, '.gitea/workflows/ci.yml'), /workflow_dispatch:\n {4}inputs:\n {6}lint:/);
  // not a manual run: no checkboxes and the commands are left as they are
  const plain = ci({ ci: 'gitlab', manual: false, ciSteps: ['lint'] }, '.gitlab-ci.yml');
  assert.match(plain, /^ {4}- npm run lint$/m);
  assert.doesNotMatch(plain, /RUN_LINT/);
});

test('the shell test of a checkbox skips the step only when it was unticked', () => {
  const runs = (env) => execFileSync('sh', ['-c', `${switchOn('lint')} && echo ran || echo skipped`], { env, encoding: 'utf8' }).trim();
  assert.equal(runs({}), 'ran', 'a run that was never asked (a push) runs it');
  assert.equal(runs({ RUN_LINT: 'true' }), 'ran');
  assert.equal(runs({ RUN_LINT: 'false' }), 'skipped');
  // and the wrapper around a command keeps the exit status of the command
  const line = ci({ ci: 'gitlab', manual: true, ciSteps: ['lint'] }, '.gitlab-ci.yml').match(/^ {4}- (if \[ "\$\{RUN_LINT.*; fi)$/m)[1];
  const run = (command, env) => {
    try {
      return execFileSync('sh', ['-c', line.replace(/then .*; fi$/, `then ${command}; fi`)], { env, encoding: 'utf8' }).trim();
    } catch (e) {
      return `failed ${e.status}`;
    }
  };
  assert.equal(run('echo ran', { RUN_LINT: 'true' }), 'ran');
  assert.equal(run('echo ran', { RUN_LINT: 'false' }), '');
  assert.equal(run('exit 3', {}), 'failed 3');
  assert.equal(run('exit 3', { RUN_LINT: 'false' }), '');
});

test('a manual run that deploys to one of several environments asks for it next to the steps', () => {
  const deployTo = [{ name: 'hotfix', on: 'manual' }, { name: 'canary', on: 'manual' }];
  const text = on({ deploy: 'ssh', deployTo, manual: true, ciSteps: ['lint'] });
  assert.match(text, /inputs:\n {6}environment:[\s\S]*options: \["hotfix","canary"\]\n {6}lint:/);
  assert.doesNotMatch(on({ deploy: 'ssh', deployTo, manual: true, ciSteps: [] }), /lint:/);
  assert.match(on({ deploy: 'ssh', deployTo, manual: true, ciSteps: [] }), /inputs:\n {6}environment:/);
});

test('services: a manual run offers the steps any of them has', () => {
  const services = [{ name: 'api', stack: 'node', dir: 'api', ciSteps: ['lint'] }, { name: 'web', stack: 'node', dir: 'web', ciSteps: ['test'] }];
  const text = generate(null, { services, manual: true, pinActions: false }).files.find((f) => f.kind === 'ci').content;
  assert.match(text, /inputs:\n {6}lint:[\s\S]*\n {6}test:/);
  assert.doesNotMatch(text, /inputs\.build|inputs\.audit/);
});

test('the compose restart policy and the Kubernetes replicas are asked for, not fixed', () => {
  const compose = (opts) => gen({ db: ['postgres'], ...opts }).files.find((f) => f.path === 'docker-compose.yml').content;
  assert.equal(compose({}).match(/restart: unless-stopped/g).length, 2);
  assert.equal(compose({ restart: 'always' }).match(/restart: always/g).length, 2, 'the app and its database');
  assert.match(compose({ restart: 'no' }), /restart: "no"/);
  assert.throws(() => gen({ restart: 'sometimes' }), /invalid restart policy/);
  const k8s = (opts) => gen({ deploy: 'kubernetes', ...opts }).files.find((f) => f.path === 'k8s/deployment.yaml').content;
  assert.match(k8s({}), /replicas: 2/);
  assert.match(k8s({ replicas: 5 }), /replicas: 5/);
  assert.throws(() => gen({ deploy: 'kubernetes', replicas: 0 }), /invalid replicas/);
  assert.throws(() => gen({ deploy: 'kubernetes', replicas: 'many' }), /invalid replicas/);
});

test('the API takes the events, the restart policy and the replicas', () => {
  const data = handleGenerate({
    stack: 'node',
    ci: 'github',
    branches: [],
    tags: [],
    pullRequests: false,
    manual: true,
    ciSteps: ['lint', 'build'],
    restart: 'always',
    deploy: 'kubernetes',
    replicas: '3',
    pinActions: false,
  });
  const workflow = data.files.find((f) => f.path === '.github/workflows/ci.yml').content;
  assert.match(workflow, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}lint:[\s\S]*\n {6}build:/m);
  assert.doesNotMatch(workflow.match(/^on:\n([\s\S]*?)\n\npermissions:/m)[1], /pull_request|push:|tags:/);
  assert.match(data.files.find((f) => f.path === 'docker-compose.yml').content, /restart: always/);
  assert.match(data.files.find((f) => f.path === 'k8s/deployment.yaml').content, /replicas: 3/);
  assert.deepEqual(getMeta().restartPolicies, ['unless-stopped', 'always', 'on-failure', 'no']);
});
