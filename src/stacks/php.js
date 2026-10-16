import { lines } from '../fsutil.js';
import { DEFAULT_BUILD, DEV_ROOT, apt, envLines, healthcheck, runAsOf, userLine } from '../container.js';
import { VERSIONS } from '../tools.js';

const DEFAULT_VERSION = '8.4';
const COMPOSER = 'command -v composer >/dev/null || (apt-get update -qq && apt-get install -y -qq git unzip && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer)';

// www-data in the Debian based PHP images.
const WWW_DATA = 33;
// The code belongs to root (www-data can read it, not rewrite it); only the folders Laravel writes to, when they exist, are handed over.
const WRITABLE = ['storage', 'bootstrap/cache'];
const handOver = `RUN for d in ${WRITABLE.join(' ')}; do if [ -d "$d" ]; then chown -R www-data:www-data "$d"; fi; done`;

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
  ignore: (b) => [...(b.mode === 'production' ? [] : ['vendor']), 'node_modules', 'storage/logs/*', 'storage/framework/cache/*', 'storage/framework/sessions/*', 'storage/framework/views/*', '.phpunit.result.cache'],
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
  dev(i, port, c) {
    const root = i.docroot ? `/var/www/html/${i.docroot}` : '/var/www/html';
    return {
      dockerfile: lines(
        '# syntax=docker/dockerfile:1',
        DEV_ROOT,
        `FROM php:${i.version}-apache`,
        'COPY --from=composer:2 /usr/bin/composer /usr/bin/composer',
        `COPY --from=${VERSIONS.phpExtensionInstaller} /usr/bin/install-php-extensions /usr/local/bin/`,
        `RUN install-php-extensions ${i.extensions.join(' ')}`,
        apt({ packages: ['git', 'unzip', ...c.packages] }),
        `RUN sed -ri -e 's!/var/www/html!${root}!g' /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \\`,
        `    && sed -ri -e 's/Listen 80$/Listen ${port}/' /etc/apache2/ports.conf \\`,
        `    && sed -ri -e 's/:80>/:${port}>/' /etc/apache2/sites-available/*.conf \\`,
        '    && a2enmod rewrite headers',
        envLines(c),
        'WORKDIR /var/www/html',
        'COPY . .',
        'RUN composer install --no-interaction --prefer-dist',
        `EXPOSE ${port}`,
      ),
      workdir: '/var/www/html',
      mode: 'mount',
      volumes: ['/var/www/html/vendor'],
    };
  },
  dockerfile(i, port, c, b = DEFAULT_BUILD) {
    const root = i.docroot ? `/var/www/html/${i.docroot}` : '/var/www/html';
    // The Apache runtime, which every mode ends with; `source` is the line that puts the app (and its vendor folder) in place.
    const runtime = (source, { tools = false } = {}) => [
      `FROM php:${i.version}-apache AS runtime`,
      tools && 'COPY --from=composer:2 /usr/bin/composer /usr/bin/composer',
      `COPY --from=${VERSIONS.phpExtensionInstaller} /usr/bin/install-php-extensions /usr/local/bin/`,
      `RUN install-php-extensions ${i.extensions.join(' ')}`,
      apt(tools ? { packages: ['git', 'unzip', ...c.packages] } : c),
      // Apache listens on an unprivileged port and runs as www-data, so the usual root-only paths are handed over.
      `RUN sed -ri -e 's!/var/www/html!${root}!g' /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \\`,
      `    && sed -ri -e 's/Listen 80$/Listen ${port}/' /etc/apache2/ports.conf \\`,
      `    && sed -ri -e 's/:80>/:${port}>/' /etc/apache2/sites-available/*.conf \\`,
      '    && a2enmod rewrite headers \\',
      '    && chown -R www-data:www-data /var/run/apache2 /var/log/apache2 /var/lock/apache2',
      envLines(c),
      'WORKDIR /var/www/html',
      ...source,
      handOver,
      userLine(WWW_DATA),
      `EXPOSE ${port}`,
      healthcheck(c, port, 'curl'),
    ];
    if (b.mode === 'production') return lines('# syntax=docker/dockerfile:1', runtime(['COPY . ./']));
    if (b.mode === 'mixed') {
      // One image: composer installs everything (development packages too) inside the Apache image.
      return lines('# syntax=docker/dockerfile:1', runtime(['COPY . ./', 'RUN composer install --no-interaction --prefer-dist'], { tools: true }));
    }
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
      runtime(['COPY --from=vendor /app ./']),
    );
  },
  variants: ['slim'],
  defaultVariant: 'slim',
  variantNote: 'the image runs Apache, which the Alpine PHP images do not include',
  healthKind: () => 'curl',
  // Laravel writes to storage/ and bootstrap/cache, which hold folders of the app itself: an emptyDir over them would hide those.
  runAs: () => runAsOf(WWW_DATA, { readOnlyRoot: false, why: 'PHP apps (Laravel) write to storage/ and bootstrap/cache inside the app folder' }),
  buildNotes: (i, b) => [
    b.mode === 'production' && 'Production only: the image copies your project including its vendor/ folder, so run `composer install --no-dev --optimize-autoloader` first (the generated pipeline builds the image from the repository as it is).',
    b.mode === 'mixed' && 'Build and production in one image: composer, git and your development packages stay in the image next to the app.',
  ],
  ci(i, v = i.version, selected) {
    const on = (step) => selected.includes(step);
    return {
      image: `php:${v}-cli`,
      steps: [
        { uses: 'shivammathur/setup-php@v2', with: { 'php-version': v, tools: 'composer', coverage: 'none' } },
        { run: COMPOSER },
        { run: 'composer install --no-interaction --prefer-dist' },
        on('lint') && { run: "find . -name '*.php' -not -path './vendor/*' -print0 | xargs -0 -n1 php -l", ciStep: 'lint' },
        on('test') && { run: testCommand(i), ciStep: 'test' },
        on('audit') && { run: 'composer audit', ciStep: 'audit' },
      ],
    };
  },
  notes: (i, port) => [
    `Apache serves ${i.docroot ? `${i.docroot}/` : 'the repo root'} on port ${port} as www-data; extensions installed: ${i.extensions.join(', ')} (add ext-* entries to composer.json to install more).`,
    i.framework === 'laravel' && 'Laravel: set APP_KEY and APP_ENV at runtime, and run migrations as a release step; storage/ and bootstrap/cache must be writable by www-data.',
  ],
};
