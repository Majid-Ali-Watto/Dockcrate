import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { has, read, lines } from '../fsutil.js';
import { apt, envLines, healthcheck } from '../container.js';

const SYNTAX = '# syntax=docker/dockerfile:1';
const IGNORE = ['**/__pycache__', '*.pyc', '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.ruff_cache'];

const mentions = (i, name) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`, 'm').test(i.manifests);

function inspect(dir, opts, framework, label) {
  const manifests = ['requirements.txt', 'pyproject.toml'].map((f) => read(dir, f)).join('\n').toLowerCase();
  const i = { manifests, version: opts.runtime ?? read(dir, '.python-version').match(/^\d+\.\d+/)?.[0] ?? '3.13' };
  if (!mentions(i, framework)) return null;
  i.pm = has(dir, 'uv.lock') ? 'uv' : has(dir, 'poetry.lock') ? 'poetry' : has(dir, 'requirements.txt') ? 'pip' : null;
  if (!i.pm) throw new Error(`${label} project found but no requirements.txt, uv.lock or poetry.lock to install from`);
  return i;
}

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

const dockerfile = (i, port, c, cmd) =>
  lines(
    SYNTAX,
    `FROM python:${i.version}-slim`,
    'ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1',
    envLines(c),
    'WORKDIR /app',
    apt(c),
    INSTALL[i.pm],
    'RUN useradd --system --uid 10001 app',
    'COPY --chown=app:app . .',
    'USER app',
    `EXPOSE ${port}`,
    healthcheck(c, port, 'python'),
    `CMD ${JSON.stringify(cmd)}`,
  );

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
      ...(on('lint') ? [{ run: 'pip install ruff' }, { run: 'ruff check .' }] : []),
      ...(on('test') ? testSteps(i, command) : []),
      ...(on('audit') ? auditSteps(i) : []),
    ],
  };
}

const ciNotes = (i, selected, command) => [
  selected.includes('test') && command === 'pytest' && !mentions(i, 'pytest') && 'pytest is not in your dependencies; the CI test step installs it.',
  selected.includes('lint') && 'Lint runs ruff with its defaults; add a ruff config to tune it.',
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
  codeql: 'python',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/python:1-${i.version}`,
  ciSteps: CI_STEPS,
  ciDefaults: (i) => (mentions(i, 'pytest') ? ['test'] : []),
  ciNotes: (i, selected) => ciNotes(i, selected, 'pytest'),
  ignore: IGNORE,
  starter: (opts) => ({ manifests: 'fastapi uvicorn', version: opts.runtime ?? '3.13', pm: opts.tool ?? 'pip', target: 'app.main:app' }),
  assumes: (i) => `your app object is app.main:app and dependencies are in ${MANIFEST[i.pm]}`,
  detect(dir, opts) {
    const i = inspect(dir, opts, 'fastapi', 'FastAPI');
    if (!i) return null;
    const candidates = ['main.py', 'app/main.py', 'src/main.py', 'app.py', 'app/app.py', 'src/app.py'];
    for (const file of candidates) {
      const variable = read(dir, file).match(/^(\w+)\s*=\s*FastAPI\(/m)?.[1];
      if (variable) {
        i.target = `${file.replace(/\.py$/, '').replaceAll('/', '.')}:${variable}`;
        break;
      }
    }
    return i;
  },
  dockerfile(i, port, c) {
    const target = i.target ?? 'app.main:app';
    return dockerfile(i, port, c, ['uvicorn', target, '--host', '0.0.0.0', '--port', String(port)]);
  },
  ci: (i, v, selected) => ci(i, 'pytest', selected, v),
  notes: (i) => [
    !i.target && 'Could not find a FastAPI(...) app object; CMD assumes app.main:app. Edit it in the Dockerfile.',
    !/fastapi\[standard\]|uvicorn/.test(i.manifests) && 'Add uvicorn (or fastapi[standard]) to your dependencies: CMD runs uvicorn.',
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
  detect(dir, opts) {
    if (!has(dir, 'manage.py')) return null;
    const i = inspect(dir, opts, 'django', 'Django');
    if (!i) return null;
    const project = readdirSync(dir, { withFileTypes: true }).find((e) => e.isDirectory() && has(join(dir, e.name), 'wsgi.py'));
    if (project) i.wsgi = `${project.name}.wsgi:application`;
    return i;
  },
  dockerfile: (i, port, c) =>
    dockerfile(i, port, c, ['gunicorn', i.wsgi ?? 'config.wsgi:application', '--bind', `0.0.0.0:${port}`]),
  ci: (i, v, selected) => ci(i, 'python manage.py test', selected, v),
  notes: (i) => [
    !i.wsgi && 'Could not find <project>/wsgi.py; CMD assumes config.wsgi:application. Edit it in the Dockerfile.',
    !mentions(i, 'gunicorn') && 'Add gunicorn to your dependencies: CMD runs gunicorn.',
    'Set ALLOWED_HOSTS and SECRET_KEY from env; run migrations and collectstatic as a release step (or an entrypoint).',
  ],
};
