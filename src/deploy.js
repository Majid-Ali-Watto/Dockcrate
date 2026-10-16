import { lines } from './fsutil.js';
import { VERSIONS } from './tools.js';

// GitHub Actions expression, kept out of template literals so `${{` stays readable.
const x = (expr) => '${{ ' + expr + ' }}';
const NOT_PR = "github.event_name != 'pull_request'";

/**
 * What deploying needs to know about each app, on top of what the pipeline knows. With one app the names are the classic ones
 * (IMAGE, APP_IMAGE, the project name); with several, everything is per service: IMAGE_API, API_IMAGE, <project>-api.
 */
export function deployApps(appName, apps) {
  const multi = apps.length > 1;
  return apps.map((app) => {
    const key = app.id.toUpperCase().replace(/-/g, '_');
    return {
      ...app,
      multi,
      key,
      name: multi ? `${appName}-${app.id}` : appName,
      imageEnv: multi ? `IMAGE_${key}` : 'IMAGE',
      composeImage: multi ? `${key}_IMAGE` : 'APP_IMAGE',
      k8sDir: multi ? `k8s/${app.id}` : 'k8s',
      ecsDir: multi ? `ecs/${app.id}` : 'ecs',
      suffix: multi ? `-${app.id}` : '',
    };
  });
}

/**
 * When only changed services are deployed, DEPLOY_SERVICES is `,all,` or `,api,web,` (empty: `,`). These lines stop when nothing
 * changed and define `deploy_it <service>`; `gate` wraps one service's commands in it.
 */
const changedHead = (ctx) =>
  ctx.changedOnly
    ? [
        'if [ "${DEPLOY_SERVICES:-,all,}" = "," ]; then echo "No service changed: nothing to deploy"; exit 0; fi',
        'deploy_it() { case "${DEPLOY_SERVICES:-,all,}" in *,all,*|*,"$1",*) return 0;; *) return 1;; esac; }',
      ]
    : [];
const gate = (ctx, app, lines) => (ctx.changedOnly ? [`if deploy_it ${app.id}; then`, ...lines.map((l) => `  ${l}`), 'fi'] : lines);

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

/** A volume name for a writable folder: /app/tmp -> app-tmp. */
const volumeName = (path) => path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

const k8sDeployment = ({ appName, port, healthcheck = '', replicas = 2, runAs = null }) => {
  // Without the stack's user (an image built elsewhere) the pod still refuses to run as root.
  const readOnly = runAs ? runAs.readOnlyRoot : false;
  const writable = runAs ? (readOnly ? runAs.writable : ['/tmp']) : [];
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
    `  replicas: ${replicas}`,
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
    '        runAsNonRoot: true',
    ...(runAs ? [`        runAsUser: ${runAs.uid}`, `        runAsGroup: ${runAs.gid}`] : []),
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
    ...(readOnly
      ? ['            readOnlyRootFilesystem: true']
      : runAs
        ? [`            # readOnlyRootFilesystem is off: ${runAs.why || 'the app writes inside its own folder'}.`, '            readOnlyRootFilesystem: false']
        : []),
    '            capabilities:',
    '              drop: [ALL]',
    ...(writable.length ? ['          # The folders the app writes to (the image itself is read-only).', '          volumeMounts:', ...writable.flatMap((path) => [`            - name: ${volumeName(path)}`, `              mountPath: ${path}`])] : []),
    '          resources:',
    '            requests:',
    '              cpu: 100m',
    '              memory: 128Mi',
    '            limits:',
    '              memory: 512Mi',
    ...(writable.length ? ['      volumes:', ...writable.flatMap((path) => [`        - name: ${volumeName(path)}`, '          emptyDir: {}'])] : []),
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

const ecsTaskDefinition = ({ appName, port, runAs = null }) =>
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
          // The image's own non-root user, by number, so the task never falls back to root.
          ...(runAs && { user: `${runAs.uid}:${runAs.gid}` }),
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
    shell: { image: VERSIONS.alpine, setup: ['apk add --no-cache openssh-client'] },
    script: (ctx) => {
      const { composeFile, composeFiles = [composeFile], apps } = ctx;
      const vars = apps.map((a) => `${a.composeImage}=$${a.imageEnv}`).join(' ');
      const flags = composeFiles.length > 1 ? composeFiles.map((f) => ` -f ${f}`).join('') : '';
      return [
        'set -eu',
        ...changedHead(ctx).slice(0, 1),
        ...(ctx.changedOnly ? ['SERVICES=""', 'case "${DEPLOY_SERVICES:-,all,}" in *,all,*) ;; *) SERVICES=$(printf \'%s\' "$DEPLOY_SERVICES" | tr \',\' \' \') ;; esac'] : []),
        'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
        'printf \'%s\\n\' "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519',
        'printf \'%s\\n\' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts',
        'REMOTE="$SSH_USER@$SSH_HOST"',
        '# These variables expand here, on the runner, on purpose:',
        '# shellcheck disable=SC2029',
        'ssh "$REMOTE" "mkdir -p $DEPLOY_PATH"',
        ...composeFiles.map((f) => `scp ${f} "$REMOTE:$DEPLOY_PATH/${f}"`),
        '# The registry login only lasts for the pull: docker logout removes the token from the server (the trap also on failure).',
        '# shellcheck disable=SC2029',
        `printf '%s' "$REGISTRY_TOKEN" | ssh "$REMOTE" "trap 'docker logout $REGISTRY >/dev/null' EXIT; docker login $REGISTRY -u $REGISTRY_USER --password-stdin && cd $DEPLOY_PATH && ${vars} docker compose${flags} pull${ctx.changedOnly ? ' $SERVICES' : ''} && docker logout $REGISTRY && ${vars} docker compose${flags} up -d --remove-orphans${ctx.changedOnly ? ' $SERVICES' : ''}"`,
      ];
    },
    notes: () => [
      'SSH: get SSH_KNOWN_HOSTS with `ssh-keyscan -H <host>`; the server needs Docker with the compose plugin, and a .env next to the compose file with the passwords of .env.example (compose refuses to start without them) and whatever else the app needs. Use a deploy user in the docker group, not root; the registry token is removed from the server (docker logout) after each pull.',
    ],
  },

  kubernetes: {
    label: 'Kubernetes (kubectl)',
    registry: 'builtin',
    needs: () => ({ secrets: ['KUBE_CONFIG'], vars: ['K8S_NAMESPACE?'] }),
    shell: { image: VERSIONS.alpine, setup: ['apk add --no-cache kubectl'] },
    script: (ctx) => [
      'set -eu',
      ...changedHead(ctx),
      'mkdir -p ~/.kube && printf \'%s\' "$KUBE_CONFIG" | base64 -d > ~/.kube/config && chmod 600 ~/.kube/config',
      'NS="${K8S_NAMESPACE:-default}"',
      ...ctx.apps.flatMap((a) =>
        gate(ctx, a, [
          `kubectl apply -n "$NS" -f ${a.k8sDir}/service.yaml`,
          `sed "s|IMAGE_PLACEHOLDER|$${a.imageEnv}|" ${a.k8sDir}/deployment.yaml | kubectl apply -n "$NS" -f -`,
        ]),
      ),
      ...ctx.apps.flatMap((a) => gate(ctx, a, [`kubectl rollout status -n "$NS" deployment/${a.name} --timeout=180s`])),
    ],
    files: ({ apps, replicas }) =>
      apps.flatMap((a) => [
        { path: `${a.k8sDir}/deployment.yaml`, content: k8sDeployment({ appName: a.name, port: a.port, healthcheck: a.healthcheck, replicas, runAs: a.runAs }) },
        { path: `${a.k8sDir}/service.yaml`, content: k8sService({ appName: a.name, port: a.port }) },
      ]),
    notes: () => [
      'Kubernetes: KUBE_CONFIG is a base64-encoded kubeconfig (`base64 -w0 deploy.kubeconfig`). Do not use your own ~/.kube/config (usually cluster-admin): create a ServiceAccount in the target namespace with a Role that can only manage Deployments and Services there, and a kubeconfig with its token. Pods run as the image\'s numeric non-root user with a read-only root file system (except PHP, where Laravel writes inside the app folder), writing only to emptyDir volumes (/tmp and the folders the app needs). A private registry needs an imagePullSecret in the cluster; the Service is ClusterIP, so add an Ingress for public traffic. The pods read optional settings from a Secret named <app>-env (kubectl create secret generic <app>-env --from-literal=KEY=value).',
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
      image: VERSIONS.cloudSdk,
      setup: [
        'printf \'%s\' "$GCP_SA_KEY" > "$HOME/gcp-key.json"',
        'gcloud auth activate-service-account --key-file "$HOME/gcp-key.json"',
      ],
    },
    script: (ctx) => [
      ...changedHead(ctx),
      ...ctx.apps.flatMap((a) =>
        gate(ctx, a, [`gcloud run deploy "$CLOUD_RUN_SERVICE${a.suffix}" --image "$${a.imageEnv}" --region "$GCP_REGION" --project "$GCP_PROJECT" --port ${a.port} --quiet`]),
      ),
    ],
    multiNote: 'Cloud Run: CLOUD_RUN_SERVICE is the name prefix; each service is deployed as <CLOUD_RUN_SERVICE>-<service>.',
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
    shell: { image: { name: VERSIONS.awsCli, entrypoint: [''] }, setup: [] },
    script: (ctx) => [
      'set -eu',
      ...changedHead(ctx),
      ...ctx.apps.flatMap((a) => {
        const rendered = `task-definition${a.multi ? `.${a.id}` : ''}.rendered.json`;
        const service = `"$ECS_SERVICE${a.suffix}"`;
        const def = a.multi ? `TASK_DEF_${a.key}` : 'TASK_DEF';
        return gate(ctx, a, [
          `sed "s|IMAGE_PLACEHOLDER|$${a.imageEnv}|" ${a.ecsDir}/task-definition.json > ${rendered}`,
          `${def}=$(aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json file://${rendered} --query taskDefinition.taskDefinitionArn --output text)`,
          `aws ecs update-service --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --service ${service} --task-definition "$${def}" > /dev/null`,
        ]);
      }),
      ...ctx.apps.flatMap((a) => gate(ctx, a, [`aws ecs wait services-stable --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE${a.suffix}"`])),
    ],
    multiNote: 'ECS: ECS_SERVICE is the name prefix; each service is deployed as <ECS_SERVICE>-<service>, with its own task definition under ecs/<service>/, and ECR repositories are <ECR_REPOSITORY>/<service>.',
    files: ({ apps }) => apps.map((a) => ({ path: `${a.ecsDir}/task-definition.json`, content: ecsTaskDefinition({ appName: a.name, port: a.port, runAs: a.runAs }) })),
    notes: () => [
      'ECS: edit ecs/task-definition.json (executionRoleArn, awslogs-region, CPU/memory) and create the cluster, service and ECR repository first. The container runs as the image\'s numeric non-root user; readonlyRootFilesystem is left off because Fargate volumes are owned by root, so the app could not write /tmp: add one per writable folder if you turn it on.',
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
      image: VERSIONS.azureCli,
      setup: ['az login --service-principal -u "$AZURE_CLIENT_ID" -p "$AZURE_CLIENT_SECRET" --tenant "$AZURE_TENANT_ID" > /dev/null'],
    },
    script: (ctx) => [
      'set -eu',
      ...changedHead(ctx),
      ...ctx.apps.flatMap((a) =>
        gate(ctx, a, [
          `az webapp config container set --name "$AZURE_WEBAPP_NAME${a.suffix}" --resource-group "$AZURE_RESOURCE_GROUP" --container-image-name "$${a.imageEnv}" --container-registry-url "https://$ACR_NAME.azurecr.io" > /dev/null`,
          `az webapp restart --name "$AZURE_WEBAPP_NAME${a.suffix}" --resource-group "$AZURE_RESOURCE_GROUP"`,
        ]),
      ),
    ],
    multiNote: 'Azure: AZURE_WEBAPP_NAME is the name prefix; each service is its own Web App named <AZURE_WEBAPP_NAME>-<service>.',
    notes: () => [
      'Azure: the Web App needs pull access to the registry (give its managed identity the AcrPull role) and the service principal needs AcrPush.',
    ],
  },

  fly: {
    label: 'Fly.io',
    registry: null,
    needs: () => ({ secrets: ['FLY_API_TOKEN'], vars: [] }),
    github: { prepare: [{ uses: 'superfly/flyctl-actions/setup-flyctl@1.5', with: { version: VERSIONS.flyctlVersion } }] },
    shell: { image: { name: VERSIONS.flyctl, entrypoint: [''] }, setup: [] },
    script: (ctx) => [
      ...changedHead(ctx),
      ...ctx.apps.flatMap((a) => gate(ctx, a, [a.dir === '.' ? 'flyctl deploy --remote-only' : `(cd ${a.dir} && flyctl deploy --remote-only)`])),
    ],
    files: ({ apps }) => apps.map((a) => ({ path: a.dir === '.' ? 'fly.toml' : `${a.dir}/fly.toml`, content: flyToml({ appName: a.name, port: a.port }) })),
    multiNote: 'Fly.io: each service is its own app, <project>-<service>, with a fly.toml in its folder; create them with `fly apps create`.',
    notes: () => [
      'Fly.io: create the app first (`fly apps create <name>`); Fly builds the image from your Dockerfile itself, so no registry is used. Set primary_region in fly.toml if you want a fixed region.',
    ],
  },
};
