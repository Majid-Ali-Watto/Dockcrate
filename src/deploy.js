import { lines } from './fsutil.js';

// GitHub Actions expression, kept out of template literals so `${{` stays readable.
const x = (expr) => '${{ ' + expr + ' }}';
const NOT_PR = "github.event_name != 'pull_request'";

const merge = (a, b) => ({ secrets: [...a.secrets, ...b.secrets], vars: [...a.vars, ...b.vars] });

/**
 * Where the built image is pushed. `needs` lists the CI secrets/variables the registry login reads; `authTarget` names the
 * cloud target whose `github.auth` steps sign in first (so the registry is usable from any target); `env` lets a target
 * that logs in again elsewhere (ssh) reuse the same credentials. `github.login` steps run in the image job after the target's own auth steps;
 * `shell.login` lines run where the docker CLI builds the image (GitLab dind, Jenkins, Bitbucket, Azure, CircleCI). `env` is handed to the deploy script (ssh only).
 */
export const REGISTRIES = {
  builtin: {
    // GHCR on GitHub and the GitLab container registry on GitLab (its `shell` flavour uses GitLab's CI variables).
    label: 'GHCR / GitLab container registry',
    github: {
      image: 'ghcr.io/' + x('github.repository'),
      login: () => [
        {
          uses: 'docker/login-action@v3',
          if: NOT_PR,
          with: { registry: 'ghcr.io', username: x('github.actor'), password: x('secrets.GITHUB_TOKEN') },
        },
      ],
      env: { REGISTRY: 'ghcr.io', REGISTRY_USER: x('github.actor'), REGISTRY_TOKEN: x('secrets.GITHUB_TOKEN') },
    },
    shell: {
      image: '$CI_REGISTRY_IMAGE',
      login: ['echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"'],
      env: { REGISTRY: '$CI_REGISTRY', REGISTRY_USER: '$CI_REGISTRY_USER', REGISTRY_TOKEN: '$CI_REGISTRY_PASSWORD' },
    },
  },
  dockerhub: {
    label: 'Docker Hub',
    needs: () => ({ secrets: ['DOCKERHUB_TOKEN'], vars: ['DOCKERHUB_USERNAME'] }),
    github: {
      image: x('vars.DOCKERHUB_USERNAME') + '/{app}',
      login: () => [
        {
          uses: 'docker/login-action@v3',
          if: NOT_PR,
          with: { username: x('vars.DOCKERHUB_USERNAME'), password: x('secrets.DOCKERHUB_TOKEN') },
        },
      ],
      env: { REGISTRY: 'docker.io', REGISTRY_USER: x('vars.DOCKERHUB_USERNAME'), REGISTRY_TOKEN: x('secrets.DOCKERHUB_TOKEN') },
    },
    shell: {
      image: '$DOCKERHUB_USERNAME/{app}',
      login: ['echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin'],
      env: { REGISTRY: 'docker.io', REGISTRY_USER: '$DOCKERHUB_USERNAME', REGISTRY_TOKEN: '$DOCKERHUB_TOKEN' },
    },
  },
  quay: {
    label: 'Quay.io',
    needs: () => ({ secrets: ['QUAY_PASSWORD'], vars: ['QUAY_USERNAME', 'QUAY_NAMESPACE'] }),
    github: {
      image: 'quay.io/' + x('vars.QUAY_NAMESPACE') + '/{app}',
      login: () => [
        {
          uses: 'docker/login-action@v3',
          if: NOT_PR,
          with: { registry: 'quay.io', username: x('vars.QUAY_USERNAME'), password: x('secrets.QUAY_PASSWORD') },
        },
      ],
      env: { REGISTRY: 'quay.io', REGISTRY_USER: x('vars.QUAY_USERNAME'), REGISTRY_TOKEN: x('secrets.QUAY_PASSWORD') },
    },
    shell: {
      image: 'quay.io/$QUAY_NAMESPACE/{app}',
      login: ['echo "$QUAY_PASSWORD" | docker login quay.io -u "$QUAY_USERNAME" --password-stdin'],
      env: { REGISTRY: 'quay.io', REGISTRY_USER: '$QUAY_USERNAME', REGISTRY_TOKEN: '$QUAY_PASSWORD' },
    },
  },
  custom: {
    label: 'Self-hosted / other registry (Harbor, Nexus, Artifactory, Gitea…)',
    needs: () => ({ secrets: ['REGISTRY_PASSWORD'], vars: ['REGISTRY_HOST', 'REGISTRY_NAMESPACE', 'REGISTRY_USERNAME'] }),
    github: {
      image: x('vars.REGISTRY_HOST') + '/' + x('vars.REGISTRY_NAMESPACE') + '/{app}',
      login: () => [
        {
          uses: 'docker/login-action@v3',
          if: NOT_PR,
          with: { registry: x('vars.REGISTRY_HOST'), username: x('vars.REGISTRY_USERNAME'), password: x('secrets.REGISTRY_PASSWORD') },
        },
      ],
      env: { REGISTRY: x('vars.REGISTRY_HOST'), REGISTRY_USER: x('vars.REGISTRY_USERNAME'), REGISTRY_TOKEN: x('secrets.REGISTRY_PASSWORD') },
    },
    shell: {
      image: '$REGISTRY_HOST/$REGISTRY_NAMESPACE/{app}',
      login: ['echo "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USERNAME" --password-stdin'],
      env: { REGISTRY: '$REGISTRY_HOST', REGISTRY_USER: '$REGISTRY_USERNAME', REGISTRY_TOKEN: '$REGISTRY_PASSWORD' },
    },
  },
  gar: {
    label: 'Google Artifact Registry',
    authTarget: 'cloudrun',
    needs: ({ platform, oidc }) => ({
      secrets: platform === 'github' && oidc ? [] : ['GCP_SA_KEY'],
      vars: ['GCP_PROJECT', 'GCP_REGION', 'GAR_REPO', ...(platform === 'github' && oidc ? ['GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_SERVICE_ACCOUNT'] : [])],
    }),
    github: {
      image: x('vars.GCP_REGION') + '-docker.pkg.dev/' + x('vars.GCP_PROJECT') + '/' + x('vars.GAR_REPO') + '/{app}',
      login: () => [
        {
          uses: 'docker/login-action@v3',
          if: NOT_PR,
          with: {
            registry: x('vars.GCP_REGION') + '-docker.pkg.dev',
            username: 'oauth2accesstoken',
            password: x('steps.auth.outputs.access_token'),
          },
        },
      ],
    },
    shell: {
      image: '$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$GAR_REPO/{app}',
      login: ['echo "$GCP_SA_KEY" | docker login -u _json_key --password-stdin "https://$GCP_REGION-docker.pkg.dev"'],
    },
  },
  ecr: {
    label: 'AWS ECR',
    authTarget: 'ecs',
    needs: ({ platform, oidc }) => ({
      secrets: platform === 'github' && oidc ? [] : ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
      vars: ['AWS_REGION', 'AWS_ACCOUNT_ID', 'ECR_REPOSITORY', ...(platform === 'github' && oidc ? ['AWS_ROLE_ARN'] : [])],
    }),
    github: {
      image: x('vars.AWS_ACCOUNT_ID') + '.dkr.ecr.' + x('vars.AWS_REGION') + '.amazonaws.com/' + x('vars.ECR_REPOSITORY'),
      login: () => [{ id: 'ecr', uses: 'aws-actions/amazon-ecr-login@v2', if: NOT_PR }],
    },
    shell: {
      image: '$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY',
      login: [
        'apk add --no-cache aws-cli',
        'aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"',
      ],
    },
  },
  acr: {
    label: 'Azure Container Registry',
    authTarget: 'azure',
    needs: ({ platform, oidc }) => ({
      secrets: platform !== 'github' ? ['AZURE_CLIENT_SECRET'] : oidc ? [] : ['AZURE_CREDENTIALS'],
      vars: [
        'ACR_NAME',
        ...(platform !== 'github' ? ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID'] : []),
        ...(platform === 'github' && oidc ? ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID'] : []),
      ],
    }),
    github: {
      image: x('vars.ACR_NAME') + '.azurecr.io/{app}',
      login: () => [{ run: 'az acr login --name "$ACR_NAME"', if: NOT_PR, env: { ACR_NAME: x('vars.ACR_NAME') } }],
    },
    shell: {
      image: '$ACR_NAME.azurecr.io/{app}',
      login: ['echo "$AZURE_CLIENT_SECRET" | docker login "$ACR_NAME.azurecr.io" -u "$AZURE_CLIENT_ID" --password-stdin'],
    },
  },
};

const k8sDeployment = ({ appName, port, healthcheck = '' }) => {
  // With a health path the probes hit it; otherwise they only check that the port accepts connections.
  const probe = (kind, delay, period) => [
    `          ${kind}Probe:`,
    ...(healthcheck ? ['            httpGet:', `              path: ${healthcheck}`, `              port: ${port}`] : ['            tcpSocket:', `              port: ${port}`]),
    `            initialDelaySeconds: ${delay}`,
    `            periodSeconds: ${period}`,
  ];
  return lines(
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${appName}`,
    '  labels:',
    `    app: ${appName}`,
    'spec:',
    '  replicas: 2',
    '  selector:',
    '    matchLabels:',
    `      app: ${appName}`,
    '  template:',
    '    metadata:',
    '      labels:',
    `        app: ${appName}`,
    '    spec:',
    '      automountServiceAccountToken: false',
    '      securityContext:',
    '        seccompProfile:',
    '          type: RuntimeDefault',
    '      containers:',
    '        - name: app',
    '          # Replaced with the freshly built image by the pipeline',
    '          image: IMAGE_PLACEHOLDER',
    '          ports:',
    `            - containerPort: ${port}`,
    '          # Settings such as DATABASE_URL: create the Secret, the pods start without it',
    '          envFrom:',
    '            - secretRef:',
    `                name: ${appName}-env`,
    '                optional: true',
    probe('readiness', 5, 10),
    probe('liveness', 15, 20),
    '          securityContext:',
    '            allowPrivilegeEscalation: false',
    '            capabilities:',
    '              drop: [ALL]',
    '          resources:',
    '            requests:',
    '              cpu: 100m',
    '              memory: 128Mi',
    '            limits:',
    '              memory: 512Mi',
  );
};

const k8sService = ({ appName, port }) =>
  lines(
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    `  name: ${appName}`,
    'spec:',
    '  selector:',
    `    app: ${appName}`,
    '  ports:',
    '    - port: 80',
    `      targetPort: ${port}`,
  );

const ecsTaskDefinition = ({ appName, port }) =>
  JSON.stringify(
    {
      family: appName,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: '256',
      memory: '512',
      executionRoleArn: 'arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole',
      containerDefinitions: [
        {
          name: 'app',
          image: 'IMAGE_PLACEHOLDER',
          essential: true,
          portMappings: [{ containerPort: port, protocol: 'tcp' }],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': `/ecs/${appName}`,
              'awslogs-region': 'REGION',
              'awslogs-stream-prefix': 'app',
              'awslogs-create-group': 'true',
            },
          },
        },
      ],
    },
    null,
    2,
  ) + '\n';

const flyToml = ({ appName, port }) =>
  lines(
    `app = "${appName}"`,
    '',
    '[build]',
    '',
    '[http_service]',
    `  internal_port = ${port}`,
    '  force_https = true',
    '  auto_stop_machines = "stop"',
    '  auto_start_machines = true',
    '  min_machines_running = 0',
  );

/**
 * Deploy targets. `needs` lists the CI secrets/variables the pipeline reads (a trailing ? marks optional ones);
 * `script` is shell shared by GitHub and GitLab and reads those names (plus IMAGE, APP, PORT) from the environment.
 * `github.auth(oidc)` steps run in both the image and deploy jobs; `github.prepare` only in the deploy job.
 */
export const TARGETS = {
  registry: { label: 'None: just push the image to a registry', registry: 'builtin' },

  ssh: {
    label: 'Server over SSH (docker compose)',
    registry: 'builtin',
    composeImage: true,
    usesRegistryEnv: true,
    needs: () => ({
      secrets: ['SSH_PRIVATE_KEY', 'SSH_KNOWN_HOSTS'],
      vars: ['SSH_HOST', 'SSH_USER', 'DEPLOY_PATH'],
    }),
    shell: { image: 'alpine:3', setup: ['apk add --no-cache openssh-client'] },
    script: ({ composeFile }) => [
      'set -eu',
      'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
      'printf \'%s\\n\' "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519',
      'printf \'%s\\n\' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts',
      'REMOTE="$SSH_USER@$SSH_HOST"',
      '# These variables expand here, on the runner, on purpose:',
      '# shellcheck disable=SC2029',
      'ssh "$REMOTE" "mkdir -p $DEPLOY_PATH"',
      `scp ${composeFile} "$REMOTE:$DEPLOY_PATH/${composeFile}"`,
      '# shellcheck disable=SC2029',
      'printf \'%s\' "$REGISTRY_TOKEN" | ssh "$REMOTE" "docker login $REGISTRY -u $REGISTRY_USER --password-stdin && cd $DEPLOY_PATH && APP_IMAGE=$IMAGE docker compose pull && APP_IMAGE=$IMAGE docker compose up -d --remove-orphans"',
    ],
    notes: () => [
      'SSH: get SSH_KNOWN_HOSTS with `ssh-keyscan -H <host>`; the server needs Docker with the compose plugin, and a .env next to the compose file if the app needs one.',
    ],
  },

  kubernetes: {
    label: 'Kubernetes (kubectl)',
    registry: 'builtin',
    needs: () => ({ secrets: ['KUBE_CONFIG'], vars: ['K8S_NAMESPACE?'] }),
    shell: { image: 'alpine:3', setup: ['apk add --no-cache kubectl'] },
    script: ({ appName }) => [
      'set -eu',
      'mkdir -p ~/.kube && printf \'%s\' "$KUBE_CONFIG" | base64 -d > ~/.kube/config && chmod 600 ~/.kube/config',
      'NS="${K8S_NAMESPACE:-default}"',
      'kubectl apply -n "$NS" -f k8s/service.yaml',
      'sed "s|IMAGE_PLACEHOLDER|$IMAGE|" k8s/deployment.yaml | kubectl apply -n "$NS" -f -',
      `kubectl rollout status -n "$NS" deployment/${appName} --timeout=180s`,
    ],
    files: (ctx) => [
      { path: 'k8s/deployment.yaml', content: k8sDeployment(ctx) },
      { path: 'k8s/service.yaml', content: k8sService(ctx) },
    ],
    notes: () => [
      'Kubernetes: KUBE_CONFIG is your kubeconfig, base64-encoded (`base64 -w0 ~/.kube/config`). A private registry needs an imagePullSecret in the cluster; the Service is ClusterIP, so add an Ingress for public traffic. The pods read optional settings from a Secret named <app>-env (kubectl create secret generic <app>-env --from-literal=KEY=value).',
    ],
  },

  cloudrun: {
    label: 'Google Cloud Run',
    registry: 'gar',
    oidc: true,
    needs: (ctx) => merge(REGISTRIES.gar.needs(ctx), { secrets: [], vars: ['CLOUD_RUN_SERVICE'] }),
    github: {
      auth: (oidc) => [
        {
          id: 'auth',
          uses: 'google-github-actions/auth@v2',
          with: {
            ...(oidc
              ? {
                  workload_identity_provider: x('vars.GCP_WORKLOAD_IDENTITY_PROVIDER'),
                  service_account: x('vars.GCP_SERVICE_ACCOUNT'),
                }
              : { credentials_json: x('secrets.GCP_SA_KEY') }),
            token_format: 'access_token',
          },
        },
      ],
      prepare: [{ uses: 'google-github-actions/setup-gcloud@v2' }],
    },
    shell: {
      image: 'google/cloud-sdk:slim',
      setup: [
        'printf \'%s\' "$GCP_SA_KEY" > "$HOME/gcp-key.json"',
        'gcloud auth activate-service-account --key-file "$HOME/gcp-key.json"',
      ],
    },
    script: ({ port }) => [
      `gcloud run deploy "$CLOUD_RUN_SERVICE" --image "$IMAGE" --region "$GCP_REGION" --project "$GCP_PROJECT" --port ${port} --quiet`,
    ],
    notes: () => [
      'Cloud Run: create the Artifact Registry repo (GAR_REPO) first. The service is private by default; add --allow-unauthenticated to the deploy command for a public site.',
    ],
  },

  ecs: {
    label: 'AWS ECS (Fargate)',
    registry: 'ecr',
    oidc: true,
    needs: (ctx) => merge(REGISTRIES.ecr.needs(ctx), { secrets: [], vars: ['ECS_CLUSTER', 'ECS_SERVICE'] }),
    github: {
      auth: (oidc) => [
        {
          uses: 'aws-actions/configure-aws-credentials@v4',
          with: oidc
            ? { 'role-to-assume': x('vars.AWS_ROLE_ARN'), 'aws-region': x('vars.AWS_REGION') }
            : {
                'aws-access-key-id': x('secrets.AWS_ACCESS_KEY_ID'),
                'aws-secret-access-key': x('secrets.AWS_SECRET_ACCESS_KEY'),
                'aws-region': x('vars.AWS_REGION'),
              },
        },
      ],
    },
    shell: { image: { name: 'amazon/aws-cli:latest', entrypoint: [''] }, setup: [] },
    script: () => [
      'set -eu',
      'sed "s|IMAGE_PLACEHOLDER|$IMAGE|" ecs/task-definition.json > task-definition.rendered.json',
      'TASK_DEF=$(aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json file://task-definition.rendered.json --query taskDefinition.taskDefinitionArn --output text)',
      'aws ecs update-service --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" --task-definition "$TASK_DEF" > /dev/null',
      'aws ecs wait services-stable --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"',
    ],
    files: (ctx) => [{ path: 'ecs/task-definition.json', content: ecsTaskDefinition(ctx) }],
    notes: () => [
      'ECS: edit ecs/task-definition.json (executionRoleArn, awslogs-region, CPU/memory) and create the cluster, service and ECR repository first.',
    ],
  },

  azure: {
    label: 'Azure Web App for Containers',
    registry: 'acr',
    oidc: true,
    needs: (ctx) => merge(REGISTRIES.acr.needs(ctx), { secrets: [], vars: ['AZURE_WEBAPP_NAME', 'AZURE_RESOURCE_GROUP'] }),
    github: {
      auth: (oidc) => [
        {
          uses: 'azure/login@v2',
          with: oidc
            ? {
                'client-id': x('vars.AZURE_CLIENT_ID'),
                'tenant-id': x('vars.AZURE_TENANT_ID'),
                'subscription-id': x('vars.AZURE_SUBSCRIPTION_ID'),
              }
            : { creds: x('secrets.AZURE_CREDENTIALS') },
        },
      ],
    },
    shell: {
      image: 'mcr.microsoft.com/azure-cli:latest',
      setup: ['az login --service-principal -u "$AZURE_CLIENT_ID" -p "$AZURE_CLIENT_SECRET" --tenant "$AZURE_TENANT_ID" > /dev/null'],
    },
    script: () => [
      'set -eu',
      'az webapp config container set --name "$AZURE_WEBAPP_NAME" --resource-group "$AZURE_RESOURCE_GROUP" --container-image-name "$IMAGE" --container-registry-url "https://$ACR_NAME.azurecr.io" > /dev/null',
      'az webapp restart --name "$AZURE_WEBAPP_NAME" --resource-group "$AZURE_RESOURCE_GROUP"',
    ],
    notes: () => [
      'Azure: the Web App needs pull access to the registry (give its managed identity the AcrPull role) and the service principal needs AcrPush.',
    ],
  },

  fly: {
    label: 'Fly.io',
    registry: null,
    needs: () => ({ secrets: ['FLY_API_TOKEN'], vars: [] }),
    github: { prepare: [{ uses: 'superfly/flyctl-actions/setup-flyctl@master' }] },
    shell: { image: { name: 'flyio/flyctl:latest', entrypoint: [''] }, setup: [] },
    script: () => ['flyctl deploy --remote-only'],
    files: (ctx) => [{ path: 'fly.toml', content: flyToml(ctx) }],
    notes: () => [
      'Fly.io: create the app first (`fly apps create <name>`); Fly builds the image from your Dockerfile itself, so no registry is used. Set primary_region in fly.toml if you want a fixed region.',
    ],
  },
};
