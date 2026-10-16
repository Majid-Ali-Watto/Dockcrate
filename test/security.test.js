// Limits and hardening of the API, the generator's validation and the only writer (writeFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { MAX_BODY, apiRoute, guard, handleGenerate, isHosted, requestOrigin, scriptJson } from '../src/api.js';
import { LIMITS, generate, stackIds, writeFiles } from '../src/generate.js';

const status = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status ?? err.message;
  }
};
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const services = (n) => many(n, (i) => ({ name: `s${i}`, dir: `s${i}`, stack: 'node' }));

const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v == null) delete process.env[k]; else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v == null) delete process.env[k]; else process.env[k] = v;
  }
};

// ---- 1. size limits (shared by the CLI and the API) and the output cap

test('lists are capped: services, deployments, environments, networks and any other list option', () => {
  assert.deepEqual(LIMITS, { services: 32, deployTo: 20, envs: 10, networks: 20 });
  assert.equal(status(() => handleGenerate({ services: services(33) })), 400);
  assert.equal(status(() => handleGenerate({ ...{ services: services(2) }, deploy: 'ssh', deployTo: many(21, (i) => ({ name: `d${i}`, on: 'manual' })) })), 400);
  assert.equal(status(() => handleGenerate({ stack: 'node', envs: many(11, (i) => `e${i}`) })), 400);
  assert.equal(status(() => handleGenerate({ stack: 'node', networks: many(21, (i) => ({ name: `n${i}` })) })), 400);
  assert.equal(status(() => handleGenerate({ stack: 'node', branches: many(51, (i) => `b${i}`) })), 400);
  assert.equal(status(() => handleGenerate({ stack: 'node', packages: many(51, (i) => `p${i}`).join(' ') })), 400);
  assert.equal(status(() => handleGenerate({ stack: 'node', pipelineName: 'x'.repeat(17 * 1024) })), 400);
  assert.equal(status(() => handleGenerate({ services: [{ name: 'a', dir: 'a', stack: 'node', packages: many(51, (i) => `p${i}`) }] })), 400);
  // at the limits it still generates
  const ok = handleGenerate({ services: services(32), deploy: 'ssh', deployTo: many(20, (i) => ({ name: `d${i}`, on: 'manual' })), envs: many(10, (i) => (i ? `e${i}` : 'dev')) });
  assert.equal(ok.services.length, 32);
  // the CLI goes through the same validation
  assert.throws(() => generate(null, { stack: 'node', deploy: 'ssh', deployTo: many(21, (i) => ({ name: `d${i}`, on: 'manual' })) }), /deployTo has 21 entries; at most 20/);
  assert.throws(() => generate(null, { stack: 'node', envs: many(11, (i) => `e${i}`) }), /envs has 11 entries; at most 10/);
});

test('edits are bounded: files edited, blocks changed or added, custom files', () => {
  const add = (n) => ({ add: many(n, (i) => ({ id: `a${i}`, text: 'x' })) });
  assert.throws(() => generate(null, { stack: 'node', edits: Object.fromEntries(many(51, (i) => [`custom/f${i}.txt`, add(1)])) }), /at most 50 custom files/);
  assert.throws(() => generate(null, { stack: 'node', edits: { Dockerfile: add(201) } }), /adds too many blocks/);
  assert.throws(() => generate(null, { stack: 'node', edits: Object.fromEntries(many(501, (i) => [`f${i}`, {}])) }), /at most 500/);
});

test('a request whose options multiply into too much output is refused with 413', () => {
  const env = many(30, (i) => `K${i}=${'v'.repeat(16000)}`); // ~480 KB, copied into each of the 32 Dockerfiles
  assert.equal(status(() => handleGenerate({ services: services(32), include: ['dockerfile'], env })), 413);
});

// ---- 2. request body: Content-Length and a byte-counted stream

const fakeRequest = ({ headers = {}, body }) => ({
  headers: new Headers({ host: 'localhost:4173', 'content-type': 'application/json', ...headers }),
  body,
});

test('a declared Content-Length over the limit is refused before the body is read', async () => {
  let pulled = false;
  const body = new ReadableStream({ pull() { pulled = true; } }, { highWaterMark: 0 });
  const res = await apiRoute(() => ({}))(fakeRequest({ headers: { 'content-length': String(MAX_BODY + 1) }, body }));
  assert.equal(res.status, 413);
  assert.equal(pulled, false);
});

test('the body stream is counted in bytes and abandoned past the limit', async () => {
  let chunks = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const res = await apiRoute(() => ({}))(fakeRequest({ body }));
  assert.equal(res.status, 413);
  assert.ok(chunks <= MAX_BODY / (64 * 1024) + 2, `read ${chunks} chunks`);
  assert.equal(cancelled, true);
  // multi-byte text: fewer UTF-16 units than the limit, more bytes
  const text = JSON.stringify({ pad: '€'.repeat(200 * 1024) });
  assert.ok(text.length < MAX_BODY && Buffer.byteLength(text) > MAX_BODY);
  const req = new Request('http://localhost:4173/api/x', { method: 'POST', headers: { host: 'localhost:4173', 'content-type': 'application/json' }, body: text });
  assert.equal((await apiRoute(() => ({}))(req)).status, 413);
});

test('large responses are gzip-compressed when accepted', async () => {
  const req = new Request('http://localhost:4173/api/x', { method: 'POST', headers: { host: 'localhost:4173', 'content-type': 'application/json', 'accept-encoding': 'gzip' }, body: '{}' });
  const res = await apiRoute(() => ({ big: 'y'.repeat(5000) }))(req);
  assert.equal(res.headers.get('content-encoding'), 'gzip');
  assert.equal(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer()))).big.length, 5000);
});

// ---- 3. Origin: null and malformed values are 403, not 500

test('Origin: null or a malformed Origin is a 403', async () => {
  for (const origin of ['null', 'not a url', 'http://[::1']) {
    assert.equal(status(() => guard(new Headers({ host: 'localhost:4173', origin }))), 403, origin);
    const req = new Request('http://localhost:4173/api/x', { method: 'POST', headers: { host: 'localhost:4173', 'content-type': 'application/json', origin }, body: '{}' });
    assert.equal((await apiRoute(() => ({}))(req)).status, 403, origin);
  }
});

// ---- 4. JSON-LD and the request origin

test('JSON for a <script> element cannot close it or start a comment', () => {
  const value = { a: '</script><script>alert(1)</script>', b: '<!-- & -->', c: 'line\u2028sep\u2029' };
  const out = scriptJson(value);
  assert.doesNotMatch(out, /[<>&\u2028\u2029]/);
  assert.deepEqual(JSON.parse(out), value);
});

test('the request origin only uses a plain host and http/https, and never throws', () =>
  withEnv({ DOCKCRATE_HOSTED: '1', VERCEL: undefined }, () => {
    const origin = (headers) => requestOrigin(new Headers(headers));
    assert.equal(origin({ host: 'dockcrate.example', 'x-forwarded-proto': 'https' }), 'https://dockcrate.example');
    assert.equal(origin({ host: 'dockcrate.example:8443', 'x-forwarded-proto': 'http' }), 'http://dockcrate.example:8443');
    assert.equal(origin({ host: 'dockcrate.example', 'x-forwarded-proto': 'javascript' }), 'https://dockcrate.example');
    assert.equal(origin({ host: 'dockcrate.example', 'x-forwarded-proto': 'https, http' }), 'https://dockcrate.example');
    for (const host of ['evil.example/<script>', 'a b', 'x"onload=1', '', 'evil.example:99999999', '-bad.example']) {
      assert.equal(origin({ host }), 'http://localhost:4173', host);
    }
  }));

test('locally the request origin is a localhost one or the default', () =>
  withEnv({ DOCKCRATE_HOSTED: undefined, VERCEL: undefined }, () => {
    assert.equal(requestOrigin(new Headers({ host: '127.0.0.1:3000' })), 'http://127.0.0.1:3000');
    assert.equal(requestOrigin(new Headers({ host: 'evil.example' })), 'http://localhost:4173');
  }));

// ---- 5. .git in any spelling, and option-like names

test('custom file paths: .git in any case or with trailing dots, dot-only and dash-led segments are refused', () => {
  const custom = (path) => () => generate(null, { stack: 'node', edits: { [path]: { add: [{ id: 'a', text: 'x' }] } } });
  for (const path of ['.GIT/config', '.git./config', '.Git../hooks/x', 'a/.git/hooks/pre-commit', 'git~1/config', '-n.x/file', 'a/-rf', './x', 'a/./b']) {
    assert.throws(custom(path), /invalid custom file path/, path);
  }
  assert.doesNotThrow(custom('.github/CODEOWNERS'));
  assert.doesNotThrow(custom('scripts/git-tools.sh'));
});

test('service folders: .git in any spelling and a leading dash are refused', () => {
  for (const dir of ['.GIT', 'api/.git.', '-n.x', 'apps/-x', 'a/.']) {
    assert.equal(status(() => handleGenerate({ services: [{ name: 'a', dir, stack: 'node' }] })), 400, dir);
  }
  assert.equal(handleGenerate({ services: [{ name: 'a', dir: 'apps/web-1', stack: 'node' }] }).services[0].dir, 'apps/web-1');
});

// ---- 6. writeFiles never follows a symbolic link

const sandbox = () => {
  const root = mkdtempSync(join(tmpdir(), 'dockcrate-'));
  const dir = join(root, 'project');
  const outside = join(root, 'outside');
  mkdirSync(dir);
  mkdirSync(outside);
  return { root, dir, outside, done: () => rmSync(root, { recursive: true, force: true }) };
};

test('writeFiles writes, keeps existing files and overwrites only with force', () => {
  const s = sandbox();
  try {
    assert.deepEqual(writeFiles(s.dir, [{ path: 'a/b/c.txt', content: '1' }, { path: 'Dockerfile', content: 'x' }]).map((r) => r.status), ['written', 'written']);
    assert.equal(writeFiles(s.dir, [{ path: 'a/b/c.txt', content: '2' }])[0].status, 'skipped');
    assert.equal(readFileSync(join(s.dir, 'a/b/c.txt'), 'utf8'), '1');
    assert.equal(writeFiles(s.dir, [{ path: 'a/b/c.txt', content: '3' }], { force: true })[0].status, 'written');
    assert.equal(readFileSync(join(s.dir, 'a/b/c.txt'), 'utf8'), '3');
  } finally {
    s.done();
  }
});

test('writeFiles refuses a symlinked folder or file inside the target, and writes nothing then', (t) => {
  const s = sandbox();
  try {
    try {
      symlinkSync(s.outside, join(s.dir, '.github'), 'dir');
    } catch {
      t.skip('symbolic links are not available here');
      return;
    }
    writeFileSync(join(s.outside, 'secret'), 'keep');
    symlinkSync(join(s.outside, 'secret'), join(s.dir, 'Dockerfile'));
    const files = [{ path: 'first.txt', content: 'x' }, { path: '.github/workflows/ci.yml', content: 'evil' }];
    assert.throws(() => writeFiles(s.dir, files), /\.github is a symbolic link/);
    assert.equal(existsSync(join(s.dir, 'first.txt')), false, 'checked before anything is written');
    assert.equal(existsSync(join(s.outside, 'workflows')), false);
    for (const force of [false, true]) {
      assert.throws(() => writeFiles(s.dir, [{ path: 'Dockerfile', content: 'evil' }], { force }), /Dockerfile is a symbolic link/);
    }
    assert.equal(readFileSync(join(s.outside, 'secret'), 'utf8'), 'keep');
    assert.ok(lstatSync(join(s.dir, 'Dockerfile')).isSymbolicLink());
    assert.throws(() => writeFiles(s.dir, [{ path: '../escape', content: 'x' }]), /not a plain relative path/);
    assert.throws(() => writeFiles(s.dir, [{ path: '/etc/x', content: 'x' }]), /not a plain relative path/);
  } finally {
    s.done();
  }
});

test('writeFiles accepts a target folder that is itself a symbolic link (the user chose it)', (t) => {
  const s = sandbox();
  try {
    const link = join(s.root, 'link');
    try {
      symlinkSync(s.dir, link, 'dir');
    } catch {
      t.skip('symbolic links are not available here');
      return;
    }
    assert.equal(writeFiles(link, [{ path: 'Dockerfile', content: 'x' }])[0].status, 'written');
    assert.equal(readFileSync(join(s.dir, 'Dockerfile'), 'utf8'), 'x');
  } finally {
    s.done();
  }
});

// ---- 7. .dockerignore keeps secrets out wherever they are in the context

const SECRETS = ['**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/id_ed25519*', '**/.npmrc', '**/.pypirc', '**/.aws', '**/.ssh'];

test('.dockerignore of every stack and build mode ignores secrets in subfolders, and still lets .env.example in', () => {
  for (const stack of stackIds()) {
    for (const mode of [{}, { multistage: false }, { multistage: false, stageMode: 'mixed' }]) {
      const ignore = generate(null, { stack, ...mode, include: ['dockerignore'] }).files[0].content.split('\n');
      for (const line of SECRETS) assert.ok(ignore.includes(line), `${stack} ${JSON.stringify(mode)}: ${line}`);
      // the last rule that matches wins: the exception comes after the patterns that would exclude it
      assert.ok(ignore.lastIndexOf('!**/.env.example') > ignore.lastIndexOf('**/.env.*'), stack);
      // the lines that were there before keep their place (block ids are per line)
      assert.deepEqual(ignore.slice(0, 3), ['.git', '.gitignore', '.github']);
    }
  }
});

// ---- 8. headers and the proxy matcher

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('static headers: HSTS and the current Permissions-Policy feature names', () => {
  const config = read('next.config.mjs');
  assert.match(config, /Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains'/);
  assert.match(config, /browsing-topics=\(\)/);
  assert.doesNotMatch(config, /interest-cohort/);
  assert.doesNotMatch(config, /writes to disk|reads and writes the local disk/);
});

test('the proxy runs on every page, also paths with a dot, and skips only the API and static files', async () => {
  const proxy = read('proxy.js');
  const source = /matcher: \['([^']+)'\]/.exec(proxy)[1].replace(/\\\\/g, '\\');
  const { tryToParsePath } = createRequire(import.meta.url)('next/dist/lib/try-to-parse-path');
  const re = new RegExp(tryToParsePath(source).regexStr);
  for (const path of ['/', '/generator', '/x.y', '/wp-login.php', '/dockerfile-generator', '/a.js/b']) assert.ok(re.test(path), path);
  for (const path of ['/api/generate', '/_next/static/chunks/a.js', '/_next/image', '/icons/icon-512.png', '/favicon.ico', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml', '/og-image.png']) {
    assert.ok(!re.test(path), path);
  }
  // a client-sent x-nonce never reaches the layout, and upgrade-insecure-requests is hosted-only
  assert.match(proxy, /headers\.delete\('x-nonce'\)/);
  assert.match(proxy, /isHosted\(\) \? \['upgrade-insecure-requests'\] : \[\]/);
});

// ---- 9. hosted detection

test('a local `vercel env pull` (.env with VERCEL=1, VERCEL_ENV=development) does not switch hosted mode on', async () => {
  await withEnv({ VERCEL: '1', VERCEL_ENV: 'development', DOCKCRATE_HOSTED: undefined }, () => assert.equal(isHosted(), false));
  await withEnv({ VERCEL: '1', VERCEL_ENV: 'development', DOCKCRATE_HOSTED: '1' }, () => assert.equal(isHosted(), true));
  await withEnv({ VERCEL: '1', VERCEL_ENV: 'preview', DOCKCRATE_HOSTED: undefined }, () => assert.equal(isHosted(), true));
  await withEnv({ VERCEL: '1', VERCEL_ENV: 'production', DOCKCRATE_HOSTED: undefined }, () => assert.equal(isHosted(), true));
  await withEnv({ VERCEL: undefined, VERCEL_ENV: undefined, DOCKCRATE_HOSTED: undefined }, () => assert.equal(isHosted(), false));
});
