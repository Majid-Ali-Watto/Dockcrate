# Dockcrate

Generates Dockerfile, `.dockerignore`, compose, CI/CD pipelines and deployment config for a **new** project: the user picks the stack and options, nothing is read from an existing project (there is no detection). The files can be copied or downloaded in the web UI; the CLI writes them into a project folder. One generator (`src/`), two front ends: the CLI (`bin/dockcrate.js`) and a Next.js 16 web UI (`app/`, `components/`, `lib/`). README.md is the user-facing doc; this file is for working on the code.

## Commands

```sh
node --test                      # all tests (generator, API, services, events, networks, image modes, zip); keep green
npx next build                   # production build of the UI; must pass
npm run dev                      # UI in dev mode (http://127.0.0.1:3000)
node bin/dockcrate.js serve        # production UI on http://localhost:4173 (rebuilds when sources are newer)
node bin/dockcrate.js --help       # CLI flags
npm run icons                    # regenerate every icon + the social image (needs Chrome/Chromium; CHROME_PATH to override)
npm run pins                     # re-resolve the commit SHAs for every GitHub action the generator emits (git + network)
```

Lighthouse (target: 100 in all four categories, mobile and desktop):

```sh
npx lighthouse@12 http://127.0.0.1:4173 --chrome-flags="--headless=new --no-sandbox" --only-categories=performance,accessibility,best-practices,seo
# add --preset=desktop for desktop
```

## Architecture

- `src/generate.js`: `generate(dir, opts)` is pure and returns `{ stack, files, notes }`; `writeFiles` is the only writer. Never write to disk elsewhere.
- Every generated file is a list of **blocks** with stable ids (`src/blocks.js`), so users can edit, disable or add blocks. Keep ids stable; renaming one breaks saved edits.
- `src/stacks/*`: one object per stack (`starter`, `dockerfile`, `dev`, `ci`, `ciSteps`, ...). `src/providers/*`: one renderer per CI provider. `src/deploy.js`: registries and deploy targets.
- Services: a project is one or more **services** (a folder with its own stack, always named by the user). `src/services.js` has `normalizeServices` and `parseServiceSpec`; `resolveServices` in `src/generate.js` gives one service named `app` at the root (from `opts.stack`) or the explicit `services` list; `buildUnit` works out one service from its own options (the global ones are its defaults; port, runtime, tool, buildDir are refused globally when there are several). `generate()` returns `services` and `multi`. The `dir` argument of `generate()` is only the folder the files will be written to: it is consulted for an existing compose file name and its basename names the project, never for detecting anything.
- The pipeline description (`buildPipeline` in `src/ci.js`) carries `apps` (one per service, enriched by `deployApps` in `src/deploy.js` with `imageEnv`, `composeImage`, `name`, `k8sDir`, ...). Renderers never assume one app: GitHub/Gitea group services with identical test steps into a matrix job (`testGroups`) and use matrices for image/lint/CodeQL; script providers unroll per-service jobs through `shellPlan(p, app, vars)` and `deployPlan`. `stepsInDir` (`providers/common.js`) makes setup steps work from a service folder. Deploy targets' `script`/`files` take `{ apps }` and loop. A new provider or target must handle `apps.length > 1`.
- Deployments (`opts.deployTo`, `parseDeployments` in `src/ci.js`): `p.deployments` is always a list (the classic `environment`/`deployOn` is a list of one, id `deploy`; several are `deploy-<name>`); renderers loop over it and call `deployPlan(p, deployment, vars)`; compose overrides per deployment come from `composeFor` in `generate()`. Bitbucket puts each deployment in the branch/tag pipelines it belongs to.
- Changed-only (`opts.changedOnly`, `sharedPaths`): `changedLines`/`changedGuard` in `providers/common.js` are the one detection script (CHANGED is `,all,` or `,api,web,`); each provider decides in a job of its own and skips with its native mechanism (GitHub: dynamic matrices from outputs; others: guards or `when`/`condition`). Deploy scripts gate each service through `changedHead`/`gate` in `src/deploy.js`. `test/services.test.js` runs the real script against a git repository: keep that test passing when you touch it.
- Database per service (`opts.dbPerService`): `assignDatabases`, `dbUrl`, `dbInitFiles` in `src/compose.js`; only effective with more than one service.
- Image build (`opts.imageVariant`, `multistage`, `stageMode`): `buildOf` in `src/generate.js` resolves `{ variant, mode }` (`multi` | `production` | `mixed`) per service and passes it to `stack.dockerfile(info, port, c, build)`, `stack.files(info, port, build)` and `stack.ignore(build, info)` (an array or a function: production-only must let the build output into the context). A stack declares `variants` and `defaultVariant` (the default keeps today's base image), `healthKind(build)` (drives the "no curl or wget" note) and `buildNotes(info, build)`. `container.js` has the flavor helpers (`pkgs`, `systemUser`, `binaryRuntime`). Multi-stage with the default flavor is the pre-existing output except Python, whose build stage now makes a virtualenv; the old single stage is `production`.
- The accuracy notice lives in `components/Accuracy.jsx`, the CLI footer in `bin/dockcrate.js` and the README section "How accurate is it?": keep the three in step, and never claim a check that was not run.
- Pipeline events and inputs: push, tag, pull request, manual, release and schedule are independent options (`branches`/`tags` empty = off); a manual run asks which CI steps to run (`manualSteps` in `buildPipeline`: the steps any service has, GitHub, Gitea, GitLab, Bitbucket, Jenkins and Azure only). Stacks tag the steps of their `ci()` with `ciStep` (a name or a list); `manualGate`/`appCommands` in `providers/common.js` turn that into each provider's own condition (an `if` on GitHub; `RUN_<STEP>` variables or parameters tested by `switchOn` in the shell elsewhere, so a run without the variable, a push, runs the step) and every provider declares the checkboxes in its own syntax (`dispatchInputs` in the GitHub renderer, `variables` on GitLab, `parameters` on Jenkins/Azure, `variables` of the custom pipeline on Bitbucket). A new stack tags every step that belongs to a CI step; a new provider with manual runs must declare them and pass `stepOn` in its `shellPlan` vars. Prefer asking the user (an option with a UI control and a CLI flag) over a fixed value in the output; the compose `restart` policy and the Kubernetes `replicas` were fixed once.
- Networks (`opts.networks`, `appNetworks`, `dbNetworks`, a service's own `networks`): `parseNetworks`/`networksOf` in `src/compose.js` validate and resolve them, `composeFile` writes them; none declared must keep the compose output free of any `networks:` line.
- Environments (`opts.envs`): `composeOverride` in `src/compose.js` (one override file per environment), `stack.dev()` (the `Dockerfile.dev`: `{ dockerfile, workdir, mode: 'mount' | 'watch', volumes }`). Only dev-like environments (`isDevEnv`) get a Dockerfile of their own.
- Routes: `/` is the landing page (`components/Home.jsx`, copy in `lib/home.js`, shared `SiteHeader`/`SiteFooter` with the guide pages; counts of stacks/providers/targets are checked against `getMeta()` in `test/landing.test.js`); the editor is `/generator` (`app/generator/page.jsx`, which also owns `loading.jsx`: a root `loading.jsx` would flash the editor skeleton on every public page and turn unknown URLs into 200s). Every page calls `requireAllowedHost()` (`lib/site.js`). The PWA `start_url` is `/generator`. Lighthouse must be 100 on `/`, `/generator` and the guide pages.
- Mobile: below 900px the editor keeps the desktop sizes for text, fields, dropdowns and buttons (on purpose: it was once enlarged and looked oversized); only the layout changes (the last block of `app/globals.css`). Known trade-off: fields under 16px make iOS Safari zoom in when focused. After a layout change, check phone widths (360, 390, 768) for horizontal overflow, not just Lighthouse.
- Loading skeletons (`components/Skeleton.jsx`, `app/generator/loading.jsx`) are class-only (CSP forbids inline styles) and pulse with opacity (composited). Nothing in the page depends on the server's disk at render time, so the sidebar never rearranges itself when the first preview arrives (a layout that did was a 0.32 CLS once).
- `src/` is plain ESM with **no dependencies**; keep it that way (the CLI runs without `npm install`).
- `src/api.js`: JSON handlers shared by the Next route handlers. `guard()` only accepts localhost `Host` and same-origin `Origin` (CSRF / DNS-rebinding protection); every route and the page go through it. It can only write the generated file names.
- Small UI helpers: `lib/groups.js` (groups the preview's files by service), `lib/zip.js` (the .zip download, no dependency), `lib/client.js` (JSON `post`).
- UI state lives in `lib/form.js` (`initialForm`, `toBody`, `visibility`); controls in `components/Sidebar.jsx` and `Controls.jsx`; preview and block editor in `Preview.jsx` and `BlockEditor.jsx`.
- Head/SEO: `app/layout.jsx` (`generateMetadata`, `viewport`), `app/manifest.js`, `app/robots.js`, `app/sitemap.js`, JSON-LD in `app/page.jsx`. URLs use the request's own origin via `lib/site.js`.
- Guide pages (SEO landing pages, one per thing people search for: `/dockerfile-generator`, `/docker-compose-generator`, `/github-actions-workflow-generator`, `/ci-cd-pipeline-generator`): the copy lives in `lib/landing.js` (`LANDING`), rendered server-side by `components/Landing.jsx` (it calls `requireAllowedHost()` and shows a sample made by the real `generate()`), with one `app/<slug>/page.jsx` per page (a route per slug, not a `[slug]` catch-all). Adding one means a `LANDING` entry, its route folder, and nothing else (the sitemap, the landing page, the footer and the editor sidebar's Guides links read `LANDING`); `test/landing.test.js` checks unique titles, description length (<= 160), that each sample file exists and that each route folder exists. Copy states only what the generator does (README).
- Hosted mode (`isHosted()` in `src/api.js`: Vercel's `VERCEL` env or `DOCKCRATE_HOSTED=1`): the site is public, so `guard()` skips only the Host check. The web UI and `src/api.js` never read or write the server's disk and send no server path to the browser (no folder picker, no write, no existing-file diff: removed on purpose); the CLI is the only writer. Any new feature that reads or writes the **server's** disk, or exposes a server path, must be refused/hidden when hosted, with a test in `test/api.test.js`. Origins for canonical/OG/sitemap come from `lib/site.js` (`SITE_URL` > Vercel production domain > request host).
- Own deployment (this repo, not generated output): `.github/workflows/deploy.yml` tests, builds `Dockerfile`, pushes `vcr.vercel.com/<team>/<project>/dockcrate:<sha>` and deploys it with a generated `Dockerfile.vercel` (`FROM` that image); `vercel.json` disables Vercel's Git deploys. A `prune-old-images` job (after `deploy-production`) keeps the two newest SHA-tagged images in the VCR repository and deletes the rest. The Dockerfile must keep `DOCKCRATE_HOSTED=1` (`test/deploy-files.test.js`), and the workflow's actions stay SHA-pinned.
- Security: `proxy.js` (nonce CSP, Next 16 name for middleware) and `next.config.mjs` (static headers).

## Keep everything in sync

A change is not done until the places below agree. Update them in the same change.

| When you change | Also update |
| --- | --- |
| A CLI option or generator option | `bin/dockcrate.js` (parseArgs flag **and** `HELP` text), validation in `src/generate.js`/`src/api.js`, `lib/form.js` + the Sidebar control, README option tables, tests. Decide whether it is per service (`SERVICE_KEYS`, `SINGLE_ONLY` in `src/generate.js`, `cleanService` in `src/api.js`, `components/Services.jsx`) or project-wide |
| A stack | `src/stacks/index.js`, `lib/form.js` (`STACK_ORDER`, `RUNTIMES`), README stack lists, tests, CodeQL/Dependabot hooks if applicable, its `dev()` (the every-stack test in `test/services.test.js` fails without one), and its `variants`/`defaultVariant` and the three build modes (`test/image.test.js` runs every stack through all of them) |
| A CI provider or deploy target | `src/ci.js` (`CI_FILES`), `src/deploy.js`, README provider/target tables, `lib/form.js` labels, tests; the several-services tests in `test/services.test.js` (jobs per service, per-service images, `multiNote`) |
| A GitHub action added or its version bumped (`uses:` in `src/`) | `npm run pins` (rewrites `src/providers/pins.js`), then `node --test`; an action without a pin silently ships as a movable tag |
| A security tool version in generated output (Trivy, cosign, Hadolint) | check it against current advisories first (Trivy tags 0.0.1-0.34.2 and image 0.69.4+ were compromised in March 2026); the Trivy test in `test/generate.test.js` guards this |
| Generated output text | the matching assertions in `test/generate.test.js` (many match exact generated text) |
| The name, tagline or description | `package.json`, `app/layout.jsx`, `app/manifest.js`, JSON-LD in `app/page.jsx`, `scripts/build-icons.mjs` (social card), README, then `npm run icons` |
| The logo or brand colors | `scripts/build-icons.mjs` only, then `npm run icons`; never hand-edit files in `public/icons`, `public/logo.svg`, `public/og-image.png`, `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png` |
| Colors / theme | both dark palettes in `app/globals.css` (`:root[data-theme=dark]` **and** the `prefers-color-scheme` block), `viewport.themeColor` in the layout, manifest colors |
| Page metadata, icons, social tags | `app/layout.jsx` first; check the rendered `<head>` (`curl -s http://127.0.0.1:4173/ \| grep -oE '<(meta\|link)[^>]*>'`) |
| CSP, headers, scripts or styles added to the page | `proxy.js` / `next.config.mjs`; confirm there are no CSP violations (see Verify) |
| Anything that touches the disk, local paths or the Host check | hosted-mode refusal in `src/api.js`, `test/api.test.js` hosted tests, README "Deploying to Vercel" |
| Project structure or commands | README "Layout", and this file |

## Verify before saying done

1. `node --test` passes.
2. `npx next build` passes.
3. UI or head changed: run the app and check headless Chrome for CSP/console errors, then run Lighthouse (above). Anything below 100 is a regression to fix, not accept.
   ```sh
   google-chrome --headless=new --no-sandbox --enable-logging=stderr --v=0 --virtual-time-budget=10000 --dump-dom http://127.0.0.1:4173/ 2>&1 >/dev/null | grep -iE "content security|violat|uncaught|error"
   ```
4. Anything hosted-related changed: simulate Vercel with `VERCEL=1 npx next build && VERCEL=1 npx next start -H 127.0.0.1 -p 4173` and `curl -H 'Host: example.vercel.app'` the page and `/api/*` (no local path in the HTML). Rebuild without `VERCEL` afterwards.
5. Icons/logo changed: look at the regenerated PNGs, not just the exit code.

## No images or containers for testing

Do **not** run `docker build`, `docker run`, `docker compose up`/`pull` or anything else that builds an image or starts a container to test a change, unless the user explicitly asks for it. Pulling base images is slow and uses a lot of bandwidth, and the tests do not need Docker. Verify generated files by reading them, with `node --test`, by parsing the YAML, and with `docker compose config` (it pulls nothing). If you were asked to build something, say what you built and remove the images and containers afterwards.

## Gotchas

- Scripts must carry the CSP nonce: the only inline script is the theme script in `app/layout.jsx` (reads `x-nonce` set by `proxy.js`). `style-src` is `'self'` only in production: do not add inline `<style>` or `style=` attributes. In `npm run dev` the CSP also allows `'unsafe-inline'` styles because Next's own dev tools (the overlay and the dev indicator) apply inline styles and would otherwise log "Applying inline style violates ... style-src 'self'"; that hides our own mistakes in dev, so always check the production build (`npx next build` + `serve`) for CSP errors. `experimental.inlineCss` was tried and rejected: Next emits an un-nonced `<style>` (blocked by the CSP) and it raised mobile TBT enough to drop Performance to 98-99.
- Theme: the saved choice lives in `localStorage` (`dockcrate-theme`) and is applied by the inline script in `app/layout.jsx`, which also points the `color-scheme` meta tag at it. Without that, the first paint of every page followed the OS (a dark flash on each navigation for someone on Light, found by capturing screencast frames while throttled). Keep both when touching the script.
- `proxy.js` also overrides `Cache-Control` to `private, no-cache` (Next's default `no-store` disables the back/forward cache). API responses use the same.
- Turbopack ignores `*.alt.txt` next to file-based social images, so the Open Graph / Twitter image is `public/og-image.png` declared in `generateMetadata` (with alt text) instead of `app/opengraph-image.png`.
- Setting `metadata.icons` replaces file-based `icon.svg`/`apple-icon.png` links, so the layout lists them explicitly (`favicon.ico` is still added from the file).
- The proxy matcher skips `/api`, `/_next` and any path with a dot, so static files get headers from `next.config.mjs` only.
- Remaining Lighthouse notes are unscored and come from the Next/React runtime, not app code: unused JS and legacy-JS polyfills in the framework chunks, and the ~40 ms stylesheet request. Our own heavy parts (block editor, zip) are lazy-loaded.
- Generated pipelines must not ship movable references to third-party code: actions are SHA-pinned (`pinActions`, default on, GitHub only) and tool images carry explicit tags, never `latest`.
- Do not `pkill -f <pattern>` from a shell command that contains that pattern; it kills the shell. Stop a server by its port instead.
