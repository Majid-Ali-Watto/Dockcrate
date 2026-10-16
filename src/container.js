// Container-level options every stack's Dockerfile can honour. `c` is the normalised form from generate.js:
// { healthcheck: '/health' | '', packages: ['curl'], env: [['KEY', 'value']], buildArgs: [{ name, value? }] }

const OPTIONS = '--interval=30s --timeout=3s --start-period=15s --retries=3';
const simple = /^[\w./:@+-]+$/;

export const envLines = (c) => c.env.map(([key, value]) => `ENV ${key}=${JSON.stringify(value)}`);

/** ARG + ENV pairs for values that must exist at build time (NEXT_PUBLIC_*, VITE_*). */
export const argLines = (c) =>
  c.buildArgs.flatMap(({ name, value }) => [
    value == null ? `ARG ${name}` : `ARG ${name}=${simple.test(value) ? value : JSON.stringify(value)}`,
    `ENV ${name}=$${name}`,
  ]);

/** Image flavors: `alpine` (musl, busybox) or `slim` (Debian/Ubuntu based). */
export const VARIANTS = ['alpine', 'slim'];
/** `multi`: build stage + small runtime stage. `production`: one runtime-only stage. `mixed`: one stage with the build tools and the app. */
export const MODES = ['multi', 'production', 'mixed'];
export const DEFAULT_BUILD = { variant: null, mode: 'multi' };

export const apk = (c) => c.packages.length > 0 && `RUN apk add --no-cache ${c.packages.join(' ')}`;

export const apt = (c) =>
  c.packages.length > 0 && [
    'RUN apt-get update \\',
    `    && apt-get install -y --no-install-recommends ${c.packages.join(' ')} \\`,
    '    && rm -rf /var/lib/apt/lists/*',
  ];

/** OS packages with whatever installer the flavor has. */
export const pkgs = (c, variant) => (variant === 'alpine' ? apk(c) : apt(c));

/** The fixed uid and gid of the `app` user the stacks create, so Kubernetes can check runAsNonRoot and match runAsUser. */
export const APP_UID = 10001;

/** A non-root system user `app` (and its group `app`), both with the fixed id, on either flavor. */
export const systemUser = (variant, { uid = APP_UID, home = false } = {}) =>
  variant === 'alpine'
    ? `RUN addgroup -S -g ${uid} app && adduser -S -u ${uid} -G app app`
    : `RUN groupadd --system --gid ${uid} app && useradd --system --uid ${uid} --gid app${home ? ' --create-home' : ''} app`;

/** `USER` by number, not by name: Kubernetes can only enforce runAsNonRoot on a numeric user. */
export const userLine = (uid = APP_UID, gid = uid) => `USER ${uid}:${gid}`;

/**
 * Who the image runs as and what it writes, for the deploy targets (Kubernetes securityContext, ECS user): `uid`/`gid`, the
 * folders that must stay writable (/tmp always; each gets an emptyDir when the root file system is read-only) and whether a
 * read-only root file system works for the stack.
 */
export const runAsOf = (uid, { gid = uid, writable = [], readOnlyRoot = true, why = '' } = {}) => ({ uid, gid, writable: ['/tmp', ...writable], readOnlyRoot, why });

/** First comment of every Dockerfile.dev: it is the one image that runs as root, on purpose. */
export const DEV_ROOT =
  '# Development only: runs as root so the mounted or synced source and the tool caches stay writable. Never deploy it; the production Dockerfile runs as a non-root user.';

/**
 * `kind` is how the image can probe itself: 'wget' (alpine/busybox), 'curl', 'python' (urllib), 'node' (fetch) or 'tcp' (bash only:
 * the .NET and Temurin images ship neither curl nor wget, so the path is not requested there).
 */
export function healthcheck(c, port, kind) {
  if (!c.healthcheck) return null;
  const url = `http://127.0.0.1:${port}${c.healthcheck}`;
  if (kind === 'wget') return `HEALTHCHECK ${OPTIONS} CMD wget -qO /dev/null ${url} || exit 1`;
  if (kind === 'node') {
    const code = `fetch('${url}').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))`;
    return `HEALTHCHECK ${OPTIONS} CMD ${JSON.stringify(['node', '-e', code])}`;
  }
  if (kind === 'curl') return `HEALTHCHECK ${OPTIONS} CMD curl -fsS -o /dev/null ${url} || exit 1`;
  if (kind === 'python') {
    const code = `import urllib.request; urllib.request.urlopen('${url}', timeout=3)`;
    return `HEALTHCHECK ${OPTIONS} CMD ${JSON.stringify(['python', '-c', code])}`;
  }
  return `HEALTHCHECK ${OPTIONS} CMD ${JSON.stringify(['bash', '-c', `exec 3<>/dev/tcp/127.0.0.1/${port}`])}`;
}

/**
 * Runtime stage for a binary (Go, Rust): a small image that keeps healthchecks, OS packages and a non-root user available.
 * `copy` is the Dockerfile line that puts the binary at `binary` (from the build stage, or from the build context).
 * alpine: `alpine:3` (the binary must be static or musl); slim: `debian:bookworm-slim` (no curl or wget, so the probe only checks the port).
 */
export function binaryRuntime(c, port, variant, copy, binary = '/usr/local/bin/app') {
  const alpine = variant === 'alpine';
  return [
    alpine ? 'FROM alpine:3 AS runtime' : 'FROM debian:bookworm-slim AS runtime',
    alpine
      ? ['RUN apk add --no-cache ca-certificates tzdata', apk(c)]
      : apt({ packages: ['ca-certificates', 'tzdata', ...c.packages] }),
    systemUser(variant),
    copy,
    userLine(),
    `ENV PORT=${port}`,
    envLines(c),
    `EXPOSE ${port}`,
    healthcheck(c, port, alpine ? 'wget' : 'tcp'),
    `ENTRYPOINT ["${binary}"]`,
  ];
}

/** The classic runtime stage: alpine, binary from the build stage's /out/app. */
export const alpineRuntime = (c, port, binary = '/usr/local/bin/app') => binaryRuntime(c, port, 'alpine', `COPY --from=build /out/app ${binary}`, binary);
