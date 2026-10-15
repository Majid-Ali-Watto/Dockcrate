# Dockcrate

Generates the Dockerfile, `.dockerignore`, `docker-compose.yml`, CI/CD pipeline and deployment config for a project you already have, or for one you haven't started. Two front ends share one generator: a **CLI** and a **Next.js web UI**.

```sh
npm install                   # once (the CLI itself needs nothing; the web UI needs Next)
npm link                      # puts `dockcrate` on your PATH (or: node bin/dockcrate.js ...)

dockcrate ~/code/my-app             # detect the stack and write the files
dockcrate --new --stack react --tool pnpm ./shop      # a project that doesn't exist yet
dockcrate serve                     # web UI at http://localhost:4173
```

## Web UI

`dockcrate serve` runs the Next.js app (`next start`, bound to 127.0.0.1). It rebuilds itself first when the sources are newer than the build. `npm run dev` runs it in development mode.

The UI fills the window: controls on the left (scrolling on their own), a live preview on the right. Controls appear only when they apply: a static site has no database or OS-package options, FastAPI has no build-folder field, GitLab hides GitHub-only settings, unticking the CI file group hides CI, deployment and trigger options, and a file that doesn't exist yet is shown full width with no empty "Existing" pane.

- **Existing project**: **Browse…** to a folder (subfolders show the stack detected inside), or paste a path. Each generated file is shown next to the file already there, with changed lines highlighted. Existing files are never overwritten unless you tick **Overwrite**.
- **New project**: pick stack, package manager / build tool, name, runtime; the folder is only needed to write, and is created if missing.

The page is built to score 100 in Lighthouse (performance, accessibility, best practices, SEO), on mobile and desktop: metadata, Open Graph / Twitter card, canonical, `robots.txt`, `sitemap.xml`, web manifest, favicon and app icons, JSON-LD; a nonce-based Content-Security-Policy (`proxy.js`) plus frame/sniffing/referrer headers (`next.config.mjs`); gzip on large API responses; a light / dark / system theme switch.

The API is Next route handlers (`app/api/*`) over `src/api.js`. It only answers requests whose `Host` is localhost and whose `Origin` (if any) is the same origin, and it can only write the generated file names into the folder you give it.

## What you can control

| Area | Options |
| --- | --- |
| Stack | node (Express/Nest, …), Next.js (standalone output detected), react, vue, angular, fastapi, django, .NET, Java, Go, Rust, PHP (Laravel/Symfony/plain Composer), Ruby (Rails/Rack); tool: npm/yarn/pnpm, pip/uv/poetry, maven/gradle; runtime, port, name, build folder |
| Files | Dockerfile (+`nginx.conf`), `.dockerignore`, compose (+`.env.example`), CI pipeline, deployment config; opt-in extras: Dependabot (Renovate off GitHub), dev container, Makefile, `.editorconfig` |
| Container | healthcheck path, OS packages (apk/apt), runtime env vars, build args (Node and static sites: `VITE_*`, `NEXT_PUBLIC_*`) |
| Compose services | postgres, mysql, mariadb, mongo, redis, memcached, elasticsearch, rabbitmq, mailpit (health-gated `depends_on`, volumes, URLs) |
| CI steps | lint, tests, build, dependency audit, per stack (e.g. ruff/pytest/pip-audit, `dotnet format`, `npm audit`); defaults to what the project already defines |
| CI services | database/queue containers next to the test job, with URLs injected |
| Image | multi-arch platforms, image registry (GHCR / GitLab, Docker Hub, Quay, self-hosted such as Harbor/Nexus/Artifactory, Artifact Registry, ECR, ACR), Trivy scan (fails on HIGH/CRITICAL), SBOM + provenance attestations, cosign keyless signing |
| Code quality & security | Hadolint Dockerfile lint (GitHub, GitLab), CodeQL workflow (GitHub) or the SAST template (GitLab) |
| CI provider | GitHub Actions, GitLab CI, Gitea/Forgejo Actions, Jenkins, Bitbucket Pipelines, Azure DevOps, CircleCI |
| Triggers | every one is a switch you set: push branches (+ignored), tags (+ignored), pull/merge requests (+target branches), path filters, release published, manual runs, any number of cron schedules |
| Pipeline | name, runner/agent, job timeout, pipeline-wide env, concurrency (cancel PR runs / all / queue / off), fine-grained GitHub token permissions, fail-fast, runtime-version and OS test matrix, test job on/off, dependency and layer caches, image tags (branch / tag / semver / latest), Trivy severities |
| Deployment | where to deploy, when (default branch / tag / manual), environment name |

### Deployment targets

| Target | Registry | Extra files | Notes |
| --- | --- | --- | --- |
| `registry` (default) | GHCR / GitLab registry | none | build and push only |
| `ssh` | GHCR / GitLab registry | `image:` added to compose | scp the compose file, `docker compose pull && up -d`; pin host keys with `SSH_KNOWN_HOSTS` |
| `kubernetes` | GHCR / GitLab registry | `k8s/deployment.yaml`, `k8s/service.yaml` | kubeconfig in `KUBE_CONFIG`; rollout is awaited; seccomp, no privilege escalation, all capabilities dropped, no service-account token; probes use the health path when set; optional `<app>-env` Secret for `DATABASE_URL` and friends |
| `cloudrun` | Artifact Registry | none | `gcloud run deploy` |
| `ecs` | ECR | `ecs/task-definition.json` | registers a task definition revision, waits for stability |
| `azure` | ACR | none | Web App for Containers |
| `fly` | none (Fly builds it) | `fly.toml` | no image job |

### Image registry

`--registry` (or **Image registry** in the UI) picks where the image is pushed: `builtin` (GHCR / GitLab registry, the default), `dockerhub`, `quay`, `custom` (any registry host, e.g. Harbor, Nexus, Artifactory, Gitea), `gar`, `ecr` or `acr`. The cloud registries sign in with the same steps as their deploy target, including OIDC on GitHub. The Cloud Run, ECS and Azure targets always use their own registry, Fly builds the image itself, and `ssh` needs a username/token registry because the server logs in again to pull.

Each run lists exactly which secrets and variables to create. Ticking `id-token: write` on a cloud target switches its login from a stored key to OIDC (GitHub only). Deploy jobs run in an environment and are serialised.

## Deploying to Vercel

Import the repo in Vercel; the Next.js preset needs no settings (Node 20.9 or newer). Nothing is required, and `SITE_URL` is optional (see `.env.example`).

A server you don't own has no project folders, so the hosted site runs in **hosted mode** (switched on by Vercel's `VERCEL` variable, or by `DOCKCRATE_HOSTED=1` on another host):

- only **New project** is offered: pick a stack and options, then copy, download (.zip) or edit the files;
- folder browsing, reading an existing project and writing to a folder are refused by the API (and hidden in the UI), and no server path is ever sent to the browser;
- cross-site requests are still rejected; the page, `robots.txt`, `sitemap.xml`, canonical and Open Graph URLs use `SITE_URL`, else the production domain, else the request's own host (preview deployments are noindexed by Vercel);
- for an existing project, or to write into a folder, run Dockcrate locally (`dockcrate serve` or the CLI).

## CLI

`dockcrate [dir] [options]` — run `dockcrate --help` for the full list. Everything in the table above has a flag, for example:

```sh
dockcrate --new --stack fastapi --tool uv --deploy cloudrun --permissions id-token-write \
    --ci-steps lint,test,audit --ci-services postgres --scan \
    --healthcheck /health --packages libpq5 --env LOG_LEVEL=info --test-versions 3.12,3.13
```

Supply chain: GitHub workflows reference every action by full commit SHA with the tag as a comment (`--no-pin-actions` for plain tags; Gitea never pins; `npm run pins` re-resolves the SHAs, and the Dependabot extra keeps them current). Trivy is only ever emitted at versions outside the March 2026 compromise (trivy-action 0.35.0, image 0.69.3). Next.js apps get a dedicated image: with `output: 'standalone'` in `next.config.*` the runtime stage ships only the traced server, `.next/static` and `public/`; without it the image runs `next start -H 0.0.0.0`, because the usual `-H 127.0.0.1` start script would make the container unreachable.

Supply-chain and extras flags: `--registry dockerhub`, `--lint-dockerfile`, `--sbom`, `--sign`, `--code-scan`, `--extras dependabot,devcontainer,makefile,editorconfig`. SBOM and signing are GitHub-only; CodeQL covers node, python, java, .NET, go, rust and ruby (not PHP).

`--dry-run` prints instead of writing, `--only dockerfile,ci` limits the file groups, `--force` overwrites. Anything the tool had to guess is printed as a note.

Nothing is switched on or off behind your back: a setting that cannot work (for example a deploy-on-tag rule with no tag trigger) is reported in the notes instead of being rewritten, and an option the chosen provider cannot express is named in the notes and left out.

## Layout

```
bin/dockcrate.js      CLI; `serve` launches Next
src/                the generator (plain ESM, no dependencies)
  generate.js       detect/validate/assemble          stacks/   per-stack detection, Dockerfile, CI steps
  ci.js             GitHub Actions + GitLab CI        deploy.js registries and deploy targets
  extras.js         Dependabot/Renovate, devcontainer, Makefile, .editorconfig
  compose.js        compose + service definitions     container.js healthcheck/packages/env/args
  api.js            JSON handlers + request guard
app/                Next.js (App Router): page, /api/generate, /api/browse, metadata (layout, manifest, robots, sitemap, icons)
components/ lib/    UI (React client components, form state, diff, site origin)
proxy.js            per-request Content-Security-Policy (nonce)
public/             logo, social image, PNG icons (generated)
scripts/            build-icons.mjs: regenerates every icon and the social image (`npm run icons`, needs Chrome)
test/               node:test (generator + API)
```

Adding a stack means one object in `src/stacks/` (`detect`, `starter`, `dockerfile`, `ci`, its `ciSteps`/`ciDefaults`, and optionally `ecosystem`, `codeql`, `devcontainer` for the extras and CodeQL) plus a line in `src/stacks/index.js`.

## Every line is editable

Each generated file is a list of named blocks (a GitHub step, a GitLab job, a Dockerfile stage, one `.dockerignore` line…) with stable ids such as `test.setup-node` or `stage:runtime`. In the UI, **Edit blocks** shows them: rewrite the text, switch a block off, reset it, add a block of your own below any block, switch off a whole file, or add a new file. From the CLI pass `--edits edits.json`:

```json
{
  ".github/workflows/ci.yml": {
    "blocks": { "name": { "text": "name: Ship it" }, "test.setup-node": { "disabled": true } },
    "add": [{ "id": "smoke", "after": "test.npm-ci", "text": "      - run: npm run smoke" }]
  },
  "scripts/release.sh": { "add": [{ "id": "body", "text": "#!/bin/sh\necho release" }] }
}
```

Edits are kept when the options change. A block whose generated text changed after you edited it is flagged **outdated** (you can take the new text); an id that no longer exists is reported in the notes.

## Providers at a glance

| Provider | File | Notes |
| --- | --- | --- |
| GitHub Actions | `.github/workflows/ci.yml` (+ `codeql.yml`) | everything: OIDC, SBOM, cosign, CodeQL, permissions, OS matrix, caches |
| Gitea / Forgejo | `.gitea/workflows/ci.yml` | the GitHub renderer without GitHub-only features |
| GitLab CI | `.gitlab-ci.yml` | rules from the trigger options, SAST template, dind image build |
| Jenkins | `Jenkinsfile` | declarative; Docker Pipeline plugin; secrets as credentials; branch/PR discovery is configured in the multibranch job |
| Bitbucket Pipelines | `bitbucket-pipelines.yml` | reusable steps, one pipeline section per trigger |
| Azure DevOps | `azure-pipelines.yml` | triggers, schedules, matrix, tool installer tasks, deployment job |
| CircleCI | `.circleci/config.yml` | workflow filters, matrix, approval gate for manual deploys |

Only GitHub-only features (SBOM, signing, CodeQL, token permissions…) are skipped on the others, with a note.

## Checks

`npm test` runs the unit tests. The generated files were also validated with actionlint (GitHub and Gitea workflows), `docker compose config`, a YAML parse of every other provider's file, a Groovy syntax check of the Jenkinsfiles (not run on a Jenkins server, nor the Bitbucket/Azure/CircleCI files on their services), and real `docker build` + `docker run` of representative images (the Go, Rust, PHP and Ruby images were built, run and healthchecked; this machine had no BuildKit, so the `--mount` cache flags were stripped for those runs). No deploy target has been run against a real cloud account.
