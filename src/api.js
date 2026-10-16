// The generator's HTTP surface, independent of the web framework: Next route handlers wrap these functions.
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import {
  generate,
  stackInfo,
  dbIds,
  ciIds,
  KINDS,
  RESTART_POLICIES,
  VARIANTS,
  STAGE_MODES,
  PERMISSIONS,
  CLOUD_AUTH,
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
  LIMITS,
} from './generate.js';
import { isHosted } from './hosted.js';

const gzip = promisify(gzipCallback);

/** Largest request body, in bytes. */
export const MAX_BODY = 512 * 1024;
/** Largest generated output (the files' contents, in bytes) a request may produce. */
export const MAX_OUTPUT = 5 * 1024 * 1024;

export { isHosted };

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
  if (origin) {
    // `Origin: null` (sandboxed frames, file://, some redirects) and malformed values are foreign too.
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'forbidden origin');
    }
    if (originHost !== host) throw new HttpError(403, 'forbidden origin');
  }
}

/** JSON that is safe inside a <script> element: `</script>`, `<!--` and the line separators JavaScript treats as newlines are escaped. */
export const scriptJson = (value) =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/i;
const FALLBACK_ORIGIN = 'http://localhost:4173';

/**
 * The origin a request was made to, from its Host and (hosted only) X-Forwarded-Proto headers, for canonical and Open Graph
 * URLs. Only a plain hostname[:port] and http/https are used; anything else falls back to localhost, never throws.
 */
export function requestOrigin(headers) {
  const host = headers.get('host') ?? '';
  if (!HOST.test(host)) return FALLBACK_ORIGIN;
  if (!isHosted()) {
    try {
      guard(headers);
    } catch {
      return FALLBACK_ORIGIN;
    }
    return `http://${host}`;
  }
  const proto = (headers.get('x-forwarded-proto') ?? 'https').split(',')[0].trim().toLowerCase();
  return `${proto === 'http' ? 'http' : 'https'}://${host}`;
}

/** JSON response, gzip-compressed (off the event loop) when the client accepts it and the body is large enough to matter. */
async function jsonResponse(request, body, status = 200) {
  const text = JSON.stringify(body);
  const headers = { 'content-type': 'application/json', 'cache-control': 'private, no-cache', vary: 'accept-encoding' };
  if (text.length > 1024 && /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')) {
    return new Response(await gzip(text), { status, headers: { ...headers, 'content-encoding': 'gzip' } });
  }
  return new Response(text, { status, headers });
}

/**
 * The request body as text, at most MAX_BODY bytes: a larger Content-Length is refused before reading, and the stream is
 * counted in bytes as it arrives (a missing or false Content-Length cannot make it buffer more).
 */
async function readBody(request) {
  const declared = request.headers.get('content-length');
  if (declared != null && !(Number(declared) <= MAX_BODY)) throw new HttpError(413, 'request too large');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, 'request too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Wraps a JSON handler as a Next route handler: guards the request, parses the body, maps errors to statuses. */
export const apiRoute = (handler) => async (request) => {
  try {
    guard(request.headers);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'expected application/json');
    const text = await readBody(request);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'invalid JSON');
    }
    return await jsonResponse(request, await handler(body));
  } catch (err) {
    const status = err.status ?? 500;
    if (status === 500) console.error(err);
    return jsonResponse(request, { error: status === 500 ? 'internal error' : err.message }, status);
  }
};

const blank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
// "a, b" or ["a", "b"] -> ["a", "b"]
const list = (v) => (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);

/** Everything the UI needs to render its controls. */
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
    pipeline: { permissions: PERMISSIONS, cloudAuth: CLOUD_AUTH, testOs: TEST_OS, platforms: PLATFORMS, concurrency: CONCURRENCY, deployOn: DEPLOY_ON, registry: REGISTRY_CHOICES, imageTags: IMAGE_TAGS, severities: SEVERITIES },
    hosted: isHosted(),
  };
}

const STRING_OPTIONS = [
  'stack', 'ci', 'imageVariant', 'stageMode', 'restart', 'runtime', 'buildDir', 'tool', 'deploy', 'deployOn', 'environment', 'concurrency', 'healthcheck', 'registry', 'runner', 'timeout', 'pipelineName', 'cloudAuth',
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

/** The files for the options in `body`; nothing is read or written on the server's disk. */
export function handleGenerate(body) {
  const opts = {};
  for (const key of STRING_OPTIONS) {
    if (!blank(body[key])) opts[key] = String(body[key]);
  }
  if (!blank(body.name)) opts.name = String(body.name);
  // An empty branch list, tag list or CI step list is meaningful ("none"), unlike the other blank fields.
  if (body.branches != null) opts.branches = list(body.branches);
  if (body.schedule != null) opts.schedule = Array.isArray(body.schedule) ? body.schedule : String(body.schedule).split('\n').map((s) => s.trim()).filter(Boolean);
  if (body.edits != null) opts.edits = body.edits;
  for (const key of ['services', 'deployTo', 'networks']) {
    if (Array.isArray(body[key]) && body[key].length > LIMITS[key]) throw new HttpError(400, `${key} has ${body[key].length} entries; at most ${LIMITS[key]}`);
  }
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
    result = generate(null, opts);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  // The caps in generate() bound every option; this bounds what they multiply into (services x deployments x ...).
  let size = 0;
  for (const f of result.files) size += Buffer.byteLength(f.content ?? '');
  if (size > MAX_OUTPUT) throw new HttpError(413, `the generated files are too large (${Math.ceil(size / 1024 / 1024)} MB; at most ${MAX_OUTPUT / 1024 / 1024} MB): use fewer services, deployments or environments`);
  return result;
}
