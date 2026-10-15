import { lines } from '../fsutil.js';
import { DEFAULT_BUILD, apt, envLines, healthcheck, pkgs } from '../container.js';

const DEFAULT_VERSION = '3.4';
const mentions = (i, gem) => new RegExp(`^\\s*gem\\s+['"]${gem}['"]`, 'm').test(i.gemfile);

// Native gems and the OS libraries they need at build time and at run time.
const NATIVE = {
  pg: { build: ['libpq-dev'], run: ['libpq5'] },
  mysql2: { build: ['default-libmysqlclient-dev'], run: ['libmariadb3'] },
};
const NATIVE_ALPINE = {
  pg: { build: ['postgresql-dev'], run: ['libpq'] },
  mysql2: { build: ['mariadb-dev'], run: ['mariadb-connector-c'] },
};
const nativeLibs = (i, kind, variant = 'slim') => Object.entries(variant === 'alpine' ? NATIVE_ALPINE : NATIVE).flatMap(([gem, libs]) => (mentions(i, gem) ? libs[kind] : []));

const command = (i, port) =>
  i.rails
    ? ['bundle', 'exec', 'rails', 'server', '-b', '0.0.0.0', '-p', String(port)]
    : mentions(i, 'puma')
      ? ['bundle', 'exec', 'puma', '-b', `tcp://0.0.0.0:${port}`]
      : ['bundle', 'exec', 'rackup', '--host', '0.0.0.0', '--port', String(port)];

const testCommand = (i) => (i.rspec ? 'bundle exec rspec' : i.rails ? 'bin/rails test' : 'bundle exec rake test');
const precompiles = (i) => i.rails && !i.apiOnly && (mentions(i, 'sprockets-rails') || mentions(i, 'propshaft') || mentions(i, 'sprockets'));

export const ruby = {
  id: 'ruby',
  port: 3000,
  backend: true,
  tools: [],
  usesPackages: true,
  ciSteps: ['lint', 'test', 'audit'],
  ciDefaults: (i) => (i.starter || i.rails || i.rspec ? ['test'] : []),
  ciNotes: (i, selected) => [
    selected.includes('lint') && !i.rubocop && 'rubocop is not in your Gemfile; the CI lint step will fail until you add it.',
    selected.includes('test') && !i.rails && !i.rspec && 'Tests run with `rake test`; add a Rakefile test task or rspec.',
  ],
  ecosystem: () => 'bundler',
  codeql: 'ruby',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/ruby:1-${i.version}`,
  ignore: ['log/*', 'tmp/*', 'storage/*', 'node_modules', 'vendor/bundle', 'public/assets', 'config/master.key', '!storage/.keep', '!tmp/.keep', '!log/.keep'],
  starter: (opts) => ({
    starter: true,
    gemfile: "gem 'rails'\ngem 'puma'\n",
    hasLock: true,
    rails: true,
    apiOnly: false,
    rack: true,
    rspec: false,
    rubocop: true,
    detected: DEFAULT_VERSION,
    version: opts.runtime ?? DEFAULT_VERSION,
  }),
  assumes: () => 'a Rails (or Rack) app with a Gemfile and Gemfile.lock that you commit, and puma in the Gemfile',
  dev(i, port, c) {
    const libs = ['build-essential', 'git', 'libyaml-dev', 'pkg-config', ...nativeLibs(i, 'build'), ...nativeLibs(i, 'run'), ...c.packages];
    return {
      dockerfile: lines(
        '# syntax=docker/dockerfile:1',
        `FROM ruby:${i.version}-slim`,
        apt({ packages: libs }),
        'WORKDIR /app',
        `ENV RAILS_ENV=development RACK_ENV=development PORT=${port}`,
        envLines(c),
        `COPY Gemfile Gemfile.lock* ${i.rubyVersionFile ? '.ruby-version ' : ''}./`,
        'RUN bundle install',
        'COPY . .',
        `EXPOSE ${port}`,
        `CMD ${JSON.stringify(command(i, port))}`,
      ),
      workdir: '/app',
      mode: 'mount',
      volumes: [],
    };
  },
  dockerfile(i, port, c, b = DEFAULT_BUILD) {
    const v = b.variant ?? 'slim';
    const alpine = v === 'alpine';
    const compilers = alpine ? ['build-base', 'git', 'yaml-dev', 'pkgconf', ...nativeLibs(i, 'build', v)] : ['build-essential', 'git', 'libyaml-dev', 'pkg-config', ...nativeLibs(i, 'build', v)];
    const runLibs = [...nativeLibs(i, 'run', v), ...c.packages];
    const install = (list) =>
      alpine
        ? `RUN apk add --no-cache ${list.join(' ')}`
        : ['RUN apt-get update \\', `    && apt-get install -y --no-install-recommends ${list.join(' ')} \\`, '    && rm -rf /var/lib/apt/lists/*'];
    const user = alpine ? 'RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app' : 'RUN useradd --system --uid 10001 --create-home app';
    const probe = alpine ? 'wget' : 'tcp';
    const bundle = 'ENV BUNDLE_DEPLOYMENT=1 BUNDLE_PATH=/usr/local/bundle BUNDLE_WITHOUT="development:test"';
    const gemfiles = `COPY Gemfile Gemfile.lock* ${i.rubyVersionFile ? '.ruby-version ' : ''}./`;
    const clean = 'rm -rf ~/.bundle /usr/local/bundle/ruby/*/cache';
    const image = `FROM ruby:${i.version}-${v}`;
    const runEnv = `ENV RAILS_ENV=production RACK_ENV=production BUNDLE_DEPLOYMENT=1 BUNDLE_PATH=/usr/local/bundle ${b.mode === 'mixed' ? '' : 'BUNDLE_WITHOUT="development:test" '}PORT=${port}`;
    const tail = [`EXPOSE ${port}`, healthcheck(c, port, probe), `CMD ${JSON.stringify(command(i, port))}`];
    if (b.mode === 'production') {
      // One stage: the compilers are installed and removed in the same layer as the gems, so they never stay in the image.
      const cleanup = alpine ? 'apk del .build' : `apt-get purge -y --auto-remove ${compilers.join(' ')} && rm -rf /var/lib/apt/lists/*`;
      return lines(
        '# syntax=docker/dockerfile:1',
        image,
        runLibs.length > 0 && install(runLibs),
        runEnv,
        envLines(c),
        user,
        'WORKDIR /app',
        gemfiles,
        'RUN ' + (alpine ? `apk add --no-cache --virtual .build ${compilers.join(' ')}` : `apt-get update && apt-get install -y --no-install-recommends ${compilers.join(' ')}`) + ' \\',
        `    && bundle install && ${clean} \\`,
        `    && ${cleanup}`,
        'COPY --chown=app:app . .',
        precompiles(i) && 'RUN SECRET_KEY_BASE_DUMMY=1 bundle exec rails assets:precompile',
        'USER app',
        tail,
      );
    }
    if (b.mode === 'mixed') {
      // One image: compilers and every gem (development ones too) stay next to the app.
      return lines(
        '# syntax=docker/dockerfile:1',
        image,
        install([...compilers, ...runLibs]),
        runEnv,
        envLines(c),
        user,
        'WORKDIR /app',
        gemfiles,
        `RUN bundle install && ${clean}`,
        'COPY --chown=app:app . .',
        precompiles(i) && 'RUN SECRET_KEY_BASE_DUMMY=1 bundle exec rails assets:precompile',
        'USER app',
        tail,
      );
    }
    return lines(
      '# syntax=docker/dockerfile:1',
      `${image} AS build`,
      install(compilers),
      'WORKDIR /app',
      bundle,
      gemfiles,
      `RUN bundle install && ${clean}`,
      'COPY . .',
      precompiles(i) && 'RUN SECRET_KEY_BASE_DUMMY=1 bundle exec rails assets:precompile',
      '',
      `${image} AS runtime`,
      runLibs.length > 0 && install(runLibs),
      runEnv,
      envLines(c),
      user,
      'WORKDIR /app',
      'COPY --from=build /usr/local/bundle /usr/local/bundle',
      'COPY --from=build --chown=app:app /app ./',
      'USER app',
      tail,
    );
  },
  variants: ['alpine', 'slim'],
  defaultVariant: 'slim',
  healthKind: (b) => (b.variant === 'alpine' ? 'wget' : 'tcp'),
  buildNotes: (i, b) => [
    b.variant === 'alpine' && 'Alpine uses musl: gems with native extensions compile against it (pg and mysql2 are covered; add other libraries under OS packages) and a few gems with precompiled binaries have no musl build.',
    b.mode === 'production' && 'Production only: one stage with production gems only; the compilers are installed and removed in the same layer, so the image has none.',
    b.mode === 'mixed' && 'Build and production in one image: compilers and your development gems stay next to the app, so it is bigger than a multi-stage image.',
  ],
  ci(i, v = i.version, selected) {
    const on = (step) => selected.includes(step);
    return {
      image: `ruby:${v}`,
      steps: [
        { uses: 'ruby/setup-ruby@v1', with: { 'ruby-version': v, 'bundler-cache': 'true' } },
        { run: 'bundle install' },
        on('lint') && { run: 'bundle exec rubocop', ciStep: 'lint' },
        on('test') && { run: testCommand(i), ciStep: 'test' },
        on('audit') && { run: ['gem install bundler-audit', 'bundle-audit check --update'], ciStep: 'audit' },
      ],
    };
  },
  notes: (i, port) => [
    i.rails && 'Rails: set SECRET_KEY_BASE (or RAILS_MASTER_KEY) at runtime, run db:migrate as a release step, and make sure config.hosts and force_ssl suit your proxy.',
    i.rails && !i.apiOnly && !precompiles(i) && 'Add sprockets-rails or propshaft to the Gemfile if the app serves compiled assets; the image only runs assets:precompile for those.',
    !i.rails && !i.rack && 'No config.ru found: CMD runs rackup, which needs one.',
    `The app must listen on 0.0.0.0:${port}; native gems are limited to pg and mysql2, add other OS libraries under OS packages.`,
  ],
};
