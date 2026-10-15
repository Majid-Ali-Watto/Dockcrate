import { has, read, lines } from '../fsutil.js';
import { apt, envLines, healthcheck } from '../container.js';

const SKIPPED_JARS = ["'*-plain.jar'", "'*-sources.jar'", "'*-javadoc.jar'"].map((p) => `! -name ${p}`).join(' ');

function javaVersion(build) {
  const patterns = [
    /<java\.version>(\d+)/,
    /<maven\.compiler\.(?:release|source|target)>(\d+)/,
    /<release>(\d+)/,
    /JavaLanguageVersion\.of\((\d+)\)/,
    /sourceCompatibility\s*=?\s*['"]?(?:JavaVersion\.VERSION_)?(\d+)/,
  ];
  for (const p of patterns) {
    const v = build.match(p)?.[1];
    if (v && Number(v) >= 8) return v;
  }
}

export const java = {
  id: 'java',
  port: 8080,
  backend: true,
  tools: ['maven', 'gradle'],
  usesPackages: true,
  ecosystem: (i) => i.tool,
  codeql: 'java-kotlin',
  devcontainer: (i) => `mcr.microsoft.com/devcontainers/java:1-${i.version}`,
  ciSteps: ['test', 'build'],
  ciDefaults: () => ['test'],
  ignore: ['target', 'build', '.gradle', '.idea', '*.iml'],
  starter(opts) {
    const version = opts.runtime ?? '21';
    return { tool: opts.tool ?? 'maven', spring: true, detected: version, version };
  },
  assumes: (i) => `a Spring Boot project at the repo root, built with ${i.tool === 'maven' ? 'Maven (pom.xml)' : 'the Gradle wrapper (gradlew)'}`,
  detect(dir, opts) {
    const gradleFile = ['build.gradle', 'build.gradle.kts'].find((f) => has(dir, f));
    if (!has(dir, 'pom.xml') && !gradleFile) return null;
    const maven = has(dir, 'pom.xml');
    const build = read(dir, maven ? 'pom.xml' : gradleFile);
    if (!maven && !has(dir, 'gradlew')) {
      throw new Error('Gradle project found but no gradlew wrapper; run `gradle wrapper` first');
    }
    const detected = javaVersion(build);
    return {
      tool: maven ? 'maven' : 'gradle',
      spring: /spring-boot|org\.springframework\.boot/.test(build),
      detected,
      version: opts.runtime ?? detected ?? '21',
    };
  },
  dockerfile(i, port, c) {
    const maven = i.tool === 'maven';
    const outDir = maven ? 'target' : 'build/libs';
    return lines(
      '# syntax=docker/dockerfile:1',
      maven
        ? `FROM maven:3-eclipse-temurin-${i.version} AS build`
        : `FROM eclipse-temurin:${i.version}-jdk AS build`,
      'WORKDIR /app',
      'COPY . .',
      `RUN --mount=type=cache,target=${maven ? '/root/.m2' : '/root/.gradle'} \\`,
      `    ${maven ? 'mvn -B -DskipTests package' : `sh ./gradlew --no-daemon ${i.spring ? 'bootJar' : 'build -x test'}`} && \\`,
      `    find ${outDir} -maxdepth 1 -name '*.jar' ${SKIPPED_JARS} -exec cp {} /app.jar \\;`,
      '',
      `FROM eclipse-temurin:${i.version}-jre AS runtime`,
      'WORKDIR /app',
      apt(c),
      'RUN groupadd --system app && useradd --system --gid app app',
      'COPY --from=build --chown=app:app /app.jar app.jar',
      'USER app',
      `ENV SERVER_PORT=${port}`,
      envLines(c),
      `EXPOSE ${port}`,
      healthcheck(c, port, 'tcp'),
      'ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]',
    );
  },
  ci(i, v = i.version, selected) {
    const maven = i.tool === 'maven';
    const test = selected.includes('test');
    const build = selected.includes('build');
    // One build command covers whichever of test/build is wanted.
    const command = maven
      ? test
        ? 'mvn -B verify'
        : build && 'mvn -B -DskipTests package'
      : test
        ? build
          ? './gradlew build'
          : './gradlew test'
        : build && './gradlew assemble';
    return {
      image: maven ? `maven:3-eclipse-temurin-${v}` : `eclipse-temurin:${v}-jdk`,
      steps: [
        {
          uses: 'actions/setup-java@v4',
          with: { distribution: 'temurin', 'java-version': v, cache: i.tool },
        },
        !maven && command && { run: 'chmod +x gradlew' },
        command && { run: command },
      ],
    };
  },
  notes: (i, port) => [
    !i.detected && 'Could not read the Java version from the build file; assuming 21. Use --runtime to set it.',
    !i.spring && 'Not a Spring Boot project: make sure the build produces an executable (fat) jar with a Main-Class.',
    i.spring && `Port is set via SERVER_PORT=${port} (Spring relaxed binding of server.port).`,
  ],
};
