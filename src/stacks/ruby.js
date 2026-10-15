import { has, read, lines } from '../fsutil.js';
import { apt, envLines, healthcheck } from '../container.js';

const DEFAULT_VERSION = '3.4';
const mentions = (i, gem) => new RegExp(`^\\s*gem\\s+['"]${gem}['"]`, 'm').test(i.gemfile);

// Native gems and the OS libraries they need at build time and at run time.
const NATIVE = {
  pg: { build: ['libpq-dev'], run: ['libpq5'] },
  mysql2: { build: ['default-libmysqlclient-dev'], run: ['libmariadb3'] },
};
const nativeLibs = (i, kind) => Object.entries(NATIVE).flatMap(([gem, libs]) => (mentions(i, gem) ? libs[kind] : []));

function inspect(dir, opts) {
  if (!has(dir, 'Gemfile')) return null;
  const gemfile = read(dir, 'Gemfile');
  const detected =
    read(dir, '.ruby-version').match(/(\d+\.\d+)/)?.[1] ?? gemfile.match(/^\s*ruby\s+['"](\d+\.\d+)/m)?.[1];
  const i = { gemfile, hasLock: has(dir, 'Gemfile.lock'), rubyVersionFile: has(dir, '.ruby-version'), detected, version: opts.runtime ?? detected ?? DEFAULT_VERSION };
  i.rails = mentions(i, 'rails');
  i.apiOnly = /config\.api_only\s*=\s*true/.test(read(dir, 'config/application.rb'));
  i.rack = has(dir, 'config.ru');
  i.rspec = mentions(i, 'rspec-rails') || mentions(i, 'rspec');
  i.rubocop = mentions(i, 'rubocop') || mentions(i, 'rubocop-rails-omakase');
  return i;
}

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
  detect: (dir, opts) => inspect(dir, opts),
  dockerfile(i, port, c) {
    const buildLibs = nativeLibs(i, 'build');
    const runLibs = [...nativeLibs(i, 'run'), ...c.packages];
    return lines(
      '# syntax=docker/dockerfile:1',
      `FROM ruby:${i.version}-slim AS build`,
      'RUN apt-get update \\',
      `    && apt-get install -y --no-install-recommends ${['build-essential', 'git', 'libyaml-dev', 'pkg-config', ...buildLibs].join(' ')} \\`,
      '    && rm -rf /var/lib/apt/lists/*',
      'WORKDIR /app',
      'ENV BUNDLE_DEPLOYMENT=1 BUNDLE_PATH=/usr/local/bundle BUNDLE_WITHOUT="development:test"',
      `COPY Gemfile Gemfile.lock* ${i.rubyVersionFile ? '.ruby-version ' : ''}./`,
      'RUN bundle install && rm -rf ~/.bundle /usr/local/bundle/ruby/*/cache',
      'COPY . .',
      precompiles(i) && 'RUN SECRET_KEY_BASE_DUMMY=1 bundle exec rails assets:precompile',
      '',
      `FROM ruby:${i.version}-slim AS runtime`,
      runLibs.length > 0 && apt({ packages: runLibs }),
      `ENV RAILS_ENV=production RACK_ENV=production BUNDLE_DEPLOYMENT=1 BUNDLE_PATH=/usr/local/bundle BUNDLE_WITHOUT="development:test" PORT=${port}`,
      envLines(c),
      'RUN useradd --system --uid 10001 --create-home app',
      'WORKDIR /app',
      'COPY --from=build /usr/local/bundle /usr/local/bundle',
      'COPY --from=build --chown=app:app /app ./',
      'USER app',
      `EXPOSE ${port}`,
      healthcheck(c, port, 'tcp'),
      `CMD ${JSON.stringify(command(i, port))}`,
    );
  },
  ci(i, v = i.version, selected) {
    const on = (step) => selected.includes(step);
    return {
      image: `ruby:${v}`,
      steps: [
        { uses: 'ruby/setup-ruby@v1', with: { 'ruby-version': v, 'bundler-cache': 'true' } },
        { run: 'bundle install' },
        on('lint') && { run: 'bundle exec rubocop' },
        on('test') && { run: testCommand(i) },
        on('audit') && { run: ['gem install bundler-audit', 'bundle-audit check --update'] },
      ],
    };
  },
  notes: (i, port) => [
    !i.hasLock && 'No Gemfile.lock found: the image installs whatever versions resolve today (BUNDLE_DEPLOYMENT needs a lockfile, so the build will fail). Commit Gemfile.lock.',
    !i.detected && `No Ruby version in .ruby-version or the Gemfile; assuming ${DEFAULT_VERSION}. Use --runtime to set it.`,
    i.rails && 'Rails: set SECRET_KEY_BASE (or RAILS_MASTER_KEY) at runtime, run db:migrate as a release step, and make sure config.hosts and force_ssl suit your proxy.',
    i.rails && !i.apiOnly && !precompiles(i) && 'Add sprockets-rails or propshaft to the Gemfile if the app serves compiled assets; the image only runs assets:precompile for those.',
    !i.rails && !i.rack && 'No config.ru found: CMD runs rackup, which needs one.',
    `The app must listen on 0.0.0.0:${port}; native gems are limited to pg and mysql2, add other OS libraries under OS packages.`,
  ],
};
