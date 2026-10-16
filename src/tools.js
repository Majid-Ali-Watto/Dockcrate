// Versions of the third-party tool images and binaries the generated files run, in one place so they are easy to bump.
// Every one is an explicit release, never `latest` or a branch (test/generate.test.js fails on movable references); check a new
// version against current advisories before bumping it (see CLAUDE.md), and keep Trivy outside the March 2026 compromise.
// Base images of the generated Dockerfiles (node, python, ...) are not here: they keep major tags that Dependabot bumps.

export const VERSIONS = {
  /** Small shell image for deploy and helper jobs; its packages (openssh-client, kubectl, git) come from this release branch. */
  alpine: 'alpine:3.24',
  /** Hadolint with a shell (CI jobs run `hadolint ...` as a command) and the plain one (reads the Dockerfile on stdin). */
  hadolint: 'hadolint/hadolint:v2.15.1-debian',
  hadolintPlain: 'hadolint/hadolint:v2.15.1',
  trivy: 'aquasec/trivy:0.69.3',
  awsCli: 'amazon/aws-cli:2.38.1',
  azureCli: 'mcr.microsoft.com/azure-cli:2.91.0',
  cloudSdk: 'google/cloud-sdk:589.0.0-slim',
  flyctl: 'flyio/flyctl:v0.4.118',
  /** The flyctl the GitHub setup action installs (it would install the newest one otherwise). */
  flyctlVersion: '0.4.118',
  /** CircleCI's convenience image for the change-detection job. */
  circleciBase: 'cimg/base:2026.10',
  /** CircleCI's VM image for the jobs that run Docker (listed at circleci.com/developer/machine/image/ubuntu-2204). */
  circleciMachine: 'ubuntu-2204:2026.05.1',
  uv: 'ghcr.io/astral-sh/uv:0.13.1',
  phpExtensionInstaller: 'ghcr.io/mlocati/php-extension-installer:2.12.1',
  govulncheck: 'golang.org/x/vuln/cmd/govulncheck@v1.9.0',
};
