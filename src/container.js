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

export const apk = (c) => c.packages.length > 0 && `RUN apk add --no-cache ${c.packages.join(' ')}`;

export const apt = (c) =>
  c.packages.length > 0 && [
    'RUN apt-get update \\',
    `    && apt-get install -y --no-install-recommends ${c.packages.join(' ')} \\`,
    '    && rm -rf /var/lib/apt/lists/*',
  ];

/**
 * `kind` is how the image can probe itself: 'wget' (alpine/busybox), 'curl', 'python' (urllib) or 'tcp' (bash only:
 * the .NET and Temurin images ship neither curl nor wget, so the path is not requested there).
 */
export function healthcheck(c, port, kind) {
  if (!c.healthcheck) return null;
  const url = `http://127.0.0.1:${port}${c.healthcheck}`;
  if (kind === 'wget') return `HEALTHCHECK ${OPTIONS} CMD wget -qO /dev/null ${url} || exit 1`;
  if (kind === 'curl') return `HEALTHCHECK ${OPTIONS} CMD curl -fsS -o /dev/null ${url} || exit 1`;
  if (kind === 'python') {
    const code = `import urllib.request; urllib.request.urlopen('${url}', timeout=3)`;
    return `HEALTHCHECK ${OPTIONS} CMD ${JSON.stringify(['python', '-c', code])}`;
  }
  return `HEALTHCHECK ${OPTIONS} CMD ${JSON.stringify(['bash', '-c', `exec 3<>/dev/tcp/127.0.0.1/${port}`])}`;
}

/**
 * Runtime stage for statically linked binaries (Go, Rust): a small alpine image that keeps healthchecks,
 * OS packages and a non-root user available. Expects the build stage to leave the binary at /out/app.
 */
export const alpineRuntime = (c, port, binary = '/usr/local/bin/app') => [
  'FROM alpine:3 AS runtime',
  'RUN apk add --no-cache ca-certificates tzdata',
  apk(c),
  'RUN adduser -S -u 10001 app',
  `COPY --from=build /out/app ${binary}`,
  'USER app',
  `ENV PORT=${port}`,
  envLines(c),
  `EXPOSE ${port}`,
  healthcheck(c, port, 'wget'),
  `ENTRYPOINT ["${binary}"]`,
];
