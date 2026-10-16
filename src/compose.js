import { lines } from './fsutil.js';

const q = JSON.stringify;
/** A variable compose must find (in .env or the environment): `docker compose` stops with the message when it is missing. */
const need = (name) => `\${${name}:?set ${name} in .env}`;
const PASSWORD = need('DB_PASSWORD');
const ROOT_PASSWORD = need('DB_ROOT_PASSWORD');

/**
 * The databases and other services an app can use. `secrets` are the variables their passwords come from (listed in
 * .env.example, required by compose); `command` only applies to compose (CI service containers cannot pass one), and
 * `ciUrl` is the URL CI tests use when it differs (redis has no password in CI for that reason).
 */
export const DBS = {
  postgres: {
    image: 'postgres:17-alpine',
    env: { POSTGRES_USER: 'app', POSTGRES_PASSWORD: PASSWORD, POSTGRES_DB: 'app' },
    data: '/var/lib/postgresql/data',
    port: 5432,
    healthcheck: ['CMD-SHELL', 'pg_isready -U app -d app'],
    url: ['DATABASE_URL', `postgres://app:${PASSWORD}@postgres:5432/app`],
    secrets: ['DB_PASSWORD'],
  },
  mysql: {
    image: 'mysql:8.4',
    env: { MYSQL_DATABASE: 'app', MYSQL_USER: 'app', MYSQL_PASSWORD: PASSWORD, MYSQL_ROOT_PASSWORD: ROOT_PASSWORD },
    data: '/var/lib/mysql',
    port: 3306,
    healthcheck: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
    url: ['DATABASE_URL', `mysql://app:${PASSWORD}@mysql:3306/app`],
    secrets: ['DB_PASSWORD', 'DB_ROOT_PASSWORD'],
  },
  mariadb: {
    image: 'mariadb:11',
    env: { MARIADB_DATABASE: 'app', MARIADB_USER: 'app', MARIADB_PASSWORD: PASSWORD, MARIADB_ROOT_PASSWORD: ROOT_PASSWORD },
    data: '/var/lib/mysql',
    port: 3306,
    healthcheck: ['CMD', 'healthcheck.sh', '--connect', '--innodb_initialized'],
    url: ['DATABASE_URL', `mysql://app:${PASSWORD}@mariadb:3306/app`],
    secrets: ['DB_PASSWORD', 'DB_ROOT_PASSWORD'],
  },
  mongo: {
    image: 'mongo:8',
    env: { MONGO_INITDB_ROOT_USERNAME: 'app', MONGO_INITDB_ROOT_PASSWORD: need('MONGO_PASSWORD') },
    data: '/data/db',
    port: 27017,
    healthcheck: ['CMD', 'mongosh', '--quiet', '--eval', "db.adminCommand('ping')"],
    url: ['MONGO_URL', `mongodb://app:${need('MONGO_PASSWORD')}@mongo:27017/app?authSource=admin`],
    secrets: ['MONGO_PASSWORD'],
  },
  redis: {
    image: 'redis:7-alpine',
    // REDISCLI_AUTH lets the health check's redis-cli sign in; grep fails on a NOAUTH answer.
    env: { REDISCLI_AUTH: need('REDIS_PASSWORD') },
    command: ['redis-server', '--requirepass', need('REDIS_PASSWORD')],
    data: '/data',
    port: 6379,
    healthcheck: ['CMD-SHELL', 'redis-cli ping | grep -q PONG'],
    url: ['REDIS_URL', `redis://:${need('REDIS_PASSWORD')}@redis:6379`],
    ciUrl: 'redis://redis:6379',
    ciEnv: {},
    secrets: ['REDIS_PASSWORD'],
  },
  memcached: {
    image: 'memcached:1-alpine',
    port: 11211,
    healthcheck: ['CMD-SHELL', 'nc -z localhost 11211'],
    url: ['MEMCACHED_URL', 'memcached:11211'],
  },
  elasticsearch: {
    image: 'docker.elastic.co/elasticsearch/elasticsearch:8.17.0',
    // Security on (users and passwords); plain HTTP inside the compose network, so no certificates to manage.
    env: {
      'discovery.type': 'single-node',
      'xpack.security.enabled': 'true',
      'xpack.security.http.ssl.enabled': 'false',
      'xpack.security.transport.ssl.enabled': 'false',
      ELASTIC_PASSWORD: need('ELASTIC_PASSWORD'),
      ES_JAVA_OPTS: '-Xms512m -Xmx512m',
    },
    data: '/usr/share/elasticsearch/data',
    port: 9200,
    healthcheck: ['CMD-SHELL', 'curl -fs -u "elastic:$$ELASTIC_PASSWORD" http://localhost:9200/_cluster/health'],
    ciHealth: 'curl -s -o /dev/null http://localhost:9200',
    url: ['ELASTICSEARCH_URL', `http://elastic:${need('ELASTIC_PASSWORD')}@elasticsearch:9200`],
    secrets: ['ELASTIC_PASSWORD'],
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
    env: { RABBITMQ_DEFAULT_USER: 'app', RABBITMQ_DEFAULT_PASS: need('RABBITMQ_PASSWORD') },
    data: '/var/lib/rabbitmq',
    port: 5672,
    healthcheck: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping'],
    url: ['AMQP_URL', `amqp://app:${need('RABBITMQ_PASSWORD')}@rabbitmq:5672`],
    secrets: ['RABBITMQ_PASSWORD'],
  },
};

/** Throwaway password for the database containers of a CI job: they live for one job and hold test data only. */
export const CI_PASSWORD = 'ci-test-only';
/** A compose value as CI uses it: every required password becomes the throwaway CI one. */
export const forCi = (text) => String(text).replace(/\$\{[A-Z_]+:\?[^}]*\}/g, CI_PASSWORD);

// Engines where one server holds several databases, so each service can have its own on the shared instance.
const SQL = ['postgres', 'mysql', 'mariadb'];
/** Engines whose per-service databases also get a user of their own (redis only gets a numbered database). */
const OWN_USER = [...SQL, 'mongo'];
const ident = (id) => id.replace(/-/g, '_');
const REDIS_DATABASES = 16;

/** The password variable of one service's own database user: DB_PASSWORD_API (SQL) or MONGO_PASSWORD_API. */
export const userPasswordVar = (name, app) => `${name === 'mongo' ? 'MONGO_PASSWORD' : 'DB_PASSWORD'}_${app.dbName.toUpperCase()}`;

/**
 * Gives every app its database name (its service name) and, when it uses redis, its own numbered redis database; redis only has
 * sixteen, so more services than that cannot each have one (`perService`: the databases are actually used).
 */
export function assignDatabases(apps, perService = false) {
  let redis = 0;
  const out = apps.map((app) => ({ ...app, dbName: ident(app.id), ...(app.dbs.includes('redis') && { redisDb: redis++ }) }));
  if (perService && redis > REDIS_DATABASES) throw new Error(`redis has ${REDIS_DATABASES} databases: at most ${REDIS_DATABASES} services can have their own`);
  return out;
}

/** The variable that carries a service's URL: with several SQL engines the first keeps DATABASE_URL and the others get POSTGRES_URL, MYSQL_URL, ... */
export function urlKey(name, list) {
  const key = DBS[name].url[0];
  return SQL.includes(name) && list.find((n) => SQL.includes(n)) !== name ? `${name.toUpperCase()}_URL` : key;
}

/**
 * The URL variable of a database for one app: the shared `app` database, or with `perService` the app's own database, signed in
 * as its own user (SQL engines and MongoDB) with its own password.
 */
export function dbUrl(name, app, perService) {
  const key = urlKey(name, app.dbs);
  const url = DBS[name].url[1];
  if (!perService) return [key, url];
  const own = need(userPasswordVar(name, app));
  if (SQL.includes(name)) return [key, url.replace(/^(\w+):\/\/app:[^@]+@(.*)\/app$/, `$1://${app.dbName}:${own}@$2/${app.dbName}`)];
  if (name === 'mongo') return [key, `mongodb://${app.dbName}:${own}@mongo:27017/${app.dbName}`];
  if (name === 'redis') return [key, `${url}/${app.redisDb}`];
  return [key, url];
}

/** The per-service password variables one engine's container needs for its init script. */
const userVars = (name, apps) => (OWN_USER.includes(name) ? apps.filter((a) => a.dbs.includes(name)).map((a) => userPasswordVar(name, a)) : []);

const HEADER = 'One database and one user per service, each with its own password (from the environment). Runs once, when the data volume is first created.';

/**
 * Init scripts per engine, creating one database and one user per service that uses it; the engine runs them when its data
 * volume is first created. Shell scripts (sourced by the image's entrypoint) so the passwords come from the environment.
 */
export function dbInitFiles(apps) {
  return usedDbs(apps)
    .filter((name) => OWN_USER.includes(name))
    .map((name) => {
      const users = apps.filter((a) => a.dbs.includes(name));
      if (name === 'postgres') {
        // psql variables (:'pw') quote the passwords, so any character is safe.
        return {
          path: 'db/postgres/init.sh',
          content: lines(
            `# ${HEADER}`,
            'psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \\',
            users.map((a, i) => `  -v pw_${a.dbName}="$${userPasswordVar(name, a)}"${i < users.length - 1 ? ' \\' : ' <<\'SQL\''}`),
            users.flatMap((a) => [
              `CREATE USER "${a.dbName}" WITH PASSWORD :'pw_${a.dbName}';`,
              `CREATE DATABASE "${a.dbName}" OWNER "${a.dbName}";`,
              `REVOKE ALL ON DATABASE "${a.dbName}" FROM PUBLIC;`,
            ]),
            'SQL',
          ),
        };
      }
      if (name === 'mongo') {
        return {
          path: 'db/mongo/init.js',
          content: lines(
            `// ${HEADER}`,
            users.map((a) => `db.getSiblingDB('${a.dbName}').createUser({ user: '${a.dbName}', pwd: process.env.${userPasswordVar(name, a)}, roles: [{ role: 'readWrite', db: '${a.dbName}' }] });`),
          ),
        };
      }
      // MySQL and MariaDB: docker_process_sql is the entrypoint's own client (as root, on the init socket).
      return {
        path: `db/${name}/init.sh`,
        content: lines(
          `# ${HEADER}`,
          "sql_string() { printf '%s' \"$1\" | sed -e 's/\\\\/\\\\\\\\/g' -e \"s/'/\\\\\\\\'/g\"; }",
          'docker_process_sql <<SQL',
          users.flatMap((a) => [
            `CREATE DATABASE IF NOT EXISTS \\\`${a.dbName}\\\`;`,
            `CREATE USER IF NOT EXISTS '${a.dbName}'@'%' IDENTIFIED BY '$(sql_string "$${userPasswordVar(name, a)}")';`,
            `GRANT ALL PRIVILEGES ON \\\`${a.dbName}\\\`.* TO '${a.dbName}'@'%';`,
          ]),
          'SQL',
        ),
      };
    });
}

export const RESTART_POLICIES = ['unless-stopped', 'always', 'on-failure', 'no'];
const restartLine = (policy) => `    restart: ${policy === 'no' ? '"no"' : policy}`;

const NETWORK_NAME = /^[a-z][a-z0-9_-]*$/;

/**
 * Validates the declared networks (`[{ name, internal?, external? }]`) and the names each service joins; returns the networks as
 * written. `internal` networks have no route out; `external` ones already exist (created outside this compose project).
 */
export function parseNetworks(raw = []) {
  const names = new Set();
  return raw.map((n, i) => {
    if (typeof n !== 'object' || n === null) throw new Error(`network ${i + 1} must be an object`);
    if (!NETWORK_NAME.test(n.name ?? '')) throw new Error(`invalid network name "${n.name}": lowercase letters, digits, dashes and underscores, starting with a letter`);
    if (n.name === 'default') throw new Error('"default" is the network compose creates itself: declare it under another name');
    if (names.has(n.name)) throw new Error(`network ${n.name} is declared twice`);
    names.add(n.name);
    if (n.internal && n.external) throw new Error(`network ${n.name} cannot be both internal and external: an external network already exists with its own settings`);
    return { name: n.name, internal: Boolean(n.internal), external: Boolean(n.external) };
  });
}

/** The names `joined` must all be declared; an empty or missing list means every declared network. */
export function networksOf(joined, declared, what) {
  const known = declared.map((n) => n.name);
  const bad = (joined ?? []).find((name) => !known.includes(name));
  if (bad) throw new Error(`${what} joins the network "${bad}", which is not declared (${known.join(', ') || 'none'})`);
  return joined?.length ? joined : known;
}

const networkLines = (names) => names.length > 0 && ['    networks:', names.map((n) => `      - ${n}`)];

const service = (name, { init = false, apps = [], restart = 'unless-stopped', networks = [] } = {}) => {
  const db = DBS[name];
  const env = { ...db.env, ...(init && Object.fromEntries(userVars(name, apps).map((v) => [v, need(v)]))) };
  return [
    `  ${name}:`,
    `    image: ${db.image}`,
    db.command && `    command: ${q(db.command)}`,
    Object.keys(env).length > 0 && '    environment:',
    ...Object.entries(env).map(([k, v]) => `      ${k}: ${q(v)}`),
    db.data && ['    volumes:', `      - ${name}-data:${db.data}`, init && OWN_USER.includes(name) && `      - ./db/${name}:/docker-entrypoint-initdb.d:ro`],
    '    healthcheck:',
    `      test: ${q(db.healthcheck)}`,
    '      interval: 5s',
    '      timeout: 5s',
    '      retries: 10',
    restartLine(restart),
    networkLines(networks),
  ];
};

// Services that keep state; the rest (memcached, mailpit) need no named volume.
const persistent = (dbs) => dbs.filter((name) => DBS[name].data);

/** Environment variable that overrides the image of a service, so the ssh deploy can point compose at a freshly built one. */
const imageVar = (app) => app.composeImage;

/** Host ports: each service keeps its own port unless another one already took it, then the next free one is used. */
export function assignHostPorts(apps) {
  const taken = new Set();
  return apps.map((app) => {
    let host = app.port;
    while (taken.has(host)) host += 1;
    taken.add(host);
    return { ...app, hostPort: host };
  });
}

const appService = (app, { appName, image, perService, restart, networks }) => {
  const context = app.dir === '.' ? '.' : `./${app.dir}`;
  const dockerfile = app.file ?? 'Dockerfile';
  const plain = app.buildArgs.length === 0 && dockerfile === 'Dockerfile';
  return [
    `  ${app.id}:`,
    // Deploys by SSH pull a prebuilt image; locally compose still builds from the Dockerfile.
    image && `    image: "\${${imageVar(app)}:-${app.multi ? `${appName}-${app.id}` : appName}:local}"`,
    plain
      ? `    build: ${context}`
      : [
          '    build:',
          `      context: ${context}`,
          dockerfile !== 'Dockerfile' && `      dockerfile: ${dockerfile}`,
          app.buildArgs.length > 0 && ['      args:', app.buildArgs.map(({ name, value }) => `        ${name}: ${q(`\${${name}:-${value ?? ''}}`)}`)],
        ],
    '    ports:',
    `      - "${app.hostPort}:${app.port}"`,
    app.dbs.length > 0 && '    environment:',
    app.dbs.map((name) => {
      const [key, url] = dbUrl(name, app, perService);
      return `      ${key}: ${q(url)}`;
    }),
    app.dbs.length > 0 && '    depends_on:',
    app.dbs.map((name) => [`      ${name}:`, '        condition: service_healthy']),
    restartLine(restart),
    networkLines(networks),
  ];
};

/** Databases and other services any app uses, in the order they are first needed. */
export const usedDbs = (apps) => [...new Set(apps.flatMap((app) => app.dbs))];

/**
 * One compose file for every app plus the services they share. With one app at the project root this is the classic
 * single `app` service; `image` (the project name) makes services use a prebuilt image when `<NAME>_IMAGE` is set.
 */
export const composeFile = (apps, { appName, image = null, perService = false, restart = 'unless-stopped', networks = [], dbNetworks = [] } = {}) => {
  const dbs = usedDbs(apps);
  return lines(
    'services:',
    apps.map((app) => appService(app, { appName, image, perService, restart, networks: app.networks ?? [] })),
    dbs.map((name) => service(name, { init: perService, apps, restart, networks: dbNetworks })),
    persistent(dbs).length > 0 && ['', 'volumes:', persistent(dbs).map((name) => `  ${name}-data:`)],
    networks.length > 0 && ['', 'networks:', networks.flatMap((n) => [`  ${n.name}:`, n.internal && '    internal: true', n.external && '    external: true'])],
  );
};

const DEV_ENV = /^(dev|development|local)$/;
export const isDevEnv = (env) => DEV_ENV.test(env);

/** `docker-compose.yml` + `qa` -> `docker-compose.qa.yml`. */
export const overrideName = (composeName, env) => composeName.replace(/\.(ya?ml)$/, `.${env}.$1`);

/**
 * The compose file of one environment, meant to be layered over the base file (`docker compose -f base -f this`).
 * Development builds `Dockerfile.dev` with the source mounted for live reload and publishes the databases; every other
 * environment keeps the production image and adds a restart policy, log rotation and its own optional env file.
 */
export function composeOverride(env, apps) {
  const dbs = usedDbs(apps);
  const dev = isDevEnv(env);
  const logging = ['    logging:', '      driver: json-file', '      options:', '        max-size: "10m"', '        max-file: "3"'];
  const appBlock = (app) => {
    const name = app.id;
    if (!dev) {
      return [`  ${name}:`, '    restart: always', '    env_file:', `      - path: .env.${env}`, '        required: false', logging];
    }
    const context = app.dir === '.' ? '.' : `./${app.dir}`;
    const { workdir, mode, volumes } = app.dev;
    return [
      `  ${name}:`,
      '    build:',
      `      dockerfile: Dockerfile.${env}`,
      mode === 'mount' && ['    volumes:', `      - ${context}:${workdir}`, volumes.map((v) => `      - ${v}`)],
      mode === 'watch' && ['    develop:', '      watch:', '        - action: sync+restart', `          path: ${context}`, `          target: ${workdir}`],
      '    restart: "no"',
    ];
  };
  const dbBlock = (name) =>
    // Published for tools on this machine only (127.0.0.1), never on every interface.
    dev ? [`  ${name}:`, '    ports:', `      - "127.0.0.1:${DBS[name].port}:${DBS[name].port}"`] : [`  ${name}:`, '    restart: always', logging];
  return lines(`# ${env}: layer over the base file with  docker compose -f BASE -f THIS up`, 'services:', apps.map(appBlock), dbs.map(dbBlock));
}

/**
 * `.env.example`: every password the compose file requires, with a placeholder to replace (compose refuses to start without
 * them). With a database per service, each service's own user password too.
 */
export function envExample(dbs, apps = [], perService = false) {
  const shared = [...new Set(dbs.flatMap((name) => DBS[name].secrets ?? []))];
  const own = perService ? [...new Set(dbs.flatMap((name) => userVars(name, apps)))] : [];
  if (!shared.length && !own.length) return null;
  return lines(
    '# Copy to .env (never commit it) and replace every value: docker compose refuses to start while one is missing.',
    '# They go into connection URLs, so use long random letters and digits (openssl rand -hex 24).',
    shared.map((name) => `${name}=change-me`),
    own.length > 0 && ['# One password per service database user', own.map((name) => `${name}=change-me`)],
  );
}
