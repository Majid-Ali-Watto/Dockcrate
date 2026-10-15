import { has, read, lines } from '../fsutil.js';
import { alpineRuntime } from '../container.js';

const manifestField = (toml, field) => toml.match(new RegExp(`^\\s*${field}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];

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
  ignore: ['target'],
  starter: (opts) => ({ name: opts.name ?? 'app', locked: true, bin: true, detected: opts.runtime ?? '1', version: opts.runtime ?? '1' }),
  assumes: (i) => `a Cargo.lock that you commit, and a binary crate named ${i.name}`,
  detect(dir, opts) {
    if (!has(dir, 'Cargo.toml')) return null;
    const toml = read(dir, 'Cargo.toml');
    const pkg = toml.match(/^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
    if (!pkg) throw new Error('Cargo.toml has no [package] table (a workspace root?); run dockcrate in the crate folder you want to ship');
    const detected = manifestField(pkg, 'rust-version');
    return {
      name: manifestField(pkg, 'name'),
      locked: has(dir, 'Cargo.lock'),
      bin: has(dir, 'src/main.rs') || /^\[\[bin\]\]/m.test(toml),
      detected,
      version: opts.runtime ?? detected ?? '1',
    };
  },
  dockerfile: (i, port, c) =>
    lines(
      '# syntax=docker/dockerfile:1',
      `FROM rust:${i.version}-alpine AS build`,
      'RUN apk add --no-cache musl-dev',
      'WORKDIR /src',
      'COPY . .',
      'RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/src/target \\',
      `    cargo build --release${i.locked ? ' --locked' : ''} && \\`,
      `    mkdir -p /out && cp target/release/${i.name} /out/app`,
      '',
      alpineRuntime(c, port),
    ),
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
        on('lint') && { run: 'rustup component add clippy' },
        on('lint') && { run: 'cargo clippy --all-targets -- -D warnings' },
        on('test') && { run: 'cargo test' },
        on('build') && { run: 'cargo build --release' },
        on('audit') && { run: ['cargo install cargo-audit --locked', 'cargo audit'] },
      ],
    };
  },
  notes: (i, port) => [
    `The binary must listen on the PORT environment variable (set to ${port}) on 0.0.0.0.`,
    !i.locked && 'No Cargo.lock found: the build is not locked. Commit Cargo.lock for reproducible images.',
    !i.bin && 'No src/main.rs or [[bin]] target found: this looks like a library crate, so the Docker build will fail.',
    !i.detected && 'No rust-version in Cargo.toml: the image uses the latest stable Rust. Use --runtime to pin one.',
  ],
};
