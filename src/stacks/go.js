import { find, has, read, lines } from '../fsutil.js';
import { alpineRuntime } from '../container.js';

const DEFAULT_VERSION = '1.25';

/** Directory of the main package: the repo root, else the shallowest cmd/<name>. */
function mainPackage(dir) {
  const mains = find(dir, (f) => f === 'main.go', 2)
    .map((p) => p.replace(/\/?main\.go$/, '') || '.')
    .sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.split('/').length - b.split('/').length || a.localeCompare(b)));
  return { main: mains[0], others: Math.max(mains.length - 1, 0) };
}

export const go = {
  id: 'go',
  port: 8080,
  backend: true,
  tools: [],
  usesPackages: true,
  ciSteps: ['lint', 'test', 'build', 'audit'],
  ciDefaults: () => ['test', 'build'],
  ecosystem: () => 'gomod',
  codeql: 'go',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/go:1-${i.version}`,
  ignore: ['*.test', '*.out', 'vendor'],
  starter: (opts) => ({ main: '.', others: 0, detected: opts.runtime ?? DEFAULT_VERSION, version: opts.runtime ?? DEFAULT_VERSION }),
  assumes: (i) => `a go.mod at the repo root and a main package in ${i.main === '.' ? 'the repo root' : i.main}`,
  detect(dir, opts) {
    if (!has(dir, 'go.mod')) return null;
    const detected = read(dir, 'go.mod').match(/^go\s+(\d+\.\d+)/m)?.[1];
    return { ...mainPackage(dir), detected, version: opts.runtime ?? detected ?? DEFAULT_VERSION };
  },
  dockerfile: (i, port, c) =>
    lines(
      '# syntax=docker/dockerfile:1',
      `FROM golang:${i.version}-alpine AS build`,
      'WORKDIR /src',
      'COPY go.mod go.sum* ./',
      'RUN --mount=type=cache,target=/go/pkg/mod go mod download',
      'COPY . .',
      'RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \\',
      `    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ${i.main === '.' ? '.' : `./${i.main}`}`,
      '',
      alpineRuntime(c, port),
    ),
  ci(i, v = i.version, selected) {
    const on = (step) => selected.includes(step);
    return {
      image: `golang:${v}`,
      steps: [
        { uses: 'actions/setup-go@v5', with: { 'go-version': v } },
        on('lint') && { run: 'go vet ./...' },
        on('test') && { run: 'go test ./...' },
        on('build') && { run: 'go build ./...' },
        on('audit') && { run: ['go install golang.org/x/vuln/cmd/govulncheck@latest', 'govulncheck ./...'] },
      ],
    };
  },
  notes: (i, port) => [
    `The binary is built with CGO disabled and must listen on the PORT environment variable (set to ${port}) on 0.0.0.0.`,
    !i.detected && `Could not read the Go version from go.mod; assuming ${DEFAULT_VERSION}. Use --runtime to set it.`,
    !i.main && 'No main.go found in the repo root or cmd/*; the build assumes the repo root.',
    i.others > 0 && `${i.others + 1} main packages found; building ${i.main}. Edit the go build line in the Dockerfile to pick another.`,
  ],
};
