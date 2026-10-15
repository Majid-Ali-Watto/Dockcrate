import { has, readJson, lines } from '../fsutil.js';
import { apt, envLines, healthcheck } from '../container.js';

const DEFAULT_VERSION = '8.4';
const COMPOSER = 'command -v composer >/dev/null || (apt-get update -qq && apt-get install -y -qq git unzip && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer)';

const requires = (pkg) => ({ ...pkg.require, ...pkg['require-dev'] });

/** PHP extensions named in composer.json ("ext-intl" -> intl); opcache is always added. */
const extensions = (req) => ['opcache', ...Object.keys(req).flatMap((k) => (k.startsWith('ext-') ? [k.slice(4)] : []))].filter((e, i, a) => a.indexOf(e) === i);

function inspect(dir, opts) {
  const pkg = readJson(dir, 'composer.json');
  if (!pkg) return null;
  const req = requires(pkg);
  const detected = req.php?.match(/\d+\.\d+/)?.[0];
  return {
    pkg,
    req,
    framework: 'laravel/framework' in req ? 'laravel' : Object.keys(req).some((k) => k.startsWith('symfony/framework-bundle')) ? 'symfony' : null,
    docroot: has(dir, 'public/index.php') ? 'public' : '',
    hasLock: has(dir, 'composer.lock'),
    hasTests: 'phpunit/phpunit' in req || 'pestphp/pest' in req || Boolean(pkg.scripts?.test),
    extensions: extensions(req),
    detected,
    version: opts.runtime ?? detected ?? DEFAULT_VERSION,
  };
}

const testCommand = (i) => (i.pkg.scripts?.test ? 'composer test' : i.framework === 'laravel' ? 'php artisan test' : 'vendor/bin/phpunit');

export const php = {
  id: 'php',
  port: 8080,
  backend: true,
  tools: [],
  usesPackages: true,
  ciSteps: ['lint', 'test', 'audit'],
  ciDefaults: (i) => (i.hasTests ? ['test'] : []),
  ciNotes: (i, selected) => [
    selected.includes('test') && !i.hasTests && 'No phpunit/pest in composer.json or "test" script; the CI test step will fail until you add one.',
    selected.includes('lint') && 'Lint checks PHP syntax (php -l) on every file outside vendor/.',
  ],
  ecosystem: () => 'composer',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/php:1-${i.version}`,
  ignore: ['vendor', 'node_modules', 'storage/logs/*', 'storage/framework/cache/*', 'storage/framework/sessions/*', 'storage/framework/views/*', '.phpunit.result.cache'],
  starter: (opts) => ({
    pkg: { scripts: {} },
    req: {},
    framework: null,
    docroot: 'public',
    hasLock: true,
    hasTests: true,
    extensions: ['opcache'],
    detected: DEFAULT_VERSION,
    version: opts.runtime ?? DEFAULT_VERSION,
  }),
  assumes: (i) => `a composer.lock that you commit and a web root at ${i.docroot || 'the repo root'}/index.php`,
  detect: (dir, opts) => inspect(dir, opts),
  dockerfile: (i, port, c) => {
    const root = i.docroot ? `/var/www/html/${i.docroot}` : '/var/www/html';
    return lines(
      '# syntax=docker/dockerfile:1',
      'FROM composer:2 AS vendor',
      'WORKDIR /app',
      `COPY composer.json composer.lock* ./`,
      'RUN --mount=type=cache,target=/tmp/cache \\',
      '    composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --ignore-platform-reqs',
      'COPY . .',
      'RUN composer dump-autoload --optimize --no-dev',
      '',
      `FROM php:${i.version}-apache AS runtime`,
      'COPY --from=ghcr.io/mlocati/php-extension-installer:latest /usr/bin/install-php-extensions /usr/local/bin/',
      `RUN install-php-extensions ${i.extensions.join(' ')}`,
      apt(c),
      // Apache listens on an unprivileged port and runs as www-data, so the usual root-only paths are handed over.
      `RUN sed -ri -e 's!/var/www/html!${root}!g' /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \\`,
      `    && sed -ri -e 's/Listen 80$/Listen ${port}/' /etc/apache2/ports.conf \\`,
      `    && sed -ri -e 's/:80>/:${port}>/' /etc/apache2/sites-available/*.conf \\`,
      '    && a2enmod rewrite headers \\',
      '    && chown -R www-data:www-data /var/run/apache2 /var/log/apache2 /var/lock/apache2',
      envLines(c),
      'WORKDIR /var/www/html',
      'COPY --from=vendor --chown=www-data:www-data /app ./',
      'USER www-data',
      `EXPOSE ${port}`,
      healthcheck(c, port, 'curl'),
    );
  },
  ci(i, v = i.version, selected) {
    const on = (step) => selected.includes(step);
    return {
      image: `php:${v}-cli`,
      steps: [
        { uses: 'shivammathur/setup-php@v2', with: { 'php-version': v, tools: 'composer', coverage: 'none' } },
        { run: COMPOSER },
        { run: 'composer install --no-interaction --prefer-dist' },
        on('lint') && { run: "find . -name '*.php' -not -path './vendor/*' -print0 | xargs -0 -n1 php -l" },
        on('test') && { run: testCommand(i) },
        on('audit') && { run: 'composer audit' },
      ],
    };
  },
  notes: (i, port) => [
    `Apache serves ${i.docroot ? `${i.docroot}/` : 'the repo root'} on port ${port} as www-data; extensions installed: ${i.extensions.join(', ')} (add ext-* entries to composer.json to install more).`,
    !i.hasLock && 'No composer.lock found: the image installs whatever versions resolve today. Commit composer.lock.',
    !i.detected && `No PHP version in composer.json; assuming ${DEFAULT_VERSION}. Use --runtime to set it.`,
    i.framework === 'laravel' && 'Laravel: set APP_KEY and APP_ENV at runtime, and run migrations as a release step; storage/ and bootstrap/cache must be writable by www-data.',
  ],
};
