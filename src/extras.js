// Optional repository files that go beyond the container and pipeline: dependency updates, a dev container,
// a Makefile and an .editorconfig. All of them belong to the "repo" file group and are opt-in (`opts.extras`).
import { lines } from './fsutil.js';

export const EXTRAS = ['dependabot', 'devcontainer', 'makefile', 'editorconfig'];

function dependabot(stack, info) {
  const ecosystems = [stack.ecosystem?.(info), 'docker', 'github-actions'].filter(Boolean);
  return lines(
    'version: 2',
    'updates:',
    ecosystems.map((name) => [
      `  - package-ecosystem: ${name}`,
      '    directory: "/"',
      '    schedule:',
      '      interval: weekly',
      '    groups:',
      '      minor-and-patch:',
      '        update-types: [minor, patch]',
    ]),
  );
}

const renovate = () =>
  JSON.stringify({ $schema: 'https://docs.renovatebot.com/renovate-schema.json', extends: ['config:recommended'] }, null, 2) + '\n';

function devcontainer(stack, info, { appName, port }) {
  const image = stack.devcontainer?.(info);
  if (!image) return null;
  return (
    JSON.stringify(
      {
        name: appName,
        image,
        features: { 'ghcr.io/devcontainers/features/docker-in-docker:2': {} },
        forwardPorts: [port],
      },
      null,
      2,
    ) + '\n'
  );
}

const makefile = ({ appName, port, composeFile }) =>
  lines(
    `IMAGE ?= ${appName}`,
    '',
    '.PHONY: build run up down logs lint-docker scan',
    '',
    'build:',
    '\tdocker build -t $(IMAGE) .',
    '',
    'run: build',
    `\tdocker run --rm -p ${port}:${port} $(IMAGE)`,
    '',
    'up:',
    `\tdocker compose -f ${composeFile} up --build -d`,
    '',
    'down:',
    `\tdocker compose -f ${composeFile} down`,
    '',
    'logs:',
    `\tdocker compose -f ${composeFile} logs -f`,
    '',
    'lint-docker:',
    '\tdocker run --rm -i hadolint/hadolint < Dockerfile',
    '',
    'scan: build',
    '\tdocker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image --severity HIGH,CRITICAL $(IMAGE)',
  );

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
export function extraFiles(selected, { stack, info, provider, appName, port, composeFile }) {
  const files = [];
  const notes = [];
  for (const name of selected) {
    if (name === 'dependabot') {
      if (provider === 'github') files.push({ path: '.github/dependabot.yml', content: dependabot(stack, info) });
      else {
        files.push({ path: 'renovate.json', content: renovate() });
        notes.push('Dependabot is GitHub-only, so a Renovate config was generated; install the Renovate app/bot on the repository.');
      }
    }
    if (name === 'devcontainer') {
      const content = devcontainer(stack, info, { appName, port });
      if (content) files.push({ path: '.devcontainer/devcontainer.json', content });
      else notes.push(`No dev container image is known for ${stack.id}; the dev container file was skipped.`);
    }
    if (name === 'makefile') files.push({ path: 'Makefile', content: makefile({ appName, port, composeFile }) });
    if (name === 'editorconfig') files.push({ path: '.editorconfig', content: editorconfig() });
  }
  return { files: files.map((f) => ({ kind: 'repo', ...f })), notes };
}
