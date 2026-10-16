// Copy for the landing page (/). States only what the generator does (see README); counts are checked against getMeta() in test/landing.test.js.

export const STACKS = ['Node.js', 'React', 'Vue', 'Angular', 'FastAPI', 'Django', '.NET', 'Java', 'Go', 'Rust', 'PHP', 'Ruby'];
export const PROVIDERS = ['GitHub Actions', 'GitLab CI', 'Gitea / Forgejo', 'Jenkins', 'Bitbucket Pipelines', 'Azure DevOps', 'CircleCI'];
export const TARGETS = ['Registry only', 'SSH + Compose', 'Kubernetes', 'Cloud Run', 'AWS ECS', 'Azure Web App', 'Fly.io'];

export const FEATURES = [
  {
    title: 'Dockerfile and .dockerignore',
    text: 'Multi-stage builds for twelve stacks, on an alpine or slim base, with healthcheck, OS packages and build arguments.',
    slug: 'dockerfile-generator',
  },
  {
    title: 'Docker Compose',
    text: 'Postgres, MySQL, MariaDB, MongoDB, Redis, RabbitMQ and more, health-gated, with a compose override per environment.',
    slug: 'docker-compose-generator',
  },
  {
    title: 'CI/CD for seven providers',
    text: 'Tests, image build, registry push and deploy in each provider\'s own syntax, with the triggers you switch on.',
    slug: 'ci-cd-pipeline-generator',
  },
  {
    title: 'Safer pipelines',
    text: 'GitHub actions pinned to commit SHAs and limited token permissions, plus optional Trivy, SBOM, cosign, Hadolint and CodeQL.',
    slug: 'github-actions-workflow-generator',
  },
  {
    title: 'Deployment config',
    text: 'Kubernetes manifests, an ECS task definition, fly.toml, or an SSH deploy with compose. Each target brings the files it needs.',
  },
  {
    title: 'Several services, one repo',
    text: 'A Dockerfile per service folder, one compose file, one pipeline, and optional runs only for the services that changed.',
  },
];

export const STEPS = [
  ['Pick your stack', 'Choose a stack, runtime and the options you need. Nothing is read from an existing project.'],
  ['Preview every file', 'See the Dockerfile, compose file, pipeline and deploy config live. Edit or switch off any block.'],
  ['Take the files', 'Copy them or download a zip. The CLI can also write them straight into a project folder.'],
];

export const HOME_FAQ = [
  ['Does it read my existing project?', 'No. You choose the stack and the options and the files are generated from that, so it works for a project that does not exist yet.'],
  ['How accurate are the files?', 'A very good first draft, not a guarantee. Dockerfiles and compose files are usually right for standard projects. Pipelines are checked as text but not run on your CI, and deploy files are templates never run against a real account, so expect small edits.'],
  ['Is it free?', 'Yes. There is no sign-up. You can use the website, or run the same generator as a command line tool or a local web UI.'],
  ['Which CI providers and deploy targets are supported?', 'GitHub Actions, GitLab CI, Gitea and Forgejo Actions, Jenkins, Bitbucket Pipelines, Azure DevOps and CircleCI; and Kubernetes, SSH, Cloud Run, ECS, Azure and Fly, or a plain registry push.'],
];

export const DEVELOPER = {
  name: 'Majid Ali',
  role: 'Full Stack Developer',
  text: 'Dockcrate is built and maintained by Majid Ali, a full stack developer working with Vue.js, Nuxt.js, React, Python and FastAPI.',
  url: 'https://majidev.netlify.app/',
};

export const RELATED_TOOLS = [
  {
    name: 'Docker Control Panel',
    text: 'A graphical Docker manager for Linux: containers, images, volumes, networks and Compose projects, with live resource stats and a terminal inside containers, from one desktop window.',
    url: 'https://github.com/Majid-Ali-Watto/docker-control-panel-linux',
    linkText: 'Docker Control Panel on GitHub',
  },
];
