# Dockcrate

Generates Dockerfile, `.dockerignore`, compose, CI/CD pipelines and deployment config for an existing or a new project. One generator (`src/`), two front ends: the CLI (`bin/dockcrate.js`) and a Next.js 16 web UI (`app/`, `components/`, `lib/`). README.md is the user-facing doc; this file is for working on the code.

## Commands

```sh
node --test                      # all tests (generator, API, zip); keep green
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
- `src/stacks/*`: one object per stack (`detect`, `starter`, `dockerfile`, `ci`, `ciSteps`, ...). `src/providers/*`: one renderer per CI provider. `src/deploy.js`: registries and deploy targets.
- `src/` is plain ESM with **no dependencies**; keep it that way (the CLI runs without `npm install`).
- `src/api.js`: JSON handlers shared by the Next route handlers. `guard()` only accepts localhost `Host` and same-origin `Origin` (CSRF / DNS-rebinding protection); every route and the page go through it. It can only write the generated file names.
- UI state lives in `lib/form.js` (`initialForm`, `toBody`, `visibility`); controls in `components/Sidebar.jsx` and `Controls.jsx`; preview and block editor in `Preview.jsx` and `BlockEditor.jsx`.
- Head/SEO: `app/layout.jsx` (`generateMetadata`, `viewport`), `app/manifest.js`, `app/robots.js`, `app/sitemap.js`, JSON-LD in `app/page.jsx`. URLs use the request's own origin via `lib/site.js`.
- Hosted mode (`isHosted()` in `src/api.js`: Vercel's `VERCEL` env or `DOCKCRATE_HOSTED=1`): the site is public and the server disk is not the user's, so `/api/browse`, existing-project mode and `write` are refused server-side, `getMeta()` hides `cwd`/`home`, `guard()` skips only the Host check, and the UI hides the folder field and write button. Any new feature that reads or writes the disk, or exposes a server path, must be refused/hidden when hosted, with a test in `test/api.test.js`. Origins for canonical/OG/sitemap come from `lib/site.js` (`SITE_URL` > Vercel production domain > request host).
- Security: `proxy.js` (nonce CSP, Next 16 name for middleware) and `next.config.mjs` (static headers).

## Keep everything in sync

A change is not done until the places below agree. Update them in the same change.

| When you change | Also update |
| --- | --- |
| A CLI option or generator option | `bin/dockcrate.js` (parseArgs flag **and** `HELP` text), validation in `src/generate.js`/`src/api.js`, `lib/form.js` + the Sidebar control, README option tables, tests |
| A stack | `src/stacks/index.js`, `lib/form.js` (`STACK_ORDER`, `RUNTIMES`), README stack lists, tests, CodeQL/Dependabot hooks if applicable |
| A CI provider or deploy target | `src/ci.js` (`CI_FILES`), `src/deploy.js`, README provider/target tables, `lib/form.js` labels, tests |
| A GitHub action added or its version bumped (`uses:` in `src/`) | `npm run pins` (rewrites `src/providers/pins.js`), then `node --test`; an action without a pin silently ships as a movable tag |
| A security tool version in generated output (Trivy, cosign, Hadolint) | check it against current advisories first (Trivy tags 0.0.1-0.34.2 and image 0.69.4+ were compromised in March 2026); the Trivy test in `test/generate.test.js` guards this |
| Generated output text | the matching assertions in `test/generate.test.js` (many match exact generated text) |
| The name, tagline or description | `package.json`, `app/layout.jsx`, `app/manifest.js`, JSON-LD in `app/page.jsx`, `scripts/build-icons.mjs` (social card), README, then `npm run icons` |
| The logo or brand colors | `scripts/build-icons.mjs` only, then `npm run icons`; never hand-edit files in `public/icons`, `public/logo.svg`, `public/og-image.png`, `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png` |
| Colors / theme | both dark palettes in `app/globals.css` (`:root[data-theme=dark]` **and** the `prefers-color-scheme` block), `viewport.themeColor` in the layout, manifest colors |
| Page metadata, icons, social tags | `app/layout.jsx` first; check the rendered `<head>` (`curl -s http://127.0.0.1:4173/ \| grep -oE '<(meta\|link)[^>]*>'`) |
| CSP, headers, scripts or styles added to the page | `proxy.js` / `next.config.mjs`; confirm there are no CSP violations (see Verify) |
| Anything that touches the disk, local paths or the Host check | hosted-mode refusal in `src/api.js`, UI hiding (`meta.hosted` in `components/`), `test/api.test.js` hosted tests, README "Deploying to Vercel" |
| Project structure or commands | README "Layout", and this file |

## Verify before saying done

1. `node --test` passes.
2. `npx next build` passes.
3. UI or head changed: run the app and check headless Chrome for CSP/console errors, then run Lighthouse (above). Anything below 100 is a regression to fix, not accept.
   ```sh
   google-chrome --headless=new --no-sandbox --enable-logging=stderr --v=0 --virtual-time-budget=10000 --dump-dom http://127.0.0.1:4173/ 2>&1 >/dev/null | grep -iE "content security|violat|uncaught|error"
   ```
4. Anything hosted-related changed: simulate Vercel with `VERCEL=1 npx next build && VERCEL=1 npx next start -H 127.0.0.1 -p 4173` and `curl -H 'Host: example.vercel.app'` the page and `/api/*` (browse must 404, existing/write must 400, no local path in the HTML). Rebuild without `VERCEL` afterwards.
5. Icons/logo changed: look at the regenerated PNGs, not just the exit code.

## Gotchas

- Scripts must carry the CSP nonce: the only inline script is the theme script in `app/layout.jsx` (reads `x-nonce` set by `proxy.js`). `style-src` is `'self'` only: do not add inline `<style>` or `style=` attributes. `experimental.inlineCss` was tried and rejected: Next emits an un-nonced `<style>` (blocked by the CSP) and it raised mobile TBT enough to drop Performance to 98-99.
- `proxy.js` also overrides `Cache-Control` to `private, no-cache` (Next's default `no-store` disables the back/forward cache). API responses use the same.
- Turbopack ignores `*.alt.txt` next to file-based social images, so the Open Graph / Twitter image is `public/og-image.png` declared in `generateMetadata` (with alt text) instead of `app/opengraph-image.png`.
- Setting `metadata.icons` replaces file-based `icon.svg`/`apple-icon.png` links, so the layout lists them explicitly (`favicon.ico` is still added from the file).
- The proxy matcher skips `/api`, `/_next` and any path with a dot, so static files get headers from `next.config.mjs` only.
- Remaining Lighthouse notes are unscored and come from the Next/React runtime, not app code: unused JS and legacy-JS polyfills in the framework chunks, and the ~40 ms stylesheet request. Our own heavy parts (folder picker, block editor, zip) are lazy-loaded.
- Generated pipelines must not ship movable references to third-party code: actions are SHA-pinned (`pinActions`, default on, GitHub only) and tool images carry explicit tags, never `latest`.
- Do not `pkill -f <pattern>` from a shell command that contains that pattern; it kills the shell. Stop a server by its port instead.
