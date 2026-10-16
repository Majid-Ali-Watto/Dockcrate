import { lines } from '../fsutil.js';
import { DEFAULT_BUILD, DEV_ROOT, apk, binaryRuntime, envLines, healthcheck, pkgs, runAsOf, systemUser, userLine } from '../container.js';
import { VERSIONS } from '../tools.js';

const DEFAULT_VERSION = '1.25';

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
  // No bind mount: compose watch syncs the source and restarts `go run`, which rebuilds.
  dev: (i, port, c) => ({
    dockerfile: lines(
      '# syntax=docker/dockerfile:1',
      DEV_ROOT,
      `FROM golang:${i.version}-alpine`,
      'WORKDIR /src',
      apk(c),
      'COPY go.mod go.sum* ./',
      'RUN go mod download',
      'COPY . .',
      `ENV PORT=${port}`,
      envLines(c),
      `EXPOSE ${port}`,
      `CMD ${JSON.stringify(['go', 'run', i.main === '.' ? '.' : `./${i.main}`])}`,
    ),
    workdir: '/src',
    mode: 'watch',
    volumes: [],
  }),
  dockerfile(i, port, c, b = DEFAULT_BUILD) {
    const v = b.variant ?? 'alpine';
    const target = i.main === '.' ? '.' : `./${i.main}`;
    const probe = v === 'alpine' ? 'wget' : 'tcp';
    if (b.mode === 'production') return lines('# syntax=docker/dockerfile:1', binaryRuntime(c, port, v, 'COPY app /usr/local/bin/app'));
    if (b.mode === 'mixed') {
      // One image: the Go toolchain builds the binary and the same image runs it.
      return lines(
        '# syntax=docker/dockerfile:1',
        v === 'alpine' ? `FROM golang:${i.version}-alpine` : `FROM golang:${i.version}-bookworm`,
        'WORKDIR /src',
        pkgs(c, v),
        'COPY go.mod go.sum* ./',
        'RUN go mod download',
        'COPY . .',
        `RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/app ${target}`,
        systemUser(v),
        userLine(),
        `ENV PORT=${port}`,
        envLines(c),
        `EXPOSE ${port}`,
        healthcheck(c, port, probe),
        'ENTRYPOINT ["/usr/local/bin/app"]',
      );
    }
    return lines(
      '# syntax=docker/dockerfile:1',
      v === 'alpine' ? `FROM golang:${i.version}-alpine AS build` : `FROM golang:${i.version}-bookworm AS build`,
      'WORKDIR /src',
      'COPY go.mod go.sum* ./',
      'RUN --mount=type=cache,target=/go/pkg/mod go mod download',
      'COPY . .',
      'RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \\',
      `    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ${target}`,
      '',
      binaryRuntime(c, port, v, 'COPY --from=build /out/app /usr/local/bin/app'),
    );
  },
  variants: ['alpine', 'slim'],
  defaultVariant: 'alpine',
  healthKind: (b) => (b.variant === 'alpine' ? 'wget' : 'tcp'),
  runAs: () => runAsOf(10001),
  buildNotes: (i, b) => [
    b.mode === 'production' && `Production only: the image copies a binary called app from the project root, so build it first: CGO_ENABLED=0 go build -o app ${i.main === '.' ? '.' : `./${i.main}`} (the generated pipeline builds the image from the repository as it is).`,
    b.mode === 'mixed' && 'Build and production in one image: it keeps the Go toolchain and the sources next to the binary, so it is much bigger than a multi-stage image.',
  ],
  ci(i, v = i.version, selected) {
    const on = (step) => selected.includes(step);
    return {
      image: `golang:${v}`,
      steps: [
        { uses: 'actions/setup-go@v5', with: { 'go-version': v } },
        on('lint') && { run: 'go vet ./...', ciStep: 'lint' },
        on('test') && { run: 'go test ./...', ciStep: 'test' },
        on('build') && { run: 'go build ./...', ciStep: 'build' },
        on('audit') && { run: [`go install ${VERSIONS.govulncheck}`, 'govulncheck ./...'], ciStep: 'audit' },
      ],
    };
  },
  notes: (i, port) => [
    `The binary is built with CGO disabled and must listen on the PORT environment variable (set to ${port}) on 0.0.0.0.`,
  ],
};
