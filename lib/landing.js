// Landing pages: one per thing people search for ("Dockerfile generator", "Docker Compose generator", ...).
// Copy states only what the generator does (see README); the sample on each page is real generator output.

const SAMPLE_DIR = '/nonexistent/my-app'; // generate() never reads a project, only checks this folder for an existing compose file name

export const LANDING = [
  {
    slug: 'dockerfile-generator',
    nav: 'Dockerfile generator',
    title: 'Dockerfile generator: Node, Python, Java, Go, Rust, PHP',
    description:
      'Generate a multi-stage Dockerfile and .dockerignore for Node.js, React, Vue, Angular, FastAPI, Django, .NET, Java, Go, Rust, PHP or Ruby. Copy or download it.',
    h1: 'Dockerfile generator for your stack',
    lead: 'Pick a stack and a few options and get a Dockerfile and a matching .dockerignore, ready to copy or download. Nothing is read from an existing project: you describe the new one.',
    points: [
      'Twelve stacks: Node.js (Express, Nest and others), React, Vue, Angular, FastAPI, Django, .NET, Java, Go, Rust, PHP (Laravel, Symfony, plain Composer) and Ruby (Rails, Rack).',
      'Multi-stage by default: a build stage with the tools and a small runtime stage that copies the result. Prefer one stage? Choose production only or build and production mixed.',
      'Alpine or slim (Debian-based) base image, runtime version, port, package manager or build tool.',
      'React, Vue and Angular are built with Node and served by nginx, with an nginx.conf included.',
      'Healthcheck path, OS packages (apk or apt), runtime environment variables and build arguments such as VITE_* and NEXT_PUBLIC_*.',
      'A .dockerignore that matches the stack, so the build context stays small.',
    ],
    sample: { opts: { stack: 'node', tool: 'npm', name: 'web' }, file: 'Dockerfile', caption: 'Dockerfile for a Node.js project with npm (multi-stage, runs as the node user)' },
    faq: [
      ['Is the generated Dockerfile multi-stage?', 'Yes by default. A build stage holds the compilers and dev dependencies and the runtime stage copies only what it needs. You can switch to a single stage, either production only or build and production mixed.'],
      ['Does it read my project?', 'No. You choose the stack and the options and the files are generated from that. The notes next to the output say what your project must provide, for example a start script for Node.js.'],
      ['Will the Dockerfile build without changes?', 'It is a very good first draft, not a guarantee. It is checked as text but never built here, so expect small edits such as ports, commands or package names.'],
      ['Can I use it from the command line?', 'Yes. The same generator runs as a CLI and as this web page.'],
    ],
  },
  {
    slug: 'docker-compose-generator',
    nav: 'Docker Compose generator',
    title: 'Docker Compose generator with databases and services',
    description:
      'Generate a docker-compose.yml with Postgres, MySQL, MongoDB, Redis, RabbitMQ and more: health checks, volumes, connection URLs and per-environment overrides.',
    h1: 'Docker Compose generator',
    lead: 'Build a docker-compose.yml for your app and the services it needs. Databases come with health checks, volumes and connection URLs already wired in.',
    points: [
      'Services to add: Postgres, MySQL, MariaDB, MongoDB, Redis, Memcached, Elasticsearch, RabbitMQ and Mailpit.',
      'Your app waits for each service to be healthy (depends_on with a health condition) and gets its connection URL as an environment variable.',
      'Passwords come from the environment with a default, and an .env.example is generated next to the compose file.',
      'Several apps in one repository: a Dockerfile per service folder and a single compose file, optionally with a database per service.',
      'A compose override per environment (dev, qa, staging, prod or your own); dev also gets a Dockerfile.dev with the source mounted for live reload.',
      'Networks (including internal and external ones) and a restart policy you choose.',
    ],
    sample: { opts: { stack: 'node', tool: 'npm', name: 'web', db: ['postgres', 'redis'] }, file: 'docker-compose.yml', caption: 'docker-compose.yml for a Node.js app with Postgres and Redis' },
    faq: [
      ['Which databases and services can I add?', 'Postgres, MySQL, MariaDB, MongoDB, Redis, Memcached, Elasticsearch, RabbitMQ and Mailpit. MySQL and MariaDB cannot be combined because both use port 3306.'],
      ['Can one compose file run several of my apps?', 'Yes. Split the project into services, each with its own folder and stack, and the output is one compose file with one Dockerfile per service.'],
      ['How do I keep dev and production apart?', 'Add environments. Each one gets a compose override file, and dev also gets a Dockerfile.dev that mounts your source.'],
      ['Are the passwords safe to commit?', 'The compose file reads them from the environment and falls back to a development default. Put real values in your own .env file; .env.example only shows the names.'],
    ],
  },
  {
    slug: 'github-actions-workflow-generator',
    nav: 'GitHub Actions workflow generator',
    title: 'GitHub Actions workflow generator for Docker projects',
    description:
      'Generate a GitHub Actions workflow that tests your project, builds and pushes a Docker image, scans it with Trivy and deploys it. Actions pinned to SHAs.',
    h1: 'GitHub Actions workflow generator for Docker',
    lead: 'Get a ci.yml that tests your code, builds the image and pushes it to a registry, with the security options you pick. You choose the triggers, nothing is fixed for you.',
    points: [
      'Test job per stack with lint, tests, build and dependency audit steps, and an optional runtime-version and OS matrix.',
      'Image job with multi-arch builds, tags from the branch, the git tag, a semantic version or latest, and a push to GHCR, Docker Hub, Quay, Artifact Registry, ECR, ACR or your own registry.',
      'Triggers you switch on one by one: push branches, tags, pull requests, manual runs that ask which steps to run, releases and cron schedules.',
      'Third-party actions are pinned to commit SHAs, token permissions are limited, and concurrency cancels superseded pull-request runs.',
      'Optional Trivy scan that fails on HIGH and CRITICAL, SBOM and provenance attestations, cosign keyless signing, Hadolint and CodeQL.',
      'Deploy to Kubernetes, over SSH, Cloud Run, ECS, Azure or Fly, with several environments if you need them.',
    ],
    sample: { opts: { stack: 'node', tool: 'npm', name: 'web' }, file: '.github/workflows/ci.yml', caption: 'GitHub Actions workflow for a Node.js project (actions pinned to commit SHAs)' },
    faq: [
      ['Why are the actions pinned to commit SHAs?', 'A tag such as v4 can be moved to different code later. A commit SHA cannot, so the workflow keeps running the exact version that was reviewed. Turn pinning off if you prefer tags.'],
      ['Has the workflow been run on my repository?', 'No. Pipelines are checked as text but not run on your CI, and deploy files are templates never run against a real account. Read the notes and expect small edits to secret names and commands.'],
      ['Can it deploy as well as build?', 'Yes: Kubernetes (with generated manifests), SSH with docker compose, Cloud Run, ECS, Azure Web App for Containers and Fly. Or stop after pushing the image.'],
      ['Does it work for a repository with several services?', 'Yes. Services with identical test steps share a matrix job, and images are built per service. You can limit runs to the services whose folder changed.'],
    ],
  },
  {
    slug: 'ci-cd-pipeline-generator',
    nav: 'CI/CD pipeline generator',
    title: 'CI/CD pipeline generator: GitHub, GitLab, Jenkins and more',
    description:
      'Generate a CI/CD pipeline for GitHub Actions, GitLab CI, Jenkins, Bitbucket, Azure DevOps, CircleCI or Gitea: tests, Docker image build, registry push, deploy.',
    h1: 'CI/CD pipeline generator for seven providers',
    lead: 'Choose your CI provider and get a pipeline that tests the project, builds the Docker image, pushes it to a registry and optionally deploys it.',
    points: [
      'Providers: GitHub Actions, GitLab CI, Gitea and Forgejo Actions, Jenkins, Bitbucket Pipelines, Azure DevOps and CircleCI.',
      'The same options everywhere: triggers, test steps, registry, image tags, caching, scanning and deployment, written in each provider\'s own syntax.',
      'Deployment targets: registry only, SSH with docker compose, Kubernetes, Cloud Run, ECS, Azure and Fly, with config files such as k8s manifests, an ECS task definition or fly.toml.',
      'Several environments, each with its own branch, tag or manual rule.',
      'Several services in one repository: tests, image builds and deploys per service, optionally only for services whose folder changed.',
      'Dependency updates through Dependabot, or Renovate when you are not on GitHub.',
    ],
    sample: { opts: { stack: 'node', tool: 'npm', name: 'web', ci: 'gitlab' }, file: '.gitlab-ci.yml', caption: '.gitlab-ci.yml for a Node.js project' },
    faq: [
      ['Which CI providers are supported?', 'GitHub Actions, GitLab CI, Gitea and Forgejo Actions, Jenkins, Bitbucket Pipelines, Azure DevOps and CircleCI.'],
      ['Where can the pipeline deploy to?', 'To a registry only, to a server over SSH, to Kubernetes, Google Cloud Run, AWS ECS, Azure Web App for Containers or Fly. Each target generates the files it needs.'],
      ['Do I need to install anything?', 'No. Use this page, or run the CLI if you prefer a terminal. Both use the same generator.'],
      ['Does it detect my existing pipeline?', 'No. It generates files for a new project from the options you choose and never reads an existing one.'],
    ],
  },
];

export const landingBySlug = (slug) => LANDING.find((page) => page.slug === slug);

/** The page's `metadata` export; the origin comes from `metadataBase` in app/layout.jsx. */
export function landingMetadata(slug) {
  const { title, description } = landingBySlug(slug);
  const url = `/${slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title, description },
    twitter: { title, description },
  };
}

export { SAMPLE_DIR };
