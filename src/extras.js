// Optional repository files that go beyond the container and pipeline: dependency updates, a dev container,
// a Makefile and an .editorconfig. All of them belong to the "repo" file group and are opt-in (`opts.extras`).
import { lines } from './fsutil.js';
import { isDevEnv, overrideName } from './compose.js';
import { VERSIONS } from './tools.js';

export const EXTRAS = ['dependabot', 'devcontainer', 'makefile', 'editorconfig'];

const slash = (dir) => (dir === '.' ? '/' : `/${dir}`);

function dependabot(units) {
  const seen = new Set();
  const entries = [
    ...units.flatMap((u) => [u.stack.ecosystem?.(u.info), 'docker'].filter(Boolean).map((name) => ({ name, dir: slash(u.dir) }))),
    { name: 'github-actions', dir: '/' },
  ].filter((e) => !seen.has(`${e.name} ${e.dir}`) && seen.add(`${e.name} ${e.dir}`));
  return lines(
    'version: 2',
    'updates:',
    entries.map((e) => [
      `  - package-ecosystem: ${e.name}`,
      `    directory: "${e.dir}"`,
      '    schedule:',
      '      interval: weekly',
      '    groups:',
      '      minor-and-patch:',
      '        update-types: [minor, patch]',
    ]),
  );
}

const DIND_COMMENT =
  '// docker-in-docker runs this container privileged (root on the host for anything in it). Delete the "features" entry if you do not need Docker inside the dev container.';

const renovate = () =>
  JSON.stringify({ $schema: 'https://docs.renovatebot.com/renovate-schema.json', extends: ['config:recommended'] }, null, 2) + '\n';

function devcontainer(stack, info, { appName, port }) {
  const image = stack.devcontainer?.(info);
  if (!image) return null;
  const json = JSON.stringify({ name: appName, image, features: { 'ghcr.io/devcontainers/features/docker-in-docker:2': {} }, forwardPorts: [port] }, null, 2);
  // devcontainer.json is JSONC, so the warning sits next to the line it is about.
  return json.replace('  "features"', `  ${DIND_COMMENT}\n  "features"`) + '\n';
}

const makefile = ({ appName, units, composeFile, envs }) => {
  const multi = units.length > 1;
  const image = (u) => (multi ? `$(IMAGE)-${u.name}` : '$(IMAGE)');
  const overlay = (e) => `-f ${composeFile} -f ${overrideName(composeFile, e)}`;
  const [first] = units;
  return lines(
    `IMAGE ?= ${appName}`,
    '',
    `.PHONY: build ${multi ? '' : 'run '}up down logs lint-docker scan${envs.map((e) => ` up-${e}`).join('')}`,
    '',
    'build:',
    units.map((u) => `\tdocker build -t ${image(u)} ${u.dir}`),
    !multi && ['', 'run: build', `\tdocker run --rm -p ${first.port}:${first.port} $(IMAGE)`],
    '',
    'up:',
    `\tdocker compose -f ${composeFile} up --build -d`,
    envs.map((e) => ['', `up-${e}:`, `\tdocker compose ${overlay(e)} up --build${isDevEnv(e) ? '' : ' -d'}`]),
    '',
    'down:',
    `\tdocker compose -f ${composeFile} down`,
    '',
    'logs:',
    `\tdocker compose -f ${composeFile} logs -f`,
    '',
    'lint-docker:',
    units.map((u) => `\tdocker run --rm -i ${VERSIONS.hadolintPlain} < ${u.prefix}Dockerfile`),
    '',
    'scan: build',
    units.map((u) => `\tdocker run --rm -v /var/run/docker.sock:/var/run/docker.sock ${VERSIONS.trivy} image --severity HIGH,CRITICAL ${image(u)}`),
  );
};

const editorconfig = () =>
  lines(
    'root = true',
    '',
    '[*]',
    'charset = utf-8',
    'end_of_line = lf',
    'insert_final_newline = true',
    'trim_trailing_whitespace = true',
    'indent_style = space',
    'indent_size = 2',
    '',
    '[Makefile]',
    'indent_style = tab',
    '',
    '[*.{py,java,cs,rs}]',
    'indent_size = 4',
    '',
    '[*.go]',
    'indent_style = tab',
  );

/** [{ path, content, note? }] for the selected extras; `provider` decides between Dependabot and Renovate. */
export function extraFiles(selected, { units, provider, appName, composeFile, envs = [] }) {
  const files = [];
  const notes = [];
  for (const name of selected) {
    if (name === 'dependabot') {
      if (provider === 'github') files.push({ path: '.github/dependabot.yml', content: dependabot(units) });
      else {
        files.push({ path: 'renovate.json', content: renovate() });
        notes.push('Dependabot is GitHub-only, so a Renovate config was generated; install the Renovate app/bot on the repository.');
      }
    }
    if (name === 'devcontainer') {
      const [only] = units;
      const content = units.length === 1 ? devcontainer(only.stack, only.info, { appName, port: only.port }) : null;
      if (content) {
        files.push({ path: '.devcontainer/devcontainer.json', content });
        notes.push('The dev container includes docker-in-docker, which runs it privileged; delete its "features" entry if you do not need Docker inside it.');
      }
      else if (units.length > 1) notes.push('A dev container targets one stack, so none was generated for several services; use the dev environment of the compose file instead.');
      else notes.push(`No dev container image is known for ${only.stack.id}; the dev container file was skipped.`);
    }
    if (name === 'makefile') files.push({ path: 'Makefile', content: makefile({ appName, units, composeFile, envs }) });
    if (name === 'editorconfig') files.push({ path: '.editorconfig', content: editorconfig() });
  }
  return { files: files.map((f) => ({ kind: 'repo', ...f })), notes };
}
