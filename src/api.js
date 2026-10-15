// The generator's HTTP surface, independent of the web framework: Next route handlers wrap these functions.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import {
  generate,
  writeFiles,
  stackInfo,
  dbIds,
  ciIds,
  KINDS,
  RESTART_POLICIES,
  VARIANTS,
  STAGE_MODES,
  PERMISSIONS,
  TEST_OS,
  PLATFORMS,
  CONCURRENCY,
  DEPLOY_ON,
  REGISTRY_CHOICES,
  EXTRAS,
  targetInfo,
  registryInfo,
  providerInfo,
  IMAGE_TAGS,
  SEVERITIES,
} from './generate.js';

const MAX_BODY = 512 * 1024;
const MAX_PREVIEW = 256 * 1024;
const MAX_FOLDERS = 500;

/**
 * Hosted mode (Vercel, or DOCKCRATE_HOSTED=1): the server is someone else's machine, so nothing may touch its disk.
 * Files are generated to copy or download; browsing folders and writing to one are refused.
 */
export const isHosted = () => Boolean(process.env.VERCEL) || process.env.DOCKCRATE_HOSTED === '1';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Local: the server only listens on 127.0.0.1, but a web page you visit could still try to drive it (CSRF) or rebind
 * its own hostname to 127.0.0.1 (DNS rebinding). Both show up as a foreign Host or Origin header.
 */
export function guard(headers) {
  const host = headers.get('host') ?? '';
  // Hosted, any Host is the public site; there is no local disk or private path to protect, but cross-site posts are still refused.
  if (!isHosted() && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new HttpError(403, 'forbidden host');
  const origin = headers.get('origin');
  if (origin && new URL(origin).host !== host) throw new HttpError(403, 'forbidden origin');
}

/** JSON response, gzip-compressed when the client accepts it and the body is large enough to matter. */
function jsonResponse(request, body, status = 200) {
  const text = JSON.stringify(body);
  const headers = { 'content-type': 'application/json', 'cache-control': 'private, no-cache', vary: 'accept-encoding' };
  if (text.length > 1024 && /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')) {
    return new Response(gzipSync(text), { status, headers: { ...headers, 'content-encoding': 'gzip' } });
  }
  return new Response(text, { status, headers });
}

/** Wraps a JSON handler as a Next route handler: guards the request, parses the body, maps errors to statuses. */
export const apiRoute = (handler) => async (request) => {
  try {
    guard(request.headers);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'expected application/json');
    const text = await request.text();
    if (text.length > MAX_BODY) throw new HttpError(413, 'request too large');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'invalid JSON');
    }
    return jsonResponse(request, await handler(body));
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    return jsonResponse(request, { error: status === 500 ? 'internal error' : err.message }, status);
  }
};

const blank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
// "a, b" or ["a", "b"] -> ["a", "b"]
const list = (v) => (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

function existingFolder(input) {
  if (typeof input !== 'string' || !input.trim()) throw new HttpError(400, 'enter a folder');
  const dir = expand(input);
  if (!isDirectory(dir)) throw new HttpError(400, `${dir} is not a directory`);
  return dir;
}

const expand = (input) => resolve(input.trim().replace(/^~(?=$|\/)/, homedir()));

/** The project folder the files are added to: may not exist yet (it is created on write), may be blank (preview only). */
function targetDir(input) {
  if (input == null || (typeof input === 'string' && !input.trim())) return null;
  if (typeof input !== 'string') throw new HttpError(400, 'invalid folder');
  const dir = expand(input);
  try {
    if (!statSync(dir).isDirectory()) throw new HttpError(400, `${dir} exists and is not a folder`);
  } catch (err) {
    if (err instanceof HttpError) throw err;
  }
  return dir;
}

/** Current content of `path` inside `dir`, or null when there is no such file. */
function existingContent(dir, path) {
  try {
    return readFileSync(join(dir, path), 'utf8').slice(0, MAX_PREVIEW);
  } catch {
    return null;
  }
}

/** Everything the UI needs to render its controls. `cwd` is where `dockcrate serve` was started. */
export function getMeta() {
  return {
    stacks: stackInfo(),
    dbs: dbIds(),
    ci: ciIds(),
    kinds: KINDS,
    restartPolicies: RESTART_POLICIES,
    variants: VARIANTS,
    stageModes: STAGE_MODES,
    extras: EXTRAS,
    targets: targetInfo(),
    registries: registryInfo(),
    providers: providerInfo(),
    pipeline: { permissions: PERMISSIONS, testOs: TEST_OS, platforms: PLATFORMS, concurrency: CONCURRENCY, deployOn: DEPLOY_ON, registry: REGISTRY_CHOICES, imageTags: IMAGE_TAGS, severities: SEVERITIES },
    hosted: isHosted(),
    cwd: isHosted() ? '' : (process.env.DOCKCRATE_CWD ?? process.cwd()),
    home: isHosted() ? '' : homedir(),
  };
}

/** Subfolders of `dir` (hidden ones and node_modules left out), so a project folder can be picked. */
export function handleBrowse(body) {
  if (isHosted()) throw new HttpError(404, 'not available on the hosted site');
  const dir = existingFolder(body.dir || homedir());
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
  } catch {
    throw new HttpError(400, `cannot read ${dir}`);
  }
  const entries = names
    .filter((name) => !name.startsWith('.') && name !== 'node_modules' && isDirectory(join(dir, name)))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_FOLDERS)
    .map((name) => ({ name }));
  const parent = dirname(dir);
  return { dir, parent: parent === dir ? null : parent, entries };
}

const STRING_OPTIONS = [
  'stack', 'ci', 'imageVariant', 'stageMode', 'restart', 'runtime', 'buildDir', 'tool', 'deploy', 'deployOn', 'environment', 'concurrency', 'healthcheck', 'registry', 'runner', 'timeout', 'pipelineName',
];
const LIST_OPTIONS = [
  'permissions', 'appNetworks', 'dbNetworks', 'testVersions', 'testOs', 'platforms', 'ciServices', 'packages', 'extras', 'imageTags', 'scanSeverity',
  'branchesIgnore', 'tags', 'tagsIgnore', 'prBranches', 'paths', 'pathsIgnore', 'sharedPaths',
];
const FLAG_OPTIONS = [
  'changedOnly', 'dbPerService', 'multistage', 'pullRequests', 'manual', 'release', 'scan', 'lintDockerfile', 'sbom', 'sign', 'codeScan', 'depCache', 'layerCache', 'pinActions', 'failFast', 'testJob',
];

const SERVICE_STRINGS = ['name', 'dir', 'stack', 'runtime', 'tool', 'buildDir', 'project', 'healthcheck', 'imageVariant', 'stageMode'];
const SERVICE_LISTS = ['packages', 'db', 'testVersions', 'networks'];

/** One service of the request, reduced to the options the generator knows (it validates their values). */
function cleanService(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError(400, 'a service must be an object');
  const svc = {};
  for (const key of SERVICE_STRINGS) if (!blank(raw[key])) svc[key] = String(raw[key]);
  for (const key of SERVICE_LISTS) if (!blank(raw[key])) svc[key] = list(raw[key]);
  if (raw.ciSteps != null) svc.ciSteps = list(raw.ciSteps); // an empty list is meaningful ("no steps")
  if (typeof raw.multistage === 'boolean') svc.multistage = raw.multistage;
  for (const key of ['env', 'buildArgs']) if (!blank(raw[key])) svc[key] = raw[key];
  if (!blank(raw.port)) svc.port = Number(raw.port);
  return svc;
}

/** Preview (or, with `write: true`, write) the files for the options in `body`. */
export function handleGenerate(body) {
  const hosted = isHosted();
  if (hosted && body.write === true) {
    throw new HttpError(400, 'the hosted site generates files to copy or download; run Dockcrate locally to write them into a folder');
  }
  const dir = hosted ? null : targetDir(body.dir);
  const opts = {};
  for (const key of STRING_OPTIONS) {
    if (!blank(body[key])) opts[key] = String(body[key]);
  }
  if (!blank(body.name)) opts.name = String(body.name);
  // An empty branch list, tag list or CI step list is meaningful ("none"), unlike the other blank fields.
  if (body.branches != null) opts.branches = list(body.branches);
  if (body.schedule != null) opts.schedule = Array.isArray(body.schedule) ? body.schedule : String(body.schedule).split('\n').map((s) => s.trim()).filter(Boolean);
  if (body.edits != null) opts.edits = body.edits;
  if (Array.isArray(body.services) && body.services.length) opts.services = body.services.map(cleanService);
  if (body.envs != null) opts.envs = list(body.envs);
  if (Array.isArray(body.networks) && body.networks.length) {
    opts.networks = body.networks.map((n) => {
      if (typeof n !== 'object' || n === null) throw new HttpError(400, 'a network must be an object');
      return { name: String(n.name ?? ''), internal: n.internal === true, external: n.external === true };
    });
  }
  if (Array.isArray(body.deployTo) && body.deployTo.length) {
    opts.deployTo = body.deployTo.map((d) => {
      if (typeof d !== 'object' || d === null) throw new HttpError(400, 'a deployment must be an object');
      return { name: String(d.name ?? ''), on: String(d.on ?? ''), ...(!blank(d.match) && { match: String(d.match) }) };
    });
  }
  if (body.ciSteps != null) opts.ciSteps = list(body.ciSteps);
  for (const key of FLAG_OPTIONS) {
    if (typeof body[key] === 'boolean') opts[key] = body[key];
  }
  for (const key of LIST_OPTIONS) {
    if (body[key] != null) opts[key] = list(body[key]);
  }
  for (const key of ['env', 'buildArgs', 'pipelineEnv']) {
    if (!blank(body[key])) opts[key] = body[key];
  }
  if (!blank(body.db)) opts.db = [].concat(body.db).map(String);
  if (!blank(body.port)) opts.port = Number(body.port);
  if (!blank(body.replicas)) opts.replicas = Number(body.replicas);
  if (typeof body.build === 'boolean') opts.build = body.build;
  if (Array.isArray(body.include)) opts.include = body.include.map(String);

  let result;
  try {
    result = generate(dir, opts);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  result.files = result.files.map((f) => ({ ...f, existing: dir ? existingContent(dir, f.path) : null }));
  if (body.write === true) {
    if (!dir) throw new HttpError(400, 'choose a folder to write to');
    result.written = writeFiles(dir, result.files, { force: body.force === true });
  }
  return { dir, ...result };
}
