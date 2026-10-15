// Describing the services of a project: one folder with one stack each, shipped together.
import { basename } from 'node:path';
import { STACKS } from './stacks/index.js';

export const stackIds = () => STACKS.map((s) => s.id);

export function findStack(id) {
  const stack = STACKS.find((s) => s.id === id);
  if (!stack) throw new Error(`unknown stack "${id}"; choose one of: ${stackIds().join(', ')}`);
  return stack;
}

/** Lowercase DNS-style name for image repositories and Kubernetes/Fly/ECS resources. */
export function appSlug(raw) {
  const slug = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return 'app';
  return /^[a-z]/.test(slug) ? slug : `app-${slug}`;
}

const NAME = /^[a-z][a-z0-9-]*$/;
const DIR = /^(\.|(?!.*\.\.)[\w.-]+(\/[\w.-]+)*)$/;

export const cleanServiceDir = (dir) => String(dir ?? '.').trim().replace(/^\.\//, '').replace(/\/+$/, '') || '.';

/** `[name=]dir:stack[@port]`, the compact form of one service on the command line. */
export function parseServiceSpec(spec) {
  const m = /^(?:([a-z][a-z0-9-]*)=)?([^:@=]+):([a-z]+)(?:@(\d+))?$/.exec(String(spec).trim());
  if (!m) throw new Error(`invalid service "${spec}": use [name=]dir:stack[@port], for example api=./api:django@8000`);
  const [, name, dir, stack, port] = m;
  return { ...(name && { name }), dir, stack, ...(port && { port: Number(port) }) };
}

const MAX_SERVICES = 32;

/** Validates and normalises the services; names default to the folder name and are made unique. */
export function normalizeServices(raw) {
  if (raw.length > MAX_SERVICES) throw new Error(`at most ${MAX_SERVICES} services`);
  const taken = new Set();
  const services = raw.map((svc, i) => {
    if (typeof svc !== 'object' || svc === null || Array.isArray(svc)) throw new Error(`service ${i + 1} must be an object`);
    const dir = cleanServiceDir(svc.dir ?? svc.name);
    if (!DIR.test(dir)) throw new Error(`invalid service folder "${svc.dir}": use a relative path inside the project`);
    let name = svc.name ?? (dir === '.' ? 'app' : appSlug(basename(dir)));
    if (!NAME.test(name)) throw new Error(`invalid service name "${name}": lowercase letters, digits and dashes, starting with a letter`);
    if (!svc.name && taken.has(name)) name = appSlug(dir);
    if (taken.has(name)) throw new Error(`two services are called "${name}"; give each its own name`);
    taken.add(name);
    return { ...svc, name, dir };
  });
  const dirs = new Map();
  for (const s of services) {
    if (dirs.has(s.dir)) throw new Error(`services "${dirs.get(s.dir)}" and "${s.name}" both point at ${s.dir}`);
    dirs.set(s.dir, s.name);
  }
  return services;
}
