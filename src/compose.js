import { lines } from './fsutil.js';

const q = JSON.stringify;
const PASSWORD = '${DB_PASSWORD:-app}';

export const DBS = {
  postgres: {
    image: 'postgres:17-alpine',
    env: { POSTGRES_USER: 'app', POSTGRES_PASSWORD: PASSWORD, POSTGRES_DB: 'app' },
    data: '/var/lib/postgresql/data',
    port: 5432,
    healthcheck: ['CMD-SHELL', 'pg_isready -U app -d app'],
    url: ['DATABASE_URL', `postgres://app:${PASSWORD}@postgres:5432/app`],
    password: true,
  },
  mysql: {
    image: 'mysql:8.4',
    env: { MYSQL_DATABASE: 'app', MYSQL_USER: 'app', MYSQL_PASSWORD: PASSWORD, MYSQL_ROOT_PASSWORD: PASSWORD },
    data: '/var/lib/mysql',
    port: 3306,
    healthcheck: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
    url: ['DATABASE_URL', `mysql://app:${PASSWORD}@mysql:3306/app`],
    password: true,
  },
  mariadb: {
    image: 'mariadb:11',
    env: { MARIADB_DATABASE: 'app', MARIADB_USER: 'app', MARIADB_PASSWORD: PASSWORD, MARIADB_ROOT_PASSWORD: PASSWORD },
    data: '/var/lib/mysql',
    port: 3306,
    healthcheck: ['CMD', 'healthcheck.sh', '--connect', '--innodb_initialized'],
    url: ['DATABASE_URL', `mysql://app:${PASSWORD}@mariadb:3306/app`],
    password: true,
  },
  mongo: {
    image: 'mongo:8',
    data: '/data/db',
    port: 27017,
    healthcheck: ['CMD', 'mongosh', '--quiet', '--eval', "db.adminCommand('ping')"],
    url: ['MONGO_URL', 'mongodb://mongo:27017/app'],
  },
  redis: {
    image: 'redis:7-alpine',
    data: '/data',
    port: 6379,
    healthcheck: ['CMD', 'redis-cli', 'ping'],
    url: ['REDIS_URL', 'redis://redis:6379'],
  },
  memcached: {
    image: 'memcached:1-alpine',
    port: 11211,
    healthcheck: ['CMD-SHELL', 'nc -z localhost 11211'],
    url: ['MEMCACHED_URL', 'memcached:11211'],
  },
  elasticsearch: {
    image: 'docker.elastic.co/elasticsearch/elasticsearch:8.17.0',
    env: { 'discovery.type': 'single-node', 'xpack.security.enabled': 'false', ES_JAVA_OPTS: '-Xms512m -Xmx512m' },
    data: '/usr/share/elasticsearch/data',
    port: 9200,
    healthcheck: ['CMD-SHELL', 'curl -fs http://localhost:9200/_cluster/health'],
    url: ['ELASTICSEARCH_URL', 'http://elasticsearch:9200'],
  },
  mailpit: {
    image: 'axllent/mailpit:v1.21',
    port: 1025,
    healthcheck: ['CMD', '/mailpit', 'readyz'],
    url: ['SMTP_URL', 'smtp://mailpit:1025'],
    note: 'Mailpit catches outgoing mail; its web inbox is on port 8025.',
  },
  rabbitmq: {
    image: 'rabbitmq:4-alpine',
    env: { RABBITMQ_DEFAULT_USER: 'app', RABBITMQ_DEFAULT_PASS: PASSWORD },
    data: '/var/lib/rabbitmq',
    port: 5672,
    healthcheck: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping'],
    url: ['AMQP_URL', `amqp://app:${PASSWORD}@rabbitmq:5672`],
    password: true,
  },
};

const service = (name) => {
  const db = DBS[name];
  return [
    `  ${name}:`,
    `    image: ${db.image}`,
    db.env && '    environment:',
    ...Object.entries(db.env ?? {}).map(([k, v]) => `      ${k}: ${q(v)}`),
    db.data && ['    volumes:', `      - ${name}-data:${db.data}`],
    '    healthcheck:',
    `      test: ${q(db.healthcheck)}`,
    '      interval: 5s',
    '      timeout: 5s',
    '      retries: 10',
    '    restart: unless-stopped',
  ];
};

// Services that keep state; the rest (memcached, mailpit) need no named volume.
const persistent = (dbs) => dbs.filter((name) => DBS[name].data);

export const composeFile = (port, dbs, { image = null, buildArgs = [] } = {}) =>
  lines(
    'services:',
    '  app:',
    // Deploys by SSH pull a prebuilt image; locally compose still builds from the Dockerfile.
    image && `    image: "\${APP_IMAGE:-${image}:local}"`,
    buildArgs.length > 0
      ? [
          '    build:',
          '      context: .',
          '      args:',
          buildArgs.map(({ name, value }) => `        ${name}: ${q(`\${${name}:-${value ?? ''}}`)}`),
        ]
      : '    build: .',
    '    ports:',
    `      - "${port}:${port}"`,
    dbs.length > 0 && '    environment:',
    dbs.map((name) => `      ${DBS[name].url[0]}: ${q(DBS[name].url[1])}`),
    dbs.length > 0 && '    depends_on:',
    dbs.map((name) => [`      ${name}:`, '        condition: service_healthy']),
    '    restart: unless-stopped',
    dbs.map(service),
    persistent(dbs).length > 0 && ['', 'volumes:', persistent(dbs).map((name) => `  ${name}-data:`)],
  );

export const envExample = (dbs) =>
  dbs.some((name) => DBS[name].password) ? lines('# Copy to .env and change before deploying', 'DB_PASSWORD=change-me') : null;
