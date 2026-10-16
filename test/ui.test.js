import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getMeta } from '../src/api.js';
import { FIELDS, describeError, initialForm, restoreForm, toBody, visibility } from '../lib/form.js';
import { downloadName } from '../lib/client.js';

const meta = getMeta();
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every flag in the error table is a real CLI flag', () => {
  const cli = read('bin/dockcrate.js');
  for (const { flags = [] } of FIELDS) for (const flag of flags) assert.match(cli, new RegExp(`${flag}\\b`), `${flag} is not in bin/dockcrate.js`);
});

test('every field key the sidebar uses has a label in the error table', () => {
  const keys = new Set(FIELDS.map((f) => f.key));
  const used = [...read('components/Sidebar.jsx').matchAll(/field="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 30);
  for (const key of used) assert.ok(keys.has(key), `Sidebar field "${key}" has no FIELDS entry`);
});

test('generator errors are told with the UI label and point at their control', () => {
  const form = { ...initialForm(meta), port: 'abc', services: [{ name: 'api', dir: 'api', stack: 'node', port: 'x' }] };
  const cases = [
    ['invalid --port "NaN"', 'port', /^Port: "abc" is not valid/],
    ['invalid port "NaN" for service api', 'service:api:port', /^Port of api: "x" is not valid/],
    ['--db mysql and mariadb both listen on port 3306; pick one', 'db', /^Services in compose: mysql and mariadb/],
    ['invalid healthcheck path "x": use /health', 'healthcheck', /^Healthcheck path: "x" is not valid; use \/health\.$/],
    ['invalid timeout "0": minutes, 1-1440', 'timeout', /^Job timeout:/],
    ['invalid branches "a b"', 'branches', /^Branches:/],
    ['service api: invalid runtime "x y"', 'service:api:runtime', /^Runtime of api:/],
    ['environment qa: match "x y" must be a name or a prefix ending in *', 'deploy:qa:match', /^Environment qa:/],
    ['invalid network name "Bad": lowercase letters', 'network:Bad', /^Network name:/],
    ['--port applies to one service: with several services set it per service', 'port', /^“Port” applies to one service/],
    ['enable at least one pipeline trigger', '', /^Enable at least one pipeline trigger\.$/],
  ];
  for (const [message, key, text] of cases) {
    const got = describeError(message, form);
    assert.equal(got.key, key, message);
    assert.match(got.text, text, message);
    assert.doesNotMatch(got.text, /--[a-z]/, `${message}: a CLI flag leaked into "${got.text}"`);
  }
  assert.deepEqual(describeError('', form), { key: '', label: '', text: '' });
});

test('a saved form is checked before use and never crashes the UI', () => {
  const base = initialForm(meta);
  for (const junk of [null, 'x', 42, [], { stack: 'cobol', include: ['zzz'], services: 'no', networks: [1, { name: 3 }], edits: { a: 3, b: { add: 'x' } } }]) {
    const form = restoreForm(junk, meta);
    assert.equal(form.stack, base.stack);
    assert.deepEqual(form.include, base.include);
    assert.ok(Array.isArray(form.networks));
    assert.ok(form.services === null || Array.isArray(form.services));
    for (const e of Object.values(form.edits)) assert.ok(Array.isArray(e.add));
    assert.doesNotThrow(() => toBody(form, visibility(form, meta, null)));
  }
  const kept = restoreForm({ stack: 'django', port: '8000', services: [{ name: 'api', dir: 'api', stack: 'fastapi' }], networks: [{ name: 'back', internal: true }], unknown: 1 }, meta);
  assert.equal(kept.stack, 'django');
  assert.equal(kept.port, '8000');
  assert.equal(kept.services[0].name, 'api');
  assert.equal(typeof kept.services[0].uid, 'string');
  assert.equal(kept.networks[0].internal, true);
  assert.ok(!('unknown' in kept));
});

test('the client-only uid never reaches the API, and per-service runtime and tool do', () => {
  const form = {
    ...initialForm(meta),
    services: [
      { uid: 'u1', name: 'api', dir: 'api', stack: 'node', runtime: '22', tool: 'pnpm' },
      { uid: 'u2', name: 'web', dir: 'web', stack: 'vue' },
    ],
    networks: [{ uid: 'u3', name: 'back', internal: false, external: false }],
    deployTo: [{ uid: 'u4', name: 'qa', on: 'branch', match: 'develop' }, { uid: 'u5', name: 'prod', on: 'tag' }],
    deploy: 'ssh',
  };
  const body = toBody(form, visibility(form, meta, null));
  assert.doesNotMatch(JSON.stringify(body), /"uid"/);
  assert.deepEqual(body.services[0], { name: 'api', dir: 'api', stack: 'node', runtime: '22', tool: 'pnpm' });
});

test('single-file downloads get unique names', () => {
  const paths = ['Dockerfile', 'api/Dockerfile', 'web/Dockerfile', '.dockerignore', '.github/workflows/ci.yml', 'k8s/api/deployment.yaml'];
  const names = paths.map(downloadName);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, ['Dockerfile', 'api_Dockerfile', 'web_Dockerfile', '.dockerignore', 'github_workflows_ci.yml', 'k8s_api_deployment.yaml']);
});

test('a single service can be named, whatever its stack', () => {
  for (const stack of meta.stacks) {
    const form = { ...initialForm(meta), stack: stack.id, name: 'my-shop' };
    const show = visibility(form, meta);
    // Exactly one name field: the stack's own (with its hint) or the general one.
    assert.equal(Boolean(show.name) + Boolean(show.projectName), 1, stack.id);
    assert.equal(toBody(form, show).name, 'my-shop', stack.id);
  }
});
