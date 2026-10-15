import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/generate.js';
import { handleGenerate } from '../src/api.js';

// One project, or (with `services`) several: the stack belongs to the services then.
const run = (opts) => generate(null, { ci: 'none', ...(opts.services ? {} : { stack: 'node' }), ...opts });
const compose = (opts) => run(opts).files.find((f) => f.path === 'docker-compose.yml').content;
const notes = (opts) => run(opts).notes;
const svc = (name, stack, extra = {}) => ({ name, dir: name, stack, ...extra });

test('without networks the compose file has none: services share the default network', () => {
  assert.doesNotMatch(compose({ db: ['postgres'] }), /networks/);
  assert.doesNotMatch(compose({ db: ['postgres'], appNetworks: ['x'] }), /networks/, 'choosing without declaring changes nothing');
  assert.ok(notes({ appNetworks: ['x'] }).some((n) => n.includes('none is declared')));
});

test('declared networks are joined by every service and every database unless told otherwise', () => {
  const text = compose({ db: ['postgres', 'redis'], networks: [{ name: 'frontend' }, { name: 'backend', internal: true }] });
  assert.match(text, /restart: unless-stopped\n {4}networks:\n {6}- frontend\n {6}- backend\n {2}postgres:/);
  assert.equal(text.match(/networks:\n {6}- frontend\n {6}- backend/g).length, 3, 'the app, postgres and redis');
  assert.match(text, /\nnetworks:\n {2}frontend:\n {2}backend:\n {4}internal: true\n$/);
});

test('the service and the databases can join different networks', () => {
  const text = compose({ db: ['postgres'], networks: [{ name: 'frontend' }, { name: 'backend', internal: true }], appNetworks: ['frontend', 'backend'], dbNetworks: ['backend'] });
  assert.match(text, /^ {2}postgres:[\s\S]*restart: unless-stopped\n {4}networks:\n {6}- backend\n[\s\S]*\nnetworks:/m);
  assert.doesNotMatch(text.split('postgres:')[1].split('\nvolumes:')[0], /frontend/);
});

test('each service picks its own networks; the project-wide list is the default', () => {
  const text = compose({
    db: ['postgres'],
    networks: [{ name: 'edge' }, { name: 'backend', internal: true }],
    appNetworks: ['backend'],
    dbNetworks: ['backend'],
    services: [svc('web', 'vue', { networks: ['edge'] }), svc('api', 'django', { networks: ['edge', 'backend'] }), svc('worker', 'node')],
  });
  const block = (name) => text.match(new RegExp(`^ {2}${name}:\\n[\\s\\S]*?(?=^ {2}\\S|^networks:)`, 'm'))[0];
  assert.match(block('web'), /networks:\n {6}- edge\n$/);
  assert.match(block('api'), /networks:\n {6}- edge\n {6}- backend\n$/);
  assert.match(block('worker'), /networks:\n {6}- backend\n$/, 'the project-wide default');
});

test('external networks are not created by compose, and say so', () => {
  const text = compose({ networks: [{ name: 'shared', external: true }] });
  assert.match(text, /\nnetworks:\n {2}shared:\n {4}external: true\n$/);
  assert.ok(notes({ networks: [{ name: 'shared', external: true }] }).some((n) => n.includes('create it first (docker network create shared)')));
});

test('a service that is only on internal networks is told that its port is not reachable', () => {
  const n = notes({ networks: [{ name: 'backend', internal: true }] });
  assert.ok(n.some((x) => x.startsWith('app is only on internal networks')));
  assert.ok(!notes({ networks: [{ name: 'backend', internal: true }, { name: 'edge' }] }).some((x) => x.includes('only on internal networks')));
});

test('networks are validated', () => {
  const bad = (opts, pattern) => assert.throws(() => run(opts), pattern);
  bad({ networks: [{ name: 'Bad Name' }] }, /invalid network name/);
  bad({ networks: [{ name: 'default' }] }, /"default" is the network compose creates itself/);
  bad({ networks: [{ name: 'a' }, { name: 'a' }] }, /declared twice/);
  bad({ networks: [{ name: 'a', internal: true, external: true }] }, /both internal and external/);
  bad({ networks: [{ name: 'a' }], appNetworks: ['b'] }, /service app joins the network "b", which is not declared \(a\)/);
  bad({ networks: [{ name: 'a' }], dbNetworks: ['c'] }, /the databases joins the network "c"/);
  bad({ networks: [{ name: 'a' }], services: [svc('x', 'node', { networks: ['z'] })] }, /service x joins the network "z"/);
});

test('the API takes networks, and the services of a request their own', () => {
  const data = handleGenerate({
    stack: 'node',
    ci: 'none',
    db: ['postgres'],
    networks: [{ name: 'frontend' }, { name: 'backend', internal: true, external: false }],
    appNetworks: 'frontend',
    dbNetworks: ['backend'],
  });
  const text = data.files.find((f) => f.path === 'docker-compose.yml').content;
  assert.match(text, /- frontend\n {2}postgres:/);
  assert.match(text, /backend:\n {4}internal: true/);
  const multi = handleGenerate({ ci: 'none', networks: [{ name: 'n' }], services: [{ name: 'a', dir: 'a', stack: 'node', networks: ['n'] }, { name: 'b', dir: 'b', stack: 'node' }] });
  assert.match(multi.files.find((f) => f.path === 'docker-compose.yml').content, /^ {2}a:[\s\S]*networks:\n {6}- n\n {2}b:/m);
  assert.throws(() => handleGenerate({ stack: 'node', networks: ['x'] }), /a network must be an object/);
  assert.throws(() => handleGenerate({ stack: 'node', networks: [{ name: 'a' }], appNetworks: ['nope'] }), /not declared/);
});
