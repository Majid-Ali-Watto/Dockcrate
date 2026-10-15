import { find, read, lines } from '../fsutil.js';
import { apt, envLines, healthcheck } from '../container.js';

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
  detect(dir, opts) {
    const web = find(dir, (f) => f.endsWith('.csproj'))
      .filter((p) => read(dir, p).includes('Microsoft.NET.Sdk.Web'))
      .sort((a, b) => a.split('/').length - b.split('/').length);
    if (!web.length) return null;
    const csproj = web[0];
    const xml = read(dir, csproj);
    const detected = xml.match(/<TargetFramework>net(\d+\.\d+)<\/TargetFramework>/)?.[1];
    return {
      csproj,
      others: web.length - 1,
      name: xml.match(/<AssemblyName>(.+?)<\/AssemblyName>/)?.[1] ?? csproj.split('/').pop().replace(/\.csproj$/, ''),
      detected,
      version: opts.runtime ?? detected ?? '9.0',
    };
  },
  dockerfile: (i, port, c) =>
    lines(
      '# syntax=docker/dockerfile:1',
      `FROM mcr.microsoft.com/dotnet/sdk:${i.version} AS build`,
      'WORKDIR /src',
      'COPY . .',
      'RUN --mount=type=cache,target=/root/.nuget/packages \\',
      `    dotnet publish "${i.csproj}" -c Release -o /app/publish -p:UseAppHost=false`,
      '',
      `FROM mcr.microsoft.com/dotnet/aspnet:${i.version} AS runtime`,
      'WORKDIR /app',
      `ENV ASPNETCORE_HTTP_PORTS=${port}`,
      envLines(c),
      apt(c),
      'COPY --from=build /app/publish .',
      'USER $APP_UID',
      `EXPOSE ${port}`,
      healthcheck(c, port, 'tcp'),
      `ENTRYPOINT ["dotnet", "${i.name}.dll"]`,
    ),
  ci: (i, v = i.version, selected) => {
    const on = (step) => selected.includes(step);
    return {
      image: `mcr.microsoft.com/dotnet/sdk:${v}`,
      steps: [
        { uses: 'actions/setup-dotnet@v4', with: { 'dotnet-version': `${v}.x` } },
        { run: 'dotnet restore' },
        on('lint') && { run: 'dotnet format --verify-no-changes --no-restore' },
        (on('build') || on('test')) && { run: 'dotnet build --no-restore -c Release' },
        on('test') && { run: 'dotnet test --no-build -c Release' },
        on('audit') && {
          run: [
            'dotnet list package --vulnerable --include-transitive 2>&1 | tee audit.txt',
            '! grep -q "has the following vulnerable packages" audit.txt',
          ],
        },
      ],
    };
  },
  notes: (i) => [
    i.others && `${i.others + 1} web projects found; using ${i.csproj}. Edit the publish line in the Dockerfile to pick another.`,
    !i.detected && 'Could not read <TargetFramework>; assuming .NET 9.0. Use --runtime to set it.',
    i.detected && Number(i.detected) < 8 && '.NET < 8 images do not provide $APP_UID or the 8080 default port; adjust the Dockerfile.',
    'CI runs dotnet restore/build/test at the repo root, which needs a single .sln or project there.',
  ],
};
