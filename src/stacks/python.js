import { lines } from '../fsutil.js';
import { DEFAULT_BUILD, apt, envLines, healthcheck, pkgs, systemUser } from '../container.js';

const SYNTAX = '# syntax=docker/dockerfile:1';
const IGNORE = ['**/__pycache__', '*.pyc', '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.ruff_cache'];

const mentions = (i, name) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`, 'm').test(i.manifests);

const INSTALL = {
  pip: ['COPY requirements.txt .', 'RUN pip install --no-cache-dir -r requirements.txt'],
  uv: [
    'COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv',
    'ENV UV_COMPILE_BYTECODE=1 PATH="/app/.venv/bin:$PATH"',
    'COPY pyproject.toml uv.lock ./',
    'RUN uv sync --frozen --no-dev --no-install-project',
  ],
  poetry: [
    'RUN pip install --no-cache-dir poetry',
    'ENV POETRY_VIRTUALENVS_CREATE=false',
    'COPY pyproject.toml poetry.lock ./',
    'RUN poetry install --no-root --only main',
  ],
};

const VENV = '/opt/venv';
const ENV_PY = 'ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1';
const UV = 'COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv';

/** Compilers for packages that ship no wheel: kept out of the final image by the multi-stage build. */
const compilers = (v) =>
  v === 'alpine'
    ? 'RUN apk add --no-cache build-base'
    : ['RUN apt-get update \\', '    && apt-get install -y --no-install-recommends build-essential \\', '    && rm -rf /var/lib/apt/lists/*'];

// The build stage installs into a virtualenv, which the runtime stage copies as it is.
const INSTALL_VENV = {
  pip: [`RUN python -m venv ${VENV}`, `ENV VIRTUAL_ENV=${VENV} PATH="${VENV}/bin:$PATH"`, 'COPY requirements.txt .', 'RUN pip install --no-cache-dir -r requirements.txt'],
  uv: [UV, `ENV UV_COMPILE_BYTECODE=1 UV_PROJECT_ENVIRONMENT=${VENV} PATH="${VENV}/bin:$PATH"`, 'COPY pyproject.toml uv.lock ./', 'RUN uv sync --frozen --no-dev --no-install-project'],
  poetry: [
    'RUN pip install --no-cache-dir poetry',
    `RUN python -m venv ${VENV}`,
    `ENV POETRY_VIRTUALENVS_CREATE=false VIRTUAL_ENV=${VENV} PATH="${VENV}/bin:$PATH"`,
    'COPY pyproject.toml poetry.lock ./',
    'RUN poetry install --no-root --only main',
  ],
};

/**
 * multi: a build stage (compilers, virtualenv) and a runtime stage that only copies the virtualenv.
 * production: one stage, production dependencies installed straight into the image, no compilers.
 * mixed: one stage with compilers and every dependency (development ones too) next to the app.
 */
const dockerfile = (i, port, c, cmd, b = DEFAULT_BUILD) => {
  const v = b.variant ?? 'slim';
  const image = `FROM python:${i.version}-${v}`;
  const tail = [`EXPOSE ${port}`, healthcheck(c, port, 'python'), `CMD ${JSON.stringify(cmd)}`];
  if (b.mode === 'multi') {
    return lines(
      SYNTAX,
      `${image} AS build`,
      ENV_PY,
      'WORKDIR /app',
      compilers(v),
      INSTALL_VENV[i.pm],
      '',
      `${image} AS runtime`,
      `${ENV_PY} VIRTUAL_ENV=${VENV} PATH="${VENV}/bin:$PATH"`,
      envLines(c),
      'WORKDIR /app',
      pkgs(c, v),
      systemUser(v),
      `COPY --from=build ${VENV} ${VENV}`,
      'COPY --chown=app:app . .',
      'USER app',
      tail,
    );
  }
  const mixed = b.mode === 'mixed';
  return lines(SYNTAX, image, ENV_PY, envLines(c), 'WORKDIR /app', mixed && compilers(v), pkgs(c, v), mixed ? DEV_INSTALL[i.pm] : INSTALL[i.pm], systemUser(v), 'COPY --chown=app:app . .', 'USER app', tail);
};

// Development image: same base, dev dependencies included, the source is bind mounted over /app and the server reloads.
const DEV_INSTALL = {
  pip: INSTALL.pip,
  uv: [INSTALL.uv[0], INSTALL.uv[1], INSTALL.uv[2], 'RUN uv sync --frozen --no-install-project'],
  poetry: [INSTALL.poetry[0], INSTALL.poetry[1], INSTALL.poetry[2], 'RUN poetry install --no-root'],
};

const devImage = (i, port, c, cmd) => ({
  dockerfile: lines(
    SYNTAX,
    `FROM python:${i.version}-slim`,
    'ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1',
    envLines(c),
    'WORKDIR /app',
    apt(c),
    DEV_INSTALL[i.pm],
    'COPY . .',
    `EXPOSE ${port}`,
    `CMD ${JSON.stringify(cmd)}`,
  ),
  workdir: '/app',
  mode: 'mount',
  volumes: i.pm === 'uv' ? ['/app/.venv'] : [],
});

const RUNNER = { pip: '', uv: 'uv run ', poetry: 'poetry run ' };
const CI_STEPS = ['lint', 'test', 'audit'];

// Tests run through the project's own environment; pytest is added when the project does not list it.
function testSteps(i, command) {
  if (command !== 'pytest' || mentions(i, 'pytest')) return [{ run: `${RUNNER[i.pm]}${command}` }];
  return {
    pip: [{ run: 'pip install pytest' }, { run: 'pytest' }],
    uv: [{ run: 'uv run --with pytest pytest' }],
    poetry: [{ run: 'poetry run pip install pytest' }, { run: 'poetry run pytest' }],
  }[i.pm];
}

const auditSteps = (i) =>
  ({
    pip: [{ run: 'pip install pip-audit' }, { run: 'pip-audit -r requirements.txt' }],
    uv: [
      { run: 'uv export --frozen --no-dev --no-hashes -o requirements-audit.txt' },
      { run: 'pip install pip-audit' },
      { run: 'pip-audit -r requirements-audit.txt' },
    ],
    poetry: [{ run: 'poetry run pip install pip-audit' }, { run: 'poetry run pip-audit' }],
  })[i.pm];

/** Marks steps as belonging to one CI step, so a manual run can switch them off. */
const forStep = (ciStep, steps) => steps.map((s) => ({ ...s, ciStep }));

function ci(i, command, selected, v = i.version) {
  const on = (step) => selected.includes(step);
  const setup = {
    pip: [{ run: 'pip install -r requirements.txt' }],
    uv: [{ run: 'pip install uv' }, { run: 'uv sync --frozen' }],
    poetry: [{ run: 'pip install poetry' }, { run: 'poetry install --no-root' }],
  }[i.pm];
  return {
    image: `python:${v}`,
    steps: [
      {
        uses: 'actions/setup-python@v5',
        with: { 'python-version': v, ...(i.pm === 'pip' && { cache: 'pip' }) },
      },
      ...setup,
      ...(on('lint') ? forStep('lint', [{ run: 'pip install ruff' }, { run: 'ruff check .' }]) : []),
      ...(on('test') ? forStep('test', testSteps(i, command)) : []),
      ...(on('audit') ? forStep('audit', auditSteps(i)) : []),
    ],
  };
}

const ciNotes = (i, selected, command) => [
  selected.includes('test') && command === 'pytest' && !mentions(i, 'pytest') && 'pytest is not in your dependencies; the CI test step installs it.',
  selected.includes('lint') && 'Lint runs ruff with its defaults; add a ruff config to tune it.',
];

const buildNotes = (b) => [
  b.variant === 'alpine' && 'Alpine uses musl: most packages have musl wheels, but those that do not are compiled from source (slower builds, and they need the compilers that only the multi-stage and mixed builds have).',
  b.mode === 'production' && 'Production only: dependencies are installed straight into the final image without compilers, so a package with no wheel for this platform fails to install. Use multi-stage for those.',
  b.mode === 'mixed' && 'Build and production in one image: it keeps compilers and your development dependencies next to the app, so it is bigger than a multi-stage image.',
];

const TOOLS = ['pip', 'uv', 'poetry'];
const MANIFEST = { pip: 'requirements.txt', uv: 'pyproject.toml + uv.lock', poetry: 'pyproject.toml + poetry.lock' };

export const fastapi = {
  id: 'fastapi',
  port: 8000,
  backend: true,
  tools: TOOLS,
  usesPackages: true,
  ecosystem: () => 'pip',
  variants: ['alpine', 'slim'],
  defaultVariant: 'slim',
  healthKind: () => 'python',
  buildNotes: (i, b) => buildNotes(b),
  codeql: 'python',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/python:1-${i.version}`,
  ciSteps: CI_STEPS,
  ciDefaults: (i) => (mentions(i, 'pytest') ? ['test'] : []),
  ciNotes: (i, selected) => ciNotes(i, selected, 'pytest'),
  ignore: IGNORE,
  starter: (opts) => ({ manifests: 'fastapi uvicorn', version: opts.runtime ?? '3.13', pm: opts.tool ?? 'pip', target: 'app.main:app' }),
  assumes: (i) => `your app object is app.main:app and dependencies are in ${MANIFEST[i.pm]}`,
  dev(i, port, c) {
    return devImage(i, port, c, ['uvicorn', i.target ?? 'app.main:app', '--host', '0.0.0.0', '--port', String(port), '--reload']);
  },
  dockerfile(i, port, c, b) {
    const target = i.target ?? 'app.main:app';
    return dockerfile(i, port, c, ['uvicorn', target, '--host', '0.0.0.0', '--port', String(port)], b);
  },
  ci: (i, v, selected) => ci(i, 'pytest', selected, v),
  notes: (i) => [
  ],
};

export const django = {
  id: 'django',
  port: 8000,
  backend: true,
  tools: TOOLS,
  usesName: true,
  usesPackages: true,
  ecosystem: () => 'pip',
  variants: ['alpine', 'slim'],
  defaultVariant: 'slim',
  healthKind: () => 'python',
  buildNotes: (i, b) => buildNotes(b),
  codeql: 'python',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/python:1-${i.version}`,
  ciSteps: CI_STEPS,
  ciDefaults: () => ['test'],
  ciNotes: (i, selected) => ciNotes(i, selected, 'python manage.py test'),
  ignore: [...IGNORE, 'db.sqlite3'],
  starter: (opts) => ({
    manifests: 'django gunicorn',
    version: opts.runtime ?? '3.13',
    pm: opts.tool ?? 'pip',
    wsgi: `${opts.name ?? 'config'}.wsgi:application`,
  }),
  assumes: (i) => `${i.wsgi.split('.')[0]}/wsgi.py exists and dependencies are in ${MANIFEST[i.pm]}`,
  dev: (i, port, c) => devImage(i, port, c, ['python', 'manage.py', 'runserver', `0.0.0.0:${port}`]),
  dockerfile: (i, port, c, b) =>
    dockerfile(i, port, c, ['gunicorn', i.wsgi ?? 'config.wsgi:application', '--bind', `0.0.0.0:${port}`], b),
  ci: (i, v, selected) => ci(i, 'python manage.py test', selected, v),
  notes: (i) => [
    'Set ALLOWED_HOSTS and SECRET_KEY from env; run migrations and collectstatic as a release step (or an entrypoint).',
  ],
};
