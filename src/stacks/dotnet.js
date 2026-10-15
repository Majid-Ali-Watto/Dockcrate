import { lines } from '../fsutil.js';
import { DEFAULT_BUILD, apt, envLines, healthcheck, pkgs } from '../container.js';

export const dotnet = {
  id: 'dotnet',
  port: 8080,
  backend: true,
  tools: [],
  usesName: true,
  usesPackages: true,
  ecosystem: () => 'nuget',
  codeql: 'csharp',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/dotnet:1-${i.version}`,
  ciSteps: ['lint', 'test', 'build', 'audit'],
  ciDefaults: () => ['build', 'test'],
  ignore: ['**/bin', '**/obj', '.vs'],
  starter(opts) {
    const name = opts.name ?? 'App';
    const version = opts.runtime ?? '9.0';
    return { csproj: `${name}.csproj`, others: 0, name, detected: version, version };
  },
  assumes: (i) => `a single ASP.NET Core project, ${i.csproj}, at the repo root`,
  dev: (i, port, c) => ({
    dockerfile: lines(
      '# syntax=docker/dockerfile:1',
      `FROM mcr.microsoft.com/dotnet/sdk:${i.version}`,
      'WORKDIR /src',
      `ENV ASPNETCORE_HTTP_PORTS=${port} DOTNET_USE_POLLING_FILE_WATCHER=true`,
      envLines(c),
      apt(c),
      'COPY . .',
      `EXPOSE ${port}`,
      `CMD ${JSON.stringify(['dotnet', 'watch', 'run', '--project', i.csproj, '--no-launch-profile'])}`,
    ),
    workdir: '/src',
    mode: 'mount',
    volumes: [],
  }),
  dockerfile(i, port, c, b = DEFAULT_BUILD) {
    const v = b.variant ?? 'slim';
    const suffix = v === 'alpine' ? '-alpine' : '';
    const sdk = `mcr.microsoft.com/dotnet/sdk:${i.version}${suffix}`;
    const aspnet = `mcr.microsoft.com/dotnet/aspnet:${i.version}${suffix}`;
    const probe = v === 'alpine' ? 'wget' : 'tcp';
    const publish = (to) => [`RUN --mount=type=cache,target=/root/.nuget/packages \\`, `    dotnet publish "${i.csproj}" -c Release -o ${to} -p:UseAppHost=false`];
    const run = [`ENV ASPNETCORE_HTTP_PORTS=${port}`, envLines(c), pkgs(c, v)];
    const tail = ['USER $APP_UID', `EXPOSE ${port}`, healthcheck(c, port, probe), `ENTRYPOINT ["dotnet", "${i.name}.dll"]`];
    if (b.mode === 'production') {
      return lines('# syntax=docker/dockerfile:1', `FROM ${aspnet}`, 'WORKDIR /app', run, 'COPY publish/ .', tail);
    }
    if (b.mode === 'mixed') {
      // One image: the SDK publishes the app and the same image runs it.
      return lines('# syntax=docker/dockerfile:1', `FROM ${sdk}`, 'WORKDIR /src', run, 'COPY . .', publish('/app/publish'), 'WORKDIR /app/publish', tail);
    }
    return lines(
      '# syntax=docker/dockerfile:1',
      `FROM ${sdk} AS build`,
      'WORKDIR /src',
      'COPY . .',
      publish('/app/publish'),
      '',
      `FROM ${aspnet} AS runtime`,
      'WORKDIR /app',
      run,
      'COPY --from=build /app/publish .',
      tail,
    );
  },
  variants: ['alpine', 'slim'],
  defaultVariant: 'slim',
  healthKind: (b) => (b.variant === 'alpine' ? 'wget' : 'tcp'),
  buildNotes: (i, b) => [
    b.mode === 'production' && 'Production only: the image copies a publish/ folder, so run `dotnet publish -c Release -o publish` first (the generated pipeline builds the image from the repository as it is).',
    b.mode === 'mixed' && 'Build and production in one image: it keeps the .NET SDK and the sources next to the published app, so it is much bigger than a multi-stage image.',
  ],
  ci: (i, v = i.version, selected) => {
    const on = (step) => selected.includes(step);
    return {
      image: `mcr.microsoft.com/dotnet/sdk:${v}`,
      steps: [
        { uses: 'actions/setup-dotnet@v4', with: { 'dotnet-version': `${v}.x` } },
        { run: 'dotnet restore' },
        on('lint') && { run: 'dotnet format --verify-no-changes --no-restore', ciStep: 'lint' },
        (on('build') || on('test')) && { run: 'dotnet build --no-restore -c Release', ciStep: ['build', 'test'] },
        on('test') && { run: 'dotnet test --no-build -c Release', ciStep: 'test' },
        on('audit') && {
          run: [
            'dotnet list package --vulnerable --include-transitive 2>&1 | tee audit.txt',
            '! grep -q "has the following vulnerable packages" audit.txt',
          ],
          ciStep: 'audit',
        },
      ],
    };
  },
  notes: (i) => [
    i.detected && Number(i.detected) < 8 && '.NET < 8 images do not provide $APP_UID or the 8080 default port; adjust the Dockerfile.',
    'CI runs dotnet restore/build/test at the repo root, which needs a single .sln or project there.',
  ],
};
