import { lines } from '../fsutil.js';
import { DEFAULT_BUILD, DEV_ROOT, apk, binaryRuntime, envLines, healthcheck, runAsOf, systemUser, userLine } from '../container.js';

export const rust = {
  id: 'rust',
  port: 8080,
  backend: true,
  tools: [],
  usesName: true,
  usesPackages: true,
  ciSteps: ['lint', 'test', 'build', 'audit'],
  ciDefaults: () => ['test', 'build'],
  ecosystem: () => 'cargo',
  codeql: 'rust',
  devcontainer: () => 'mcr.microsoft.com/devcontainers/rust:1',
  ignore: (b, i) => (b.mode === 'production' ? ['target/*', `!target/release/${i.name}`, `!target/x86_64-unknown-linux-musl/release/${i.name}`] : ['target']),
  starter: (opts) => ({ name: opts.name ?? 'app', locked: true, bin: true, detected: opts.runtime ?? '1', version: opts.runtime ?? '1' }),
  assumes: (i) => `a Cargo.lock that you commit, and a binary crate named ${i.name}`,
  dev: (i, port, c) => ({
    dockerfile: lines(
      '# syntax=docker/dockerfile:1',
      DEV_ROOT,
      `FROM rust:${i.version}-alpine`,
      'RUN apk add --no-cache musl-dev',
      apk(c),
      'WORKDIR /src',
      `ENV PORT=${port}`,
      envLines(c),
      'COPY . .',
      `EXPOSE ${port}`,
      `CMD ${JSON.stringify(['cargo', 'run'])}`,
    ),
    workdir: '/src',
    mode: 'watch',
    volumes: [],
  }),
  dockerfile(i, port, c, b = DEFAULT_BUILD) {
    const v = b.variant ?? 'alpine';
    const alpine = v === 'alpine';
    const MUSL = 'x86_64-unknown-linux-musl';
    if (b.mode === 'production') {
      // A binary built outside: musl for alpine, the host's glibc for slim.
      return lines('# syntax=docker/dockerfile:1', binaryRuntime(c, port, v, `COPY ${alpine ? `target/${MUSL}` : 'target'}/release/${i.name} /usr/local/bin/app`));
    }
    if (b.mode === 'mixed') {
      // One image: cargo builds the binary and the same image runs it.
      return lines(
        '# syntax=docker/dockerfile:1',
        `FROM rust:${i.version}-${v}`,
        alpine && 'RUN apk add --no-cache musl-dev',
        alpine ? apk(c) : (c.packages.length > 0 && `RUN apt-get update && apt-get install -y --no-install-recommends ${c.packages.join(' ')} && rm -rf /var/lib/apt/lists/*`),
        'WORKDIR /src',
        'COPY . .',
        'RUN --mount=type=cache,target=/usr/local/cargo/registry \\',
        `    cargo build --release${i.locked ? ' --locked' : ''} && cp target/release/${i.name} /usr/local/bin/app`,
        systemUser(v),
        userLine(),
        `ENV PORT=${port}`,
        envLines(c),
        `EXPOSE ${port}`,
        healthcheck(c, port, alpine ? 'wget' : 'tcp'),
        'ENTRYPOINT ["/usr/local/bin/app"]',
      );
    }
    return lines(
      '# syntax=docker/dockerfile:1',
      `FROM rust:${i.version}-${v} AS build`,
      alpine && 'RUN apk add --no-cache musl-dev',
      'WORKDIR /src',
      'COPY . .',
      'RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/target \\',
      `    cargo build --release${i.locked ? ' --locked' : ''} && \\`,
      `    mkdir -p /out && cp target/release/${i.name} /out/app`,
      '',
      binaryRuntime(c, port, v, 'COPY --from=build /out/app /usr/local/bin/app'),
    );
  },
  variants: ['alpine', 'slim'],
  defaultVariant: 'alpine',
  healthKind: (b) => (b.variant === 'alpine' ? 'wget' : 'tcp'),
  runAs: () => runAsOf(10001),
  buildNotes: (i, b) => [
    b.mode === 'production' &&
      `Production only: the image copies the binary you built (${b.variant === 'alpine' ? `target/x86_64-unknown-linux-musl/release/${i.name}: cargo build --release --target x86_64-unknown-linux-musl, with the musl target installed; use the aarch64 triple on ARM` : `target/release/${i.name}: cargo build --release, on a Debian-compatible host`}); the generated pipeline builds the image from the repository as it is.`,
    b.mode === 'mixed' && 'Build and production in one image: it keeps the Rust toolchain and the sources next to the binary, so it is much bigger than a multi-stage image.',
    b.variant === 'slim' && b.mode !== 'production' && 'The slim image links against glibc (Debian), not musl.',
  ],
  ci(i, v = i.version, selected) {
    const on = (step) => selected.includes(step);
    return {
      image: `rust:${v}`,
      steps: [
        {
          uses: 'dtolnay/rust-toolchain@stable',
          with: { toolchain: v === '1' ? 'stable' : v },
        },
        { uses: 'Swatinem/rust-cache@v2' },
        on('lint') && { run: 'rustup component add clippy', ciStep: 'lint' },
        on('lint') && { run: 'cargo clippy --all-targets -- -D warnings', ciStep: 'lint' },
        on('test') && { run: 'cargo test', ciStep: 'test' },
        on('build') && { run: 'cargo build --release', ciStep: 'build' },
        on('audit') && { run: ['cargo install cargo-audit --locked', 'cargo audit'], ciStep: 'audit' },
      ],
    };
  },
  notes: (i, port) => [
    `The binary must listen on the PORT environment variable (set to ${port}) on 0.0.0.0.`,
  ],
};
