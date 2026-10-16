// Helpers shared by every CI renderer (a renderer turns the pipeline description from buildPipeline into blocks).
import { DBS, forCi, urlKey } from '../compose.js';
import { REGISTRIES } from '../deploy.js';
import { VERSIONS } from '../tools.js';

export { block } from '../blocks.js';

/** Conditional part of a document: `0` and `''` (from `list.length &&`, `text &&`) must not end up as lines. */
export const when = (cond, ...parts) => (cond ? parts : null);
/** GitHub Actions expression, kept out of template literals so `${{` stays readable. */
export const x = (expr) => '${{ ' + expr + ' }}';
export const q = (v) => JSON.stringify(String(v));
/** A POSIX single-quoted shell word: nothing inside expands ($VAR, $(...), backticks), and a ' is written as '\''. */
export const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
/** `export NAME='value'` for a user-given pipeline variable, so its value reaches the job literally. */
export const exportLine = ([k, v]) => `export ${k}=${shq(v)}`;

/** The CI steps of the test job. A manual run offers each one a checkbox, and a step that is not ticked is skipped. */
export const CI_STEPS = { lint: 'Lint', test: 'Tests', build: 'Build', audit: 'Dependency audit' };
export const manualLabel = (step) => `Run ${CI_STEPS[step].toLowerCase()}`;
/** The environment variable that carries a step's checkbox where a manual run's inputs are variables (GitLab, Jenkins, Bitbucket). */
export const switchVar = (step) => `RUN_${step.toUpperCase()}`;
/** Shell test that the checkbox of a step is on; a run that was not asked (no manual run) has no variable, which means on. */
export const switchOn = (step) => `[ "\${${switchVar(step)}:-true}" = true ]`;
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

/** A compose value as a CI job uses it: required passwords become the throwaway CI password (see CI_PASSWORD). */
export const plain = forCi;
/** The health command of a CI service container (no compose `$$` escapes, no password where CI has none). */
export const healthCmd = (name) => (name === 'mongo' ? 'mongosh --quiet --eval 1' : DBS[name].ciHealth ?? DBS[name].healthcheck.slice(1).join(' '));

/** [ENV_NAME, url] that points the tests at the service (`host` is localhost on GitHub, the alias elsewhere); `all` is every service of the job. */
export function serviceUrl(name, host, all) {
  const url = DBS[name].ciUrl ?? DBS[name].url[1];
  const key = urlKey(name, all);
  // URLs with a scheme carry the host after `@` or `//`; memcached's is a bare host:port.
  const hostAt = plain(url).includes('://') ? `(@|//)${name}:` : `^()${name}:`;
  return [key, plain(url).replace(new RegExp(hostAt), `$1${host}:`)];
}

export const serviceEnv = (name) => Object.fromEntries(Object.entries(DBS[name].ciEnv ?? DBS[name].env ?? {}).map(([k, v]) => [k, plain(v)]));

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

// ------------------------------------------------------------------------------------ deployment rules

/** `release/*` -> { prefix: true, value: 'release/' }; `develop` -> { prefix: false, value: 'develop' }. */
export const matchOf = (match) => ({ prefix: match.endsWith('*'), value: match.replace(/\*$/, '') });
/** A branch or tag match as a regular expression body (no delimiters). */
export const matchRegex = (match) => {
  const { prefix, value } = matchOf(match);
  return `^${value.replace(/[.+^${}()|[\]\\/]/g, '\\$&')}${prefix ? '.*' : '$'}`;
};
/** The classic deployment: one environment, no branch or tag of its own. */
export const isClassicDeploy = (p) => p.deployments.length === 1 && !p.deployments[0].match;

// ------------------------------------------------------------------------ building only what changed

/** A path glob as an extended regular expression (`**` crosses folders, `*` does not). */
const ere = (glob) => glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*');

/**
 * Shell that sets CHANGED to `,all,` or `,api,web,` (the services whose folder changed since `$BASE`), for providers that
 * decide in a job of their own. `setup` is the provider's shell that sets BASE (the commit to compare with) and ALL=1 for runs
 * that always do everything (tags, schedules, manual). A run that cannot tell (no BASE, or a commit this clone lacks) does everything.
 */
export function changedLines(p, { ciPath, setup }) {
  const dirs = p.apps.filter((a) => a.dir !== '.').map((a) => ere(a.dir));
  const hit = (app) =>
    app.dir === '.'
      ? `printf '%s\\n' "$FILES" | grep -v -E '^(${dirs.join('|')})/' | grep -q .`
      : `printf '%s\\n' "$FILES" | grep -q -E '^${ere(app.dir)}/'`;
  const shared = [ciPath, ...p.sharedPaths].map((g) => `^${ere(g)}$`).join('|');
  return [
    'ALL=0',
    'BASE=""',
    ...setup,
    'CHANGED=",all,"',
    'if [ "$ALL" = 0 ] && [ -n "$BASE" ] && git cat-file -e "$BASE^{commit}" 2>/dev/null; then',
    '  FILES=$(git diff --name-only "$BASE" HEAD)',
    '  CHANGED=","',
    ...p.apps.map((a) => `  if ${hit(a)}; then CHANGED="\${CHANGED}${a.id},"; fi`),
    `  if printf '%s\\n' "$FILES" | grep -q -E '${shared}'; then CHANGED=",all,"; fi`,
    'fi',
  ];
}

/** First lines of a service's job: stop quietly when its folder did not change. Needs CHANGED in the environment. */
export const changedGuard = (app) => `case "$CHANGED" in *,all,*|*,${app.id},*) ;; *) echo "${app.id} is unchanged: nothing to do"; exit 0;; esac`;

// ---------------------------------------------------------------------------------------- several services

/** More than one service: names, image repositories and job ids are per service. */
export const isMulti = (p) => p.apps.length > 1;

/**
 * The image repository of one app. Registries that name a repository per app (`{app}`) get <project>-<service>; the others
 * (GHCR, GitLab, ECR) get /<service> appended. A single app keeps the classic name. `app.id` may be a CI expression.
 */
export function imageRepo(template, p, app) {
  if (!isMulti(p)) return template.replace('{app}', p.appName);
  return template.includes('{app}') ? template.replace('{app}', `${p.appName}-${app.id}`) : `${template}/${app.id}`;
}

/** Job or step id for an app: the plain name for one service, `name-service` for several. */
export const jobId = (p, app, base, sep = '-') => (isMulti(p) ? `${base}${sep}${app.id.replaceAll('-', sep)}` : base);

/** Folder prefix of a path inside an app: `api/Dockerfile`, or just `Dockerfile` at the root. */
export const inApp = (app, file) => (app.dir === '.' ? file : `${app.dir}/${file}`);

export const hadolintCommand = (app) => `hadolint --failure-threshold error ${inApp(app, 'Dockerfile')}`;

const LOCK = { npm: 'package-lock.json', yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml' };

/**
 * Makes setup steps work for an app that lives in `dir` (a path or a CI expression such as a matrix value): commands run
 * there and the setup actions look for their lockfile there. Steps are `{ run, uses, with, ... }`; `run` steps get a `dir`
 * field that each renderer turns into its own "working directory".
 */
export function stepsInDir(steps, dir) {
  if (dir === '.') return steps;
  const at = (file) => `${dir}/${file}`;
  return steps.filter(Boolean).map((step) => {
    if (step.run) return { ...step, dir };
    const w = step.with ?? {};
    switch (step.uses?.replace(/@.*$/, '')) {
      case 'actions/setup-node': return w.cache ? { ...step, with: { ...w, 'cache-dependency-path': at(LOCK[w.cache]) } } : step;
      case 'actions/setup-python': return w.cache ? { ...step, with: { ...w, 'cache-dependency-path': at('requirements.txt') } } : step;
      case 'actions/setup-go': return { ...step, with: { ...w, 'cache-dependency-path': at('go.sum') } };
      case 'ruby/setup-ruby': return { ...step, with: { ...w, 'working-directory': dir } };
      case 'Swatinem/rust-cache': return { ...step, with: { ...w, workspaces: dir } };
      default: return step;
    }
  });
}

/**
 * The switches of a manual run that keep a step: one per CI step it belongs to (`ciStep`), and it runs when any is on. Null
 * when a manual run cannot switch it off. `on(name)` is the provider's own test for one switch.
 */
export function manualGate(p, step, on) {
  const names = [].concat(step.ciStep ?? []).filter((n) => p.manualSteps.includes(n));
  return names.length ? names.map(on) : null;
}

/**
 * Test commands of an app as plain shell: each one runs in its own subshell inside the app's folder, and one a manual run can
 * switch off (`stepOn(name)` is the shell test for a switch) is wrapped in an `if`. `titles` are the commands without that.
 */
function appCommands(p, app, steps, stepOn) {
  const commands = steps.filter((s) => s?.run).flatMap((step) => {
    const gate = stepOn && manualGate(p, step, stepOn);
    return [].concat(step.run).map((c) => {
      const title = app.dir === '.' ? c : `(cd ${app.dir} && ${c})`;
      return { title, command: gate ? `if ${gate.join(' || ')}; then ${title}; fi` : title };
    });
  });
  return { commands: commands.map((c) => c.command), titles: commands.map((c) => c.title) };
}

/**
 * What every provider that runs shell commands (GitLab, Jenkins, Bitbucket, Azure, CircleCI) needs for ONE app, so each
 * renderer only maps it onto its own syntax. `vars` names the provider's environment variables:
 *   { sha, refSlug, tag, version, defaultBranchTest, pre?, stepOn? }   e.g. sha: 'CI_COMMIT_SHA', version: '$VERSION'
 * `stepOn(step)` is the shell test that a manual run left a CI step on (a provider without manual inputs leaves it out).
 * `pre` is shell that defines `refSlug` when the provider has no ready-made one. `alpine` says whether `apk` exists
 * where the registry login runs (without it the login relies on the CLI already being on the agent). `version` picks
 * one runtime version for a renderer that unrolls the test matrix itself; by default the provider's own variable is used.
 */
export function shellPlan(p, app, vars, { alpine = true, ...pick } = {}) {
  const registry = p.registryId ? REGISTRIES[p.registryId].shell : null;
  const repo = registry ? imageRepo(registry.image, p, app) : null;
  const version = 'version' in pick ? pick.version : app.versions.length ? vars.version : undefined;
  const test = app.ci(version);
  const testSteps = test.steps.filter(Boolean);
  const { commands, titles } = appCommands(p, app, testSteps, vars.stepOn);
  const sha = `$${vars.sha}`;
  const buildArgs = app.buildArgs.map((n) => `--build-arg ${n}="$${n}" `).join('');
  const refTag = p.imageTags.includes('branch') || p.imageTags.includes('tag') ? ` -t "$IMAGE_REPO:$${vars.refSlug}"` : '';
  const build = registry && [
    ...(vars.pre ?? []),
    `docker build ${buildArgs}-t "$IMAGE_REPO:${sha}"${refTag} ${app.dir}`,
    p.imageTags.includes('latest') && `if ${vars.defaultBranchTest}; then docker tag "$IMAGE_REPO:${sha}" "$IMAGE_REPO:latest"; fi`,
    p.imageTags.includes('semver') && `if [ -n "$${vars.tag}" ]; then docker tag "$IMAGE_REPO:${sha}" "$IMAGE_REPO:\${${vars.tag}#v}"; fi`,
  ].filter(Boolean);
  const scan = `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock ${VERSIONS.trivy} image --exit-code 1 --severity ${p.scanSeverity.join(',')} --ignore-unfixed "$IMAGE_REPO:${sha}"`;

  return {
    registry,
    repo,
    prelude: repo ? [`IMAGE_REPO="${repo}"`] : [],
    testImage: test.image,
    testSteps,
    testCommands: commands,
    testTitles: titles,
    login: (registry?.login ?? []).filter((l) => alpine || !/^apk add/.test(l)),
    build,
    push: 'docker push --all-tags "$IMAGE_REPO"',
    scan,
    lintDockerfile: hadolintCommand(app),
  };
}

/** The deploy step of a script based provider: the image, the setup, the script and the environment it reads. */
export function deployPlan(p, deployment, vars, { alpine = true, changed = '$CHANGED' } = {}) {
  const target = p.target;
  if (!target.script) return null;
  const registry = p.registryId ? REGISTRIES[p.registryId].shell : null;
  const sha = `$${vars.sha}`;
  const multi = isMulti(p);
  const needNames = [...(p.targetNeeds.secrets ?? []), ...(p.targetNeeds.vars ?? [])].map((n) => n.replace(/\?$/, ''));
  // One app deploys $IMAGE_REPO:sha; several name the whole repository, so no per-app variable has to exist on the deploy runner.
  const images = registry ? Object.fromEntries(p.apps.map((a) => [a.imageEnv, `${multi ? imageRepo(registry.image, p, a) : '$IMAGE_REPO'}:${sha}`])) : {};
  return {
    image: target.shell.image,
    setup: target.shell.setup,
    script: target.script({ appName: p.appName, port: p.apps[0].port, composeFile: p.composeFile, composeFiles: deployment.composeFiles, apps: p.apps, ...(p.changedOnly && { changedOnly: true }) }),
    env: { APP: p.appName, ...(!multi && { PORT: p.apps[0].port }), ...images, ...(target.usesRegistryEnv && registry?.env), ...(p.changedOnly && { DEPLOY_SERVICES: changed }) },
    pass: needNames,
    prelude: registry && !multi ? [`IMAGE_REPO="${imageRepo(registry.image, p, p.apps[0])}"`] : [],
    alpine,
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
