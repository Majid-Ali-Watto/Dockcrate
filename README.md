# Dockcrate

Generates the Dockerfile, `.dockerignore`, `docker-compose.yml`, CI/CD pipeline and deployment config for a **new project**: you choose the stack and the options, preview the files, then download them or add them straight into a project folder. Nothing is read from an existing project. Two front ends share one generator: a **CLI** and a **Next.js web UI**.

```sh
npm install                   # once (the CLI itself needs nothing; the web UI needs Next)
npm link                      # puts `dockcrate` on your PATH (or: node bin/dockcrate.js ...)

dockcrate --stack react --tool pnpm ./shop            # write the files into ./shop (created if missing)
dockcrate --stack django --dry-run                    # print them instead
dockcrate serve                     # web UI at http://localhost:4173
```

## Web UI

`dockcrate serve` runs the Next.js app (`next start`, bound to 127.0.0.1). It rebuilds itself first when the sources are newer than the build. `npm run dev` runs it in development mode.

The UI fills the window: controls on the left (scrolling on their own), a live preview on the right. Controls appear only when they apply: a static site has no database or OS-package options, FastAPI has no build-folder field, GitLab hides GitHub-only settings, unticking the CI file group hides CI, deployment and trigger options, and a file that is not in the project folder yet is shown full width with no empty "Existing" pane.

- **A project**: pick stack, package manager / build tool, name, runtime and the rest. **Add the files to a project** (optional) takes the project folder (**Browse…** or paste a path): **Write files to folder** puts them straight into it, creating the folder if needed. Each generated file is shown next to the file already in that folder, with changed lines highlighted, and existing files are never overwritten unless you tick **Overwrite**. Without a folder, copy or download the files.
- **Several services**: **Split into several services** opens a **Services** panel (name, folder, stack, port and optional own databases per service, add / remove / back to one service). **Environments** adds a compose file per environment. Both show skeleton placeholders while the page, the preview or the block editor are still loading.

The page is built to score 100 in Lighthouse (performance, accessibility, best practices, SEO), on mobile and desktop: metadata, Open Graph / Twitter card, canonical, `robots.txt`, `sitemap.xml`, web manifest, favicon and app icons, JSON-LD; a nonce-based Content-Security-Policy (`proxy.js`) plus frame/sniffing/referrer headers (`next.config.mjs`); gzip on large API responses; a light / dark / system theme switch.

The API is Next route handlers (`app/api/*`) over `src/api.js`. It only answers requests whose `Host` is localhost and whose `Origin` (if any) is the same origin, and it can only write the generated file names into the folder you give it.

## What you can control

| Area | Options |
| --- | --- |
| Stack | node (Express/Nest, …), react, vue, angular, fastapi, django, .NET, Java, Go, Rust, PHP (Laravel/Symfony/plain Composer), Ruby (Rails/Rack); tool: npm/yarn/pnpm, pip/uv/poetry, maven/gradle; runtime, port, name, build folder |
| Files | Dockerfile (+`nginx.conf`), `.dockerignore`, compose (+`.env.example`), CI pipeline, deployment config; opt-in extras: Dependabot (Renovate off GitHub), dev container, Makefile, `.editorconfig` |
| Image build | base image flavor (`alpine` or `slim`), multi-stage (default) or one stage: production only, or build and production mixed |
| Container | healthcheck path, OS packages (apk/apt), runtime env vars, build args (Node and static sites: `VITE_*`, `NEXT_PUBLIC_*`) |
| Compose services | postgres, mysql, mariadb, mongo, redis, memcached, elasticsearch, rabbitmq, mailpit (health-gated `depends_on`, volumes, URLs; with several SQL engines the first keeps `DATABASE_URL` and the others get `POSTGRES_URL` / `MYSQL_URL` / `MARIADB_URL`; mysql and mariadb cannot be combined, both use port 3306) |
| CI steps | lint, tests, build, dependency audit, per stack (e.g. ruff/pytest/pip-audit, `dotnet format`, `npm audit`); defaults to what the project already defines |
| CI services | database/queue containers next to the test job, with URLs injected |
| Image | multi-arch platforms, image registry (GHCR / GitLab, Docker Hub, Quay, self-hosted such as Harbor/Nexus/Artifactory, Artifact Registry, ECR, ACR), Trivy scan (fails on HIGH/CRITICAL), SBOM + provenance attestations, cosign keyless signing |
| Code quality & security | Hadolint Dockerfile lint (GitHub, GitLab), CodeQL workflow (GitHub) or the SAST template (GitLab) |
| CI provider | GitHub Actions, GitLab CI, Gitea/Forgejo Actions, Jenkins, Bitbucket Pipelines, Azure DevOps, CircleCI |
| Triggers | every one is a switch you set: push branches (+ignored), tags (+ignored), pull/merge requests (+target branches), path filters, release published, manual runs, any number of cron schedules |
| Pipeline | name, runner/agent, job timeout, pipeline-wide env, concurrency (cancel PR runs / all / queue / off), fine-grained GitHub token permissions, fail-fast, runtime-version and OS test matrix, test job on/off, dependency and layer caches, image tags (branch / tag / semver / latest), Trivy severities |
| Deployment | where to deploy, when (default branch / tag / manual), environment name; or several environments, each with its own branch, tag or manual rule |
| Services | several projects in one repository: a Dockerfile per service folder, one compose file, one pipeline (test matrix per stack, image matrix, one deployment) |
| Environments | `dev`, `qa`, `staging`, `prod` or your own: a compose override per environment, a `Dockerfile.dev` per service for `dev` |

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

### Image flavor and build mode

`--image alpine|slim` picks the base image (default: what each stack normally uses: alpine for Node, Go, Rust and static sites; slim, i.e. Debian-based, for the rest). `--no-multistage` builds one stage instead of a build stage plus a runtime stage, and `--single-stage production|mixed` says which one stage (default `production`). In the UI: **Image**.

| | multi-stage (default) | one stage, production only | one stage, build and production mixed |
| --- | --- | --- | --- |
| What it is | a build stage with the tools, a small runtime stage that copies the result | the runtime image only: production dependencies, no build tools | the build tools and the app in one image |
| Node | install, build, copy | installs production dependencies, copies the project: **build first** (TypeScript) | installs everything, builds, runs the server; keeps devDependencies |
| React, Vue, Angular | node builds, nginx serves | nginx copies your `dist/`: **build first** | node builds, `serve` serves it (no nginx) |
| Python | compilers and a virtualenv in the build stage, the runtime copies the virtualenv | pip/uv/poetry install straight into the image, no compilers | compilers and development dependencies stay |
| Go, Rust | toolchain builds, a small alpine or debian-slim image runs the binary | copies the binary you built (`app`; Rust: `target/.../release/<name>`): **build first** | the toolchain builds and runs it |
| Java | JDK builds the jar, JRE runs it | copies the jar from `target/` or `build/libs/`: **build first** | the JDK builds and runs it |
| .NET | SDK publishes, ASP.NET runs it | copies `publish/`: **build first** | the SDK publishes and runs it |
| PHP | composer in one stage, Apache in the next | copies the project with its `vendor/`: **install first** | composer, git and dev packages stay in the Apache image |
| Ruby | compilers and gems in the build stage | compilers are installed and removed in the same layer as the gems | compilers and every gem stay |

The notes say exactly what to run before `docker build` in production-only mode, and `.dockerignore` stops ignoring the build output (`dist/`, the Rust binary, the jar, `vendor/`) for it. The generated pipeline still builds the image from the repository as it is, so with a compiled language in production-only mode add a build step before the image job (the test job's build step shows the commands) or use multi-stage. Alpine uses musl: Python packages without a musl wheel compile from source, and PHP has no Alpine variant here because the image runs Apache (asking for it is reported and slim is used). Temurin publishes Alpine images for some Java versions only. A service in `--services` can set its own `imageVariant`, `multistage` and `stageMode`.

### Several services

A repository with a Vue front end and two Django services, or five microservices, is one project with several **services**: a folder each, its own stack and its own Dockerfile, shipped together by one compose file, one pipeline and one deployment.

```sh
dockcrate ~/code/shop --service api=./api:django@8000 --service web=./web:vue --db postgres
dockcrate ~/code/shop --services services.json   # every option per service (see below)
```

Every service names its stack (`name=dir:stack[@port]`, or an object in the JSON file / the UI panel); nothing is scanned or detected.

| Output | With several services |
| --- | --- |
| Dockerfile, `.dockerignore`, `nginx.conf` | in each service folder (`api/Dockerfile`), built with that folder as the context |
| Compose | one file; `build: ./api` per service, shared databases (`depends_on` health-gated), host ports kept unique (the second service on 8000 is published on 8001), services reach each other by name (`http://api:8000`) |
| GitHub / Gitea | services whose test steps are identical share one job with a matrix over `service` (`test-django`), the others get their own (`test-web`); the image job is a matrix over services (`<registry>/<service>`); setup actions cache from the service folder; one deploy job; CodeQL runs a matrix over the languages in use; Hadolint lints every Dockerfile |
| GitLab, Jenkins, Bitbucket, Azure, CircleCI | a test job and an image job per service, one deploy |
| Images | one per service: `ghcr.io/<repo>/<service>`, `<user>/<project>-<service>` on Docker Hub, `<ECR_REPOSITORY>/<service>` on ECR |
| Deploy | `ssh`: `API_IMAGE=… WEB_IMAGE=… docker compose pull && up -d`; `kubernetes`: `k8s/<service>/deployment.yaml` + `service.yaml`; `ecs`: `ecs/<service>/task-definition.json`; `cloudrun`, `ecs`, `azure`: `<NAME>-<service>`; `fly`: a `fly.toml` and app per service folder |
| Dependabot, Makefile | an ecosystem entry per service folder; build targets per service. A dev container targets one stack, so none is generated for several services |

#### Only what changed

`--changed-only` (UI: **Only what changed**) tests, builds and deploys just the services whose folder changed since the last push (or since the pull request's base). A change in the pipeline file or in `--shared-paths` (`libs/**,package.json`) rebuilds everything, and so do tags, schedules, manual runs and any run that cannot tell what changed (a new branch, a clone without the base commit), so your first deploy is a full one.

| Provider | How |
| --- | --- |
| GitHub, Gitea | a `changes` job (`git diff`, no third-party action) outputs `any`, `changed` and the matrices: the test, lint and image matrices are built from the changed services only, and a job with nothing to do is skipped |
| GitLab | a `changes` job in `.pre` leaves `CHANGED` in a dotenv artifact; each service job starts with a guard that exits when its service is unchanged |
| Jenkins | a first stage sets `env.CHANGED`; stages carry `when { expression { ... } }` |
| Bitbucket | a first step writes `changed.env` as an artifact (manual pipelines use `changes-all`); each step reads it and exits when its service is unchanged |
| Azure | a `changes` job publishes `changed` as an output variable; jobs have a condition on it |
| CircleCI | a `changes` job persists `changed.env` to the workspace (`all: true` in the scheduled workflow); jobs halt when their service is unchanged |

Deploys follow: `ssh` runs `docker compose pull/up -d <changed services>`, and the Kubernetes, ECS, Cloud Run, Azure and Fly scripts skip the services that did not change (`DEPLOY_SERVICES` is `,all,` or `,api,web,`); a run where nothing changed deploys nothing. The services that did not change keep what is running.

#### A database per service

`--db-per-service` (UI: **A database per service**) gives every service its own database on the shared server: `postgres://…/api`, `…/billing`, `mongodb://mongo:27017/api`, and a numbered redis database each (`redis://redis:6379/0`, `/1`, up to 16). For postgres, mysql and mariadb an `db/<engine>/init.sql` creates the databases (mysql and mariadb also grant them to the `app` user) and is mounted into the container. The engines run it only when the data volume is first created: for a service added later, run the `CREATE DATABASE` by hand or recreate the volume. memcached, Elasticsearch, RabbitMQ and Mailpit stay shared; separate their data inside the app.

Options are defaults for every service (`--db`, `--healthcheck`, `--packages`, `--env`, `--build-arg`, `--ci-steps`, test OS, registry, …); a service object can override `port`, `runtime`, `tool`, `buildDir`, `healthcheck`, `packages`, `env`, `buildArgs`, `db`, `ciSteps`, `testVersions` and, for a new project, `project` (the Django package, .NET project or Angular output name):

```json
[
  { "name": "api",    "dir": "api",     "stack": "django", "port": 9000, "db": ["postgres"], "healthcheck": "/health" },
  { "name": "ledger", "dir": "billing", "db": ["mysql"], "packages": ["curl"], "testVersions": ["3.12", "3.13"] },
  { "name": "web",    "dir": "web",     "stack": "vue" }
]
```

`--port`, `--runtime`, `--tool` and `--build-dir` belong to one service and are refused when there are several; `--test-versions` is only accepted for one stack. A CI step list for the whole project is trimmed per service, and the notes say what was left out. For a **new** project every service names its stack (`--services` with `"stack"` for each), and no folder is read.

### When the pipeline runs

Every event is its own choice (UI: **When the pipeline runs**), so a pipeline can be exactly what you need:

| Event | Option | Notes |
| --- | --- | --- |
| A push to a branch | `--branches main,develop` (`--no-push` for none) | globs allowed, `--branches-ignore`, path filters |
| A tag is pushed | `--tags 'v*'` (`--no-tags` for none) | `--tags-ignore` |
| A pull / merge request | on by default, `--no-pr` for none | `--pr-branches` for the target branches |
| A manual run | `--manual` | asks which CI steps to run (below) |
| A release is published | `--release` | GitHub only |
| A schedule | `--schedule "0 3 * * *"` | repeatable |

A manual-only pipeline is `--manual --no-push --no-tags --no-pr`: it needs no push. With nothing ticked there would be no trigger, which is refused.

A manual run asks which CI steps to run: one checkbox per step of the test job (`--ci-steps`: lint, test, build, audit), all ticked, and an unticked step is skipped (every other event runs them all). It is `workflow_dispatch.inputs` on GitHub and Gitea, prefilled `RUN_<STEP>` variables on GitLab and Bitbucket, `booleanParam`s on Jenkins and `parameters` on Azure; CircleCI has no manual trigger here. Services each have their own steps, so the run offers every step any of them has. A step that serves two (the Java build command and the .NET build both build and test) runs while either is ticked. With several manual deployments GitHub also asks which environment to deploy.

`--restart <policy>` sets the compose restart policy and `--replicas <n>` the Kubernetes replicas, which used to be fixed.

### Networks

By default every compose service sits on compose's one default network. Declare networks to separate them (UI: **Networks**):

```sh
dockcrate --stack node --db postgres \
  --network frontend --network backend:internal --network shared:external \
  --app-network frontend,backend --db-network backend
```

`--network name[:internal|:external]` is repeatable: `internal` has no route out to the internet, `external` already exists (compose does not create it, so `docker network create <name>` first; the notes say so). `--app-network` is what every service joins and `--db-network` what the databases and queues join; both default to all declared networks. With several services each one can list its own in `--services` (`"networks": ["frontend", "backend"]`) or in the Services panel. A service that is only on internal networks is reported, because the port it publishes is not reachable from the host. Nothing declared means no `networks:` section at all, as before.

### Several deploy environments

One pipeline can deploy to several environments, each with its own rule, job and CI environment:

```sh
dockcrate --deploy ssh --envs qa,prod \
  --deploy-to qa=branch:develop --deploy-to staging=branch --deploy-to production=tag:v* --deploy-to hotfix=manual
```

`name=branch|tag|manual[:match]`: `branch` alone is the default branch, `branch:develop` or `branch:release/*` a branch or prefix, `tag` any tag, `tag:v*` a tag prefix, `manual` a run you start (with two or more manual environments GitHub asks which one). Each gets a job `deploy-<name>` (a stage, step or deployment on the other providers) in its own GitHub/GitLab environment, so secrets and variables with the same names can hold each environment's values (the notes say where other providers need separate variables). `ssh` layers the compose override of the same name (`production` finds `prod`, `staging` finds `stage`), so `qa` runs `docker compose -f docker-compose.yml -f docker-compose.qa.yml`. The match is an exact name or a prefix ending in `*`, and the notes say when an environment's branch or tag is not among the pushed ones and would never run. `--deploy-to` replaces `--deploy-on` and `--environment`. In the UI: **Deploy to several environments**.

### Environments

`--envs dev,qa,prod` adds one compose file per environment, layered over the base file (`docker compose -f docker-compose.yml -f docker-compose.prod.yml up`; an existing `compose.yaml` keeps its name: `compose.prod.yaml`). Works for one service or many.

- **dev** (also `development`, `local`): a `Dockerfile.dev` per service (dev dependencies, the source bind mounted for live reload; Go and Rust restart through `docker compose watch`), the override builds it, publishes the databases and never restarts.
- **everything else** (`qa`, `staging`, `prod`, …): the production Dockerfile, plus `restart: always`, log rotation and an optional `.env.<name>`. Only dev gets its own Dockerfile because the others are the same image.
- the `ssh` deploy layers the override that matches the environment it deploys to (`--environment` or each `--deploy-to`: `production` ↔ `prod`, `staging` ↔ `stage`, or the exact name); other environments are for running compose by hand.

### Image registry

`--registry` (or **Image registry** in the UI) picks where the image is pushed: `builtin` (GHCR / GitLab registry, the default), `dockerhub`, `quay`, `custom` (any registry host, e.g. Harbor, Nexus, Artifactory, Gitea), `gar`, `ecr` or `acr`. The cloud registries sign in with the same steps as their deploy target, including OIDC on GitHub. The Cloud Run, ECS and Azure targets always use their own registry, Fly builds the image itself, and `ssh` needs a username/token registry because the server logs in again to pull.

Each run lists exactly which secrets and variables to create. Ticking `id-token: write` on a cloud target switches its login from a stored key to OIDC (GitHub only). Deploy jobs run in an environment and are serialised.

## Deploying to Vercel

The site is deployed by CI/CD, not by Vercel's Git integration (`vercel.json` sets `git.deploymentEnabled` to `false`). On every push to `main`, `.github/workflows/deploy.yml` tests, builds the `Dockerfile`, pushes the image to Vercel Container Registry (`vcr.vercel.com/<team>/<project>/dockcrate:<commit>`), waits for VCR to optimize it, and deploys that image. Pull requests only test and build.

After a successful deploy, a `prune-old-images` job keeps the two newest images the workflow pushed (the one just deployed and the one before it, for rollback) and deletes the older ones from the registry. It only touches images tagged with a full commit SHA, and it refuses to delete anything if the image it just deployed is not among the two newest.

Vercel has no "deploy this image" flag, so the deploy step is a `Dockerfile.vercel` (`FROM` the pushed image) that Vercel builds from an otherwise empty folder (`vercel deploy --prod`, not `--prebuilt`: a local `vercel build` produces no container and the site would 404): what runs is exactly the image that was pushed. To set it up:

- GitHub variables `VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`, `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME`, and the secret `VERCEL_TOKEN`; a GitHub environment named `production`;
- on the Vercel team, a VCR OIDC policy with read-write access to the project (the push logs in with GitHub OIDC, no stored key);
- on the Vercel project, the Framework Preset "Container" (with "Other" the deployment is Ready but serves a 404); `SITE_URL` is optional (see `.env.example`).

The image sets `DOCKCRATE_HOSTED=1` itself (a container may not get Vercel's `VERCEL` variable). `docker run -p 3000:3000` works anywhere else.

A server you don't own has no project folders, so the hosted site runs in **hosted mode** (switched on by Vercel's `VERCEL` variable, or by `DOCKCRATE_HOSTED=1`, which the `Dockerfile` sets):

- pick a stack and options, then copy, download (.zip) or edit the files;
- folder browsing and writing to a folder are refused by the API (and hidden in the UI), and no server path is ever sent to the browser;
- cross-site requests are still rejected; the page, `robots.txt`, `sitemap.xml`, canonical and Open Graph URLs use `SITE_URL`, else the production domain, else the request's own host (preview deployments are noindexed by Vercel);
- to write the files into a project folder, run Dockcrate locally (`dockcrate serve` or the CLI).

## CLI

`dockcrate [dir] [options]` — run `dockcrate --help` for the full list. Everything in the table above has a flag, for example:

```sh
dockcrate --stack fastapi --tool uv --deploy cloudrun --permissions id-token-write \
    --ci-steps lint,test,audit --ci-services postgres --scan \
    --healthcheck /health --packages libpq5 --env LOG_LEVEL=info --test-versions 3.12,3.13
```

Supply chain: GitHub workflows reference every action by full commit SHA with the tag as a comment (`--no-pin-actions` for plain tags; Gitea never pins; `npm run pins` re-resolves the SHAs, and the Dependabot extra keeps them current). Trivy is only ever emitted at versions outside the March 2026 compromise (trivy-action 0.35.0, image 0.69.3). Next.js apps get a dedicated image: with `output: 'standalone'` in `next.config.*` the runtime stage ships only the traced server, `.next/static` and `public/`; without it the image runs `next start -H 0.0.0.0`, because the usual `-H 127.0.0.1` start script would make the container unreachable.

Supply-chain and extras flags: `--registry dockerhub`, `--lint-dockerfile`, `--sbom`, `--sign`, `--code-scan`, `--extras dependabot,devcontainer,makefile,editorconfig`. SBOM and signing are GitHub-only; CodeQL covers node, python, java, .NET, go, rust and ruby (not PHP).

`--dry-run` prints instead of writing, `--only dockerfile,ci` limits the file groups, `--force` overwrites. Anything the tool had to guess is printed as a note.

Nothing is switched on or off behind your back: a setting that cannot work (for example a deploy-on-tag rule with no tag trigger) is reported in the notes instead of being rewritten, and an option the chosen provider cannot express is named in the notes and left out.

## How accurate is it?

Treat the output as a very good first draft: a few small edits after you download it are normal.

- **Dockerfile, `.dockerignore`, compose: high for standard projects.** The stack, runtime version, port and commands are assumed from what you pick (the notes say which assumptions were made, for example the entry point or the scripts your CI steps call). Custom build steps, private registries or packages, native libraries and unusual layouts need your input.
- **CI pipelines: good, not run for you.** The structure follows each provider's conventions and the generated files are syntax-checked (see the last paragraph of this README for what was validated and how), but they have not run on your CI: secrets, runner labels, branch rules and test commands often need a tweak.
- **Deployment files: templates.** No deploy target has been run against a real cloud account or server; adjust names, regions, resources and permissions.
- **New options need the same care:** the image flavors and build modes were checked by generating every stack in every combination and by real `docker build`s of the six Node combinations and of the Python multi-stage image (this machine has no BuildKit and a slow registry link, so everything else, including every production-only and mixed variant of the compiled stacks, was checked by reading the output, not by building it).

The UI shows this next to the notes, the CLI prints it after them, and every guess or limitation of a run is listed in the notes. Edit any block in the preview (or the files afterwards): edits survive option changes.

## Layout

```
bin/dockcrate.js      CLI; `serve` launches Next
src/                  the generator (plain ESM, no dependencies)
  generate.js         validate/assemble                 stacks/     per-stack Dockerfile, Dockerfile.dev, CI steps
  services.js         parsing and normalising services  deploy.js   registries and deploy targets
  ci.js               the pipeline description          providers/  one renderer per CI provider (+ pins.js: action SHAs)
  compose.js          compose, networks, environments   container.js healthcheck/packages/env/args, image flavors
  blocks.js           the editable blocks               extras.js   Dependabot/Renovate, devcontainer, Makefile, .editorconfig
  api.js              JSON handlers + request guard     fsutil.js   line-joining helpers
app/                  Next.js (App Router): page, /api/generate, /api/browse, metadata (layout, manifest, robots, sitemap, icons), loading skeleton
components/ lib/      UI (React client components, form state, diff, zip, grouping files by service, site origin)
proxy.js              per-request Content-Security-Policy (nonce)
Dockerfile            the hosted site image; .github/workflows/deploy.yml tests, pushes it to VCR and deploys it; vercel.json turns Vercel's Git deploys off
public/               logo, social image, PNG icons (generated)
scripts/              build-icons.mjs (`npm run icons`, needs Chrome) and update-pins.mjs (`npm run pins`, needs git and network)
test/                 node:test: generator, API, services, events, networks, image build modes, zip
```

Adding a stack means one object in `src/stacks/` (`starter`, `dockerfile(info, port, c, { variant, mode })` (all three modes, see above), `variants`/`defaultVariant`, `dev` (the `Dockerfile.dev`), `ci`, its `ciSteps`/`ciDefaults`, and optionally `ecosystem`, `codeql`, `devcontainer` for the extras and CodeQL) plus a line in `src/stacks/index.js`.

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
