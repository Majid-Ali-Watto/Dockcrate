import { REGISTRIES, TARGETS } from './deploy.js';
import { DBS } from './compose.js';
import { github, gitea } from './providers/github.js';
import { gitlab } from './providers/gitlab.js';
import { jenkins } from './providers/jenkins.js';
import { bitbucket } from './providers/bitbucket.js';
import { azure } from './providers/azure.js';
import { circleci } from './providers/circleci.js';

/** CI providers. Each renders the platform-neutral pipeline description from buildPipeline into named blocks. */
export const CI_FILES = { github, gitlab, gitea, jenkins, bitbucket, azure, circleci };

const SCOPES = ['actions', 'checks', 'contents', 'deployments', 'issues', 'packages', 'pull-requests', 'security-events', 'statuses'];
export const PERMISSIONS = [...SCOPES.flatMap((s) => [`${s}-read`, `${s}-write`]), 'attestations-write', 'id-token-write'];
export const TEST_OS = ['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04', 'windows-latest', 'windows-2022', 'macos-latest', 'macos-14'];
export const PLATFORMS = ['linux/amd64', 'linux/arm64', 'linux/arm/v7', 'linux/386', 'linux/ppc64le', 'linux/s390x'];
export const CONCURRENCY = ['prs', 'always', 'queue', 'off'];
export const DEPLOY_ON = ['branch', 'tag', 'manual'];
export const IMAGE_TAGS = ['branch', 'tag', 'semver', 'latest'];
export const SEVERITIES = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const REGISTRY_CHOICES = Object.keys(REGISTRIES);
export const registryInfo = () =>
  Object.entries(REGISTRIES).map(([id, r]) => ({ id, label: r.label, serverLogin: Boolean(r.github.env) }));
export const providerInfo = () =>
  Object.entries(CI_FILES).map(([id, c]) => ({ id, label: c.label, builtinRegistry: Boolean(c.builtinRegistry), features: c.features }));
export const targetIds = () => Object.keys(TARGETS);
export const targetInfo = () =>
  Object.entries(TARGETS).map(([id, t]) => ({
    id,
    label: t.label,
    oidc: Boolean(t.oidc),
    deploys: Boolean(t.script),
    files: Boolean(t.files),
    registry: t.registry ?? null,
    serverLogin: Boolean(t.usesRegistryEnv),
  }));

const GLOB = /^[\w./*-]+$/;
const WORD = /^[\w.-]+$/;
const CRON = /^[\w*/,-]+( [\w*/,-]+){4}$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME = /^[\w .-]{1,60}$/;

const list = (v, sep = /[\n,]+/) => (Array.isArray(v) ? v : String(v ?? '').split(sep)).map((s) => String(s).trim()).filter(Boolean);

function check(what, values, ok) {
  for (const v of values) if (!ok(v)) throw new Error(`invalid ${what} "${v}"`);
}
const oneOf = (what, values, allowed) => check(what, values, (v) => allowed.includes(v));

/**
 * Validates the pipeline options and returns the platform-neutral description every renderer works from, plus notes about
 * what must be created (secrets, variables) and about options the chosen provider cannot express. Nothing is switched on
 * or off behind your back: a setting that cannot work is reported, not rewritten.
 */
export function buildPipeline(opts, { appName, port, composeFile, buildArgs = [] }) {
  const providerId = opts.ci ?? 'github';
  const provider = CI_FILES[providerId];
  const targetId = opts.deploy ?? 'registry';
  const target = TARGETS[targetId];
  if (!target) throw new Error(`unknown deploy target "${targetId}"; choose from: ${targetIds().join(', ')}`);
  const notes = [];

  const deployOn = opts.deployOn ?? 'branch';
  const concurrency = opts.concurrency ?? 'prs';
  const permissions = list(opts.permissions ?? []);
  const versions = list(opts.testVersions ?? []);
  const os = list(opts.testOs ?? []);
  const platforms = list(opts.platforms ?? []);
  const environment = opts.environment ?? 'production';
  const services = list(opts.ciServices ?? []);
  const imageTags = opts.imageTags == null ? ['branch', 'tag', 'latest'] : list(opts.imageTags);
  const scanSeverity = opts.scanSeverity == null ? ['HIGH', 'CRITICAL'] : list(opts.scanSeverity);
  const runner = opts.runner ?? '';
  const timeout = opts.timeout ? Number(opts.timeout) : 0;
  const pipelineEnv = list(opts.pipelineEnv ?? [], /\n/).map((item) => {
    const at = item.indexOf('=');
    const key = (at < 0 ? item : item.slice(0, at)).trim();
    if (at < 0 || !ENV_KEY.test(key)) throw new Error(`invalid pipeline variable "${item}": use NAME=value`);
    return [key, item.slice(at + 1)];
  });

  oneOf('deploy-on', [deployOn], DEPLOY_ON);
  oneOf('concurrency', [concurrency], CONCURRENCY);
  oneOf('permission', permissions, PERMISSIONS);
  oneOf('test OS', os, TEST_OS);
  oneOf('platform', platforms, PLATFORMS);
  oneOf('CI service', services, Object.keys(DBS));
  oneOf('image tag', imageTags, IMAGE_TAGS);
  oneOf('scan severity', scanSeverity, SEVERITIES);
  if (os.some((o) => !o.startsWith('ubuntu')) && services.length) {
    throw new Error('CI service containers need Linux runners: remove the Windows/macOS test runners');
  }
  check('test version', versions, (v) => WORD.test(v));
  check('environment', [environment], (v) => WORD.test(v));
  if (runner) check('runner', [runner], (v) => WORD.test(v));
  if (timeout && !(Number.isInteger(timeout) && timeout > 0 && timeout <= 1440)) throw new Error(`invalid timeout "${opts.timeout}": minutes, 1-1440`);
  const workflowName = opts.pipelineName ?? 'CI';
  check('pipeline name', [workflowName], (v) => NAME.test(v));

  const branches = list(opts.branches ?? ['main']);
  const tags = list(opts.tags ?? ['v*']);
  const triggers = {
    branches,
    branchesIgnore: list(opts.branchesIgnore ?? []),
    tags,
    tagsIgnore: list(opts.tagsIgnore ?? []),
    prBranches: list(opts.prBranches ?? []),
    paths: list(opts.paths ?? []),
    pathsIgnore: list(opts.pathsIgnore ?? []),
    pullRequests: Boolean(opts.pullRequests ?? true),
    release: Boolean(opts.release ?? false),
    manual: Boolean(opts.manual ?? false),
    schedule: list(opts.schedule ?? [], /\n/),
  };
  for (const key of ['branches', 'branchesIgnore', 'tags', 'tagsIgnore', 'prBranches', 'paths', 'pathsIgnore']) check(key, triggers[key], (v) => GLOB.test(v));
  check('schedule (5-field cron)', triggers.schedule, (v) => CRON.test(v));
  triggers.push = triggers.branches.length > 0 || triggers.branchesIgnore.length > 0 || triggers.tags.length > 0 || triggers.tagsIgnore.length > 0;
  if (!triggers.push && !triggers.pullRequests && !triggers.release && !triggers.manual && !triggers.schedule.length) {
    throw new Error('enable at least one pipeline trigger');
  }

  // Options the provider has no way to express are dropped with a note, never silently.
  const unsupported = (key, label, isSet) => {
    if (!isSet || provider.features.includes(key)) return Boolean(isSet);
    notes.push(`${label} is not supported by ${provider.label} and was left out.`);
    return false;
  };
  const sbom = unsupported('sbom', 'SBOM and provenance attestations', opts.sbom);
  const sign = unsupported('sign', 'Image signing (cosign)', opts.sign);
  const codeScan = unsupported('codeScan', 'Code scanning', opts.codeScan);
  const hasPermissions = unsupported('permissions', 'Token permissions', permissions.length);
  unsupported('os', 'The test OS matrix', os.length);
  unsupported('platforms', 'Multi-platform builds', platforms.length > 1);
  unsupported('release', 'The release trigger', triggers.release);
  unsupported('prBranches', 'The pull-request branch filter', triggers.prBranches.length);
  unsupported('paths', 'Path filters', triggers.paths.length || triggers.pathsIgnore.length);
  unsupported('runner', 'A custom runner', runner);
  unsupported('timeout', 'Job timeouts', timeout);
  unsupported('manual', 'The manual-run trigger', triggers.manual);
  unsupported('schedule', 'Scheduled runs', triggers.schedule.length);
  unsupported('tagFilters', 'Tag filters', triggers.tagsIgnore.length);
  unsupported('branchIgnore', 'Ignored branches', triggers.branchesIgnore.length);
  unsupported('depCache', 'Dependency caching control', opts.depCache === false);
  unsupported('layerCache', 'Layer caching control', opts.layerCache === false);
  unsupported('services', 'Service containers', services.length);

  // The registry: targets with their own cloud registry keep it; the rest let you choose where the image goes.
  const registryChoice = opts.registry ?? (provider.builtinRegistry ? 'builtin' : 'dockerhub');
  oneOf('registry', [registryChoice], REGISTRY_CHOICES);
  if (registryChoice === 'builtin' && !provider.builtinRegistry) {
    throw new Error(`${provider.label} has no built-in container registry: choose dockerhub, quay, custom, gar, ecr or acr`);
  }
  const chooses = target.registry === 'builtin';
  const registryId = chooses ? registryChoice : target.registry;
  if (chooses && target.usesRegistryEnv && !REGISTRIES[registryId].github.env) {
    throw new Error(`the ${targetId} target logs in to the registry from the server with a username and token: choose builtin, dockerhub, quay or custom`);
  }
  if (!chooses && opts.registry && opts.registry !== registryId) {
    notes.push(
      registryId
        ? `This target pushes to its own registry (${REGISTRIES[registryId].label}), so the ${opts.registry} registry choice was ignored.`
        : 'This target builds the image on the platform itself, so the registry choice was ignored.',
    );
  }
  // A cloud registry picked for a generic target signs in with the matching cloud target's steps.
  const authTarget = chooses && REGISTRIES[registryId]?.authTarget ? TARGETS[REGISTRIES[registryId].authTarget] : target;

  const oidc = providerId === 'github' && Boolean(authTarget.oidc) && permissions.includes('id-token-write');
  if (providerId === 'github' && permissions.includes('id-token-write') && !authTarget.oidc) {
    notes.push('The id-token permission only matters for cloud registries and targets (Artifact Registry, ECR, ACR), where it switches login to OIDC.');
  }
  if (providerId !== 'github' && authTarget.oidc) notes.push(`${provider.label} authenticates to the cloud with stored keys; OIDC login is GitHub-only here.`);

  const deploys = Boolean(target.script);
  const hasImage = Boolean(registryId);
  const lintDockerfile = Boolean(opts.lintDockerfile);
  const testJob = opts.testJob !== false;
  if (deploys) {
    if (deployOn === 'tag' && !triggers.tags.length && !triggers.tagsIgnore.length) notes.push('Deploying on tags, but no tag trigger is enabled: the deploy job will never run until you add one.');
    if (deployOn === 'manual' && !triggers.manual && providerId === 'github') notes.push('Deploying manually, but the manual-run trigger is off: the deploy job will never run until you turn it on.');
    if (deployOn === 'branch' && !triggers.branches.length) notes.push('Deploying from the default branch, but no branch push trigger is enabled: the deploy job will not run.');
  }
  if ((sbom || sign) && !hasImage) {
    notes.push('SBOM, provenance and image signing skipped: this target builds the image on the platform itself.');
  }
  if (sign && hasImage) notes.push('Images are signed with cosign (keyless, GitHub OIDC); verify with `cosign verify --certificate-identity-regexp ... --certificate-oidc-issuer https://token.actions.githubusercontent.com <image>`.');
  if (lintDockerfile) notes.push('Hadolint fails the pipeline on errors only; warnings (e.g. unpinned apk/apt packages) are shown but allowed.');
  const scan = Boolean(opts.scan) && hasImage;
  if (opts.scan && !hasImage) notes.push('Image scan skipped: this target builds the image on the platform itself, so there is nothing to scan in CI.');
  if (buildArgs.length) {
    notes.push(`Build args ${buildArgs.join(', ')} are read from ${provider.variablesName ?? `${provider.label} variables`} of the same name.`);
  }

  // Everything the pipeline reads: the target's own variables, and the registry login when one is chosen for it.
  const ctx = { platform: providerId, oidc };
  const targetNeeds = target.needs?.(ctx) ?? { secrets: [], vars: [] };
  const registryNeeds = chooses ? (REGISTRIES[registryId].needs?.(ctx) ?? { secrets: [], vars: [] }) : { secrets: [], vars: [] };
  for (const needs of [target.needs ? targetNeeds : null, chooses && REGISTRIES[registryId].needs ? registryNeeds : null]) {
    if (!needs) continue;
    const secrets = needs.secrets.join(', ');
    const vars = needs.vars.map((v) => (v.endsWith('?') ? `${v.slice(0, -1)} (optional)` : v)).join(', ');
    const where = provider.secretsLocation;
    notes.push(`Add to ${where}: ${[secrets && `secrets ${secrets}`, vars && `variables ${vars}`].filter(Boolean).join('; ')}.`);
  }
  notes.push(...(target.notes?.() ?? []), ...(provider.notes?.({ triggers }) ?? []));

  return {
    provider: providerId,
    providerLabel: provider.label,
    workflowName,
    triggers,
    concurrency,
    permissions: hasPermissions ? permissions : [],
    versions,
    os: provider.features.includes('os') ? os : [],
    platforms: provider.features.includes('platforms') ? platforms : platforms.slice(0, 1),
    runner: provider.features.includes('runner') ? runner : '',
    timeout: provider.features.includes('timeout') ? timeout : 0,
    failFast: Boolean(opts.failFast ?? false),
    pipelineEnv,
    imageTags,
    pinActions: provider.features.includes('pinActions') && opts.pinActions !== false, // GitHub only; Gitea runners may not resolve SHAs
    depCache: opts.depCache !== false,
    layerCache: opts.layerCache !== false,
    scanSeverity,
    testJob,
    targetId,
    target,
    registryId,
    authTarget,
    targetNeeds,
    registryNeeds,
    lintDockerfile,
    sbom: sbom && hasImage,
    sign: sign && hasImage,
    codeScan,
    deployOn,
    environment,
    oidc,
    services: provider.features.includes('services') ? services : [],
    scan,
    buildArgs,
    appName,
    port,
    composeFile,
    notes,
  };
}
