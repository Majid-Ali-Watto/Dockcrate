// Helpers shared by every CI renderer (a renderer turns the pipeline description from buildPipeline into blocks).
import { DBS } from '../compose.js';
import { REGISTRIES } from '../deploy.js';

export { block } from '../blocks.js';

/** Conditional part of a document: `0` and `''` (from `list.length &&`, `text &&`) must not end up as lines. */
export const when = (cond, ...parts) => (cond ? parts : null);
/** GitHub Actions expression, kept out of template literals so `${{` stays readable. */
export const x = (expr) => '${{ ' + expr + ' }}';
export const q = (v) => JSON.stringify(String(v));
/** Plain YAML scalar when safe, otherwise a double-quoted (JSON) one. */
export const scalar = (s) => (/^[\w./@=+ -]+$/.test(s) ? s : JSON.stringify(s));

/** A shell command as a YAML list item: plain when that is unambiguous, double-quoted otherwise. */
export const cmd = (s) => (/(: | #)|^[-?:,[\]{}#&*!|>'"%@`]|:$|^\s|\s$/.test(s) ? JSON.stringify(s) : s);

export function mapLines(obj, pad) {
  return Object.entries(obj).flatMap(([k, v]) =>
    String(v).includes('\n') ? [`${pad}${k}: |`, ...String(v).split('\n').map((l) => `${pad}  ${l}`)] : [`${pad}${k}: ${q(v)}`],
  );
}

// ---------------------------------------------------------------------------------------- service containers

export const plain = (text) => text.replace('${DB_PASSWORD:-app}', 'app');
export const healthCmd = (name) => (name === 'mongo' ? 'mongosh --quiet --eval 1' : DBS[name].healthcheck.slice(1).join(' '));

/** [ENV_NAME, url] that points the tests at the service (`host` is localhost on GitHub, the alias elsewhere). */
export function serviceUrl(name, host) {
  const [key, url] = DBS[name].url;
  // URLs with a scheme carry the host after `@` or `//`; memcached's is a bare host:port.
  const hostAt = plain(url).includes('://') ? `(@|//)${name}:` : `^()${name}:`;
  return [key, plain(url).replace(new RegExp(hostAt), `$1${host}:`)];
}

export const serviceEnv = (name) => Object.fromEntries(Object.entries(DBS[name].env ?? {}).map(([k, v]) => [k, plain(v)]));

// ------------------------------------------------------------------------------------- step ids and titles

/** Stable id for a step, from what it does rather than where it sits: `setup-node`, `npm-run-lint`. */
export function stepKey(step) {
  if (step.key) return step.key;
  const raw = step.uses ? step.uses.replace(/@.*$/, '').split('/').slice(-1)[0] : (Array.isArray(step.run) ? step.run[0] : step.run ?? 'step').split(/\s+/).slice(0, 3).join(' ');
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'step';
}

export const stepTitle = (step) => step.title ?? step.name ?? (step.uses ? step.uses.replace(/@.*$/, '') : String(Array.isArray(step.run) ? step.run[0] : step.run).slice(0, 60));

/** Ids for a list of steps, made unique by a numeric suffix. */
export function uniqueKeys(steps) {
  const seen = new Map();
  return steps.map((s) => {
    const key = stepKey(s);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n > 1 ? `${key}-${n}` : key;
  });
}

/** The shell commands of a step list (GitHub-only `uses` steps have none). */
export const commandsOf = (steps) => steps.filter((s) => s?.run).flatMap((s) => [].concat(s.run));

/** Drop dependency-cache settings from setup steps when the user switched caching off. */
export function withoutDepCache(steps) {
  return steps
    .filter((s) => !/^Swatinem\/rust-cache/.test(s.uses ?? ''))
    .map((s) => {
      if (!s.with || !('cache' in s.with || 'bundler-cache' in s.with)) return s;
      const { cache, 'bundler-cache': bundler, ...rest } = s.with;
      return { ...s, with: rest };
    });
}

// ------------------------------------------------------------------------------- script based providers

const FALLBACK_BRANCH = 'main';
/** First plain (non-glob) pushed branch, which is what "the default branch" means for providers that cannot ask. */
export const defaultBranch = (p) => p.triggers.branches.find((b) => /^[\w./-]+$/.test(b)) ?? FALLBACK_BRANCH;

/**
 * What every provider that runs shell commands (GitLab, Jenkins, Bitbucket, Azure, CircleCI) needs, so each renderer only
 * maps it onto its own syntax. `vars` names the provider's environment variables:
 *   { sha, refSlug, tag, version, defaultBranchTest, pre? }   e.g. sha: 'CI_COMMIT_SHA', version: '$VERSION'
 * `pre` is shell that defines `refSlug` when the provider has no ready-made one. `alpine` says whether `apk` exists
 * where the registry login runs (without it the login relies on the CLI already being on the agent).
 */
export function shellPlan(p, ciSteps, vars, { alpine = true } = {}) {
  const registry = p.registryId ? REGISTRIES[p.registryId].shell : null;
  const repo = registry ? registry.image.replace('{app}', p.appName) : null;
  const test = ciSteps(p.versions.length ? vars.version : undefined);
  const sha = `$${vars.sha}`;
  const buildArgs = p.buildArgs.map((n) => `--build-arg ${n}="$${n}" `).join('');
  const refTag = p.imageTags.includes('branch') || p.imageTags.includes('tag') ? ` -t "$IMAGE_REPO:$${vars.refSlug}"` : '';
  const build = registry && [
    ...(vars.pre ?? []),
    `docker build ${buildArgs}-t "$IMAGE_REPO:${sha}"${refTag} .`,
    p.imageTags.includes('latest') && `if ${vars.defaultBranchTest}; then docker tag "$IMAGE_REPO:${sha}" "$IMAGE_REPO:latest"; fi`,
    p.imageTags.includes('semver') && `if [ -n "$${vars.tag}" ]; then docker tag "$IMAGE_REPO:${sha}" "$IMAGE_REPO:\${${vars.tag}#v}"; fi`,
  ].filter(Boolean);
  const scan = `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.69.3 image --exit-code 1 --severity ${p.scanSeverity.join(',')} --ignore-unfixed "$IMAGE_REPO:${sha}"`;

  const target = p.target;
  const needNames = [...(p.targetNeeds.secrets ?? []), ...(p.targetNeeds.vars ?? [])].map((n) => n.replace(/\?$/, ''));
  const deployEnv = target.script && {
    APP: p.appName,
    PORT: p.port,
    ...(registry && { IMAGE: `$IMAGE_REPO:${sha}` }),
    ...(target.usesRegistryEnv && registry?.env),
  };
  return {
    registry,
    repo,
    prelude: repo ? [`IMAGE_REPO="${repo}"`] : [],
    testImage: test.image,
    testSteps: test.steps.filter(Boolean),
    testCommands: commandsOf(test.steps.filter(Boolean)),
    login: (registry?.login ?? []).filter((l) => alpine || !/^apk add/.test(l)),
    build,
    push: 'docker push --all-tags "$IMAGE_REPO"',
    scan,
    lintDockerfile: 'hadolint --failure-threshold error Dockerfile',
    deploy: target.script && {
      image: target.shell.image,
      setup: target.shell.setup,
      script: target.script({ appName: p.appName, port: p.port, composeFile: p.composeFile }),
      env: deployEnv,
      pass: needNames,
    },
  };
}

/**
 * Runs a deploy target's script inside its tool image through `docker run`, for providers that cannot pick a job image
 * per step. The script goes through a quoted heredoc, so nothing in it is expanded on the agent.
 */
export function dockerRunDeploy(d) {
  const image = typeof d.image === 'string' ? d.image : d.image.name;
  const passed = [...Object.entries(d.env).map(([k, v]) => `-e "${k}=${v}"`), ...d.pass.map((n) => `-e ${n}`)];
  return [
    "cat > .dockcrate-deploy.sh <<'DOCKCRATE_DEPLOY'",
    ...d.setup,
    ...d.script,
    'DOCKCRATE_DEPLOY',
    `docker run --rm ${passed.join(' ')} -v "$PWD:/work" -w /work --entrypoint sh ${image} .dockcrate-deploy.sh`,
  ];
}
