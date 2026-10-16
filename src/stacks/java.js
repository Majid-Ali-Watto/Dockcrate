import { lines } from '../fsutil.js';
import { DEFAULT_BUILD, DEV_ROOT, apt, envLines, healthcheck, pkgs, runAsOf, systemUser, userLine } from '../container.js';

const SKIPPED_JARS = ["'*-plain.jar'", "'*-sources.jar'", "'*-javadoc.jar'"].map((p) => `! -name ${p}`).join(' ');

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
  ignore: (b, i) => (b.mode === 'production' ? [...(i.tool === 'maven' ? ['target/*', '!target/*.jar'] : ['build/*', '!build/libs', '.gradle']), '.idea', '*.iml'] : ['target', 'build', '.gradle', '.idea', '*.iml']),
  starter(opts) {
    const version = opts.runtime ?? '21';
    return { tool: opts.tool ?? 'maven', spring: true, detected: version, version };
  },
  assumes: (i) => `a Spring Boot project at the repo root, built with ${i.tool === 'maven' ? 'Maven (pom.xml)' : 'the Gradle wrapper (gradlew)'}`,
  dev(i, port, c) {
    const maven = i.tool === 'maven';
    return {
      dockerfile: lines(
        '# syntax=docker/dockerfile:1',
        DEV_ROOT,
        maven ? `FROM maven:3-eclipse-temurin-${i.version}` : `FROM eclipse-temurin:${i.version}-jdk`,
        'WORKDIR /app',
        apt(c),
        `ENV SERVER_PORT=${port}`,
        envLines(c),
        'COPY . .',
        `EXPOSE ${port}`,
        `CMD ${JSON.stringify(maven ? ['mvn', '-B', 'spring-boot:run'] : ['sh', './gradlew', '--no-daemon', 'bootRun'])}`,
      ),
      workdir: '/app',
      mode: 'mount',
      volumes: [],
    };
  },
  dockerfile(i, port, c, b = DEFAULT_BUILD) {
    const v = b.variant ?? 'slim';
    const alpine = v === 'alpine';
    const maven = i.tool === 'maven';
    const outDir = maven ? 'target' : 'build/libs';
    const suffix = alpine ? '-alpine' : '';
    const jdk = maven ? `maven:3-eclipse-temurin-${i.version}${suffix}` : `eclipse-temurin:${i.version}-jdk${suffix}`;
    const jre = `eclipse-temurin:${i.version}-jre${suffix}`;
    const user = systemUser(v);
    const probe = alpine ? 'wget' : 'tcp';
    const build = [
      `RUN --mount=type=cache,target=${maven ? '/root/.m2' : '/root/.gradle'} \\`,
      `    ${maven ? 'mvn -B -DskipTests package' : `sh ./gradlew --no-daemon ${i.spring ? 'bootJar' : 'build -x test'}`} && \\`,
    ];
    const pick = (to) => `find ${outDir} -maxdepth 1 -name '*.jar' ${SKIPPED_JARS} -exec cp {} ${to} \\;`;
    if (b.mode === 'production') {
      // The jar was built outside; every jar of the output folder is copied and the plain / sources / javadoc ones are dropped.
      return lines(
        '# syntax=docker/dockerfile:1',
        `FROM ${jre}`,
        'WORKDIR /app',
        pkgs(c, v),
        user,
        `COPY ${outDir}/*.jar /tmp/jars/`,
        `RUN find /tmp/jars -maxdepth 1 -name '*.jar' ${SKIPPED_JARS} -exec mv {} app.jar \\; && rm -rf /tmp/jars`,
        userLine(),
        `ENV SERVER_PORT=${port}`,
        envLines(c),
        `EXPOSE ${port}`,
        healthcheck(c, port, probe),
        'ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]',
      );
    }
    if (b.mode === 'mixed') {
      // One image: the JDK builds the jar and the same image runs it.
      return lines(
        '# syntax=docker/dockerfile:1',
        `FROM ${jdk}`,
        'WORKDIR /app',
        pkgs(c, v),
        'COPY . .',
        ...build,
        `    ${pick('/app/app.jar')}`,
        user,
        userLine(),
        `ENV SERVER_PORT=${port}`,
        envLines(c),
        `EXPOSE ${port}`,
        healthcheck(c, port, probe),
        'ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]',
      );
    }
    return lines(
      '# syntax=docker/dockerfile:1',
      `FROM ${jdk} AS build`,
      'WORKDIR /app',
      'COPY . .',
      ...build,
      `    ${pick('/app.jar')}`,
      '',
      `FROM ${jre} AS runtime`,
      'WORKDIR /app',
      pkgs(c, v),
      user,
      'COPY --from=build /app.jar app.jar',
      userLine(),
      `ENV SERVER_PORT=${port}`,
      envLines(c),
      `EXPOSE ${port}`,
      healthcheck(c, port, probe),
      'ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]',
    );
  },
  variants: ['alpine', 'slim'],
  defaultVariant: 'slim',
  healthKind: (b) => (b.variant === 'alpine' ? 'wget' : 'tcp'),
  // Spring Boot (Tomcat) keeps its work files under /tmp.
  runAs: () => runAsOf(10001),
  buildNotes: (i, b) => [
    b.variant === 'alpine' && 'Alpine Temurin images exist for some Java versions only (8, 11, 17, 21 and a few newer ones): if the image cannot be pulled, choose slim or another version.',
    b.mode === 'production' && `Production only: the image copies the jar from ${i.tool === 'maven' ? 'target/' : 'build/libs/'}, so build it first (${i.tool === 'maven' ? 'mvn package' : './gradlew bootJar'}); the generated pipeline builds the image from the repository as it is.`,
    b.mode === 'mixed' && 'Build and production in one image: it keeps the JDK, the build tool and the sources next to the jar, so it is much bigger than a multi-stage image.',
  ],
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
        // One command builds and tests, so either switch keeps it.
        command && { run: command, ciStep: ['test', 'build'] },
      ],
    };
  },
  notes: (i, port) => [
    i.spring && `Port is set via SERVER_PORT=${port} (Spring relaxed binding of server.port).`,
  ],
};
