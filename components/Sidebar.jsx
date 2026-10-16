'use client';

import { Check, CheckGroup, ChoiceField, Field, MultiField, Section, SelectField, TextArea, TextField, opts } from './Controls.jsx';
import DeployEnvs from './DeployEnvs.jsx';
import Networks from './Networks.jsx';
import Services from './Services.jsx';
import { LABELS, PRESETS, RUNNERS, RUNTIMES } from '../lib/form.js';

export default function Sidebar({ form, set, meta, show, result }) {
  const { stack } = show;
  const stackOptions = opts(meta.stacks.map((s) => s.id));
  const selectedSteps = form.ciSteps ?? (show.multi ? [...new Set(result?.services?.flatMap((svc) => svc.ci.selected) ?? [])] : result?.ci?.selected) ?? [];
  const runtimes = opts(RUNTIMES[show.versionStack] ?? []);
  const runner = RUNNERS[form.ci];
  const port = stack?.port;

  return (
    <div className="sidebar-body">
      <CheckGroup
        legend="Files to generate"
        field="include"
        options={opts(meta.kinds.filter((k) => k !== 'deploy' || show.deployConfig), LABELS.kinds)}
        value={form.include}
        onChange={(v) => set('include', v)}
      />

      {show.extras && (
        <CheckGroup
          legend="Extra project files"
          field="extras"
          hint="Optional; none by default."
          options={opts(meta.extras, LABELS.extras)}
          value={form.extras}
          onChange={(v) => set('extras', v)}
        />
      )}

      {!show.multi && <SelectField label="Stack" field="stack" value={form.stack} onChange={(v) => set('stack', v)} options={stackOptions} />}
      <Services form={form} set={set} meta={meta} show={show} />
      {show.projectName && (
        <TextField label="Project name" field="name" hint="Names the images and the deployed resources." value={form.name} placeholder="my-project" onChange={(v) => set('name', v)} />
      )}

      {show.tool && (
        <SelectField
          label="Package manager"
          field="tool"
          value={form.tool || stack.tools[0]}
          onChange={(v) => set('tool', v)}
          options={opts(stack.tools)}
        />
      )}
      {show.name && (
        <TextField
          label="Project name"
          field="name"
          hint={LABELS.nameHints[stack.id] ? `${LABELS.nameHints[stack.id]}; also names the images and the deployed resources.` : 'Names the images and the deployed resources.'}
          value={form.name}
          placeholder={LABELS.namePlaceholders[stack.id]}
          onChange={(v) => set('name', v)}
        />
      )}
      {show.buildToggle && (
        <div className="field">
          <Check checked={form.build} onChange={(v) => set('build', v)}>
            Has a build step <span className="hint">(TypeScript, Next.js, Nest…)</span>
          </Check>
        </div>
      )}

      {!show.multi && (
      <div className="row">
        <ChoiceField
          label="Port"
          field="port"
          value={form.port}
          defaultLabel={port ? `Default (${port})` : 'Default'}
          options={opts(PRESETS.ports.filter((p) => p !== String(port)))}
          placeholder="e.g. 3000"
          inputMode="numeric"
          onChange={(v) => set('port', v)}
        />
        <ChoiceField
          label="Runtime"
          field="runtime"
          value={form.runtime}
          defaultLabel="Default"
          options={runtimes}
          placeholder="e.g. 22"
          onChange={(v) => set('runtime', v)}
        />
      </div>
      )}
      {show.buildDir && (
        <ChoiceField
          label="Build output folder"
          field="buildDir"
          value={form.buildDir}
          defaultLabel="Default"
          options={opts(PRESETS.buildDirs)}
          placeholder="e.g. dist"
          onChange={(v) => set('buildDir', v)}
        />
      )}
      {show.databases && (
        <MultiField
          label={show.multi ? 'Services in compose (shared)' : 'Services in compose'}
          field="db"
          hint={show.multi ? 'Databases and queues. Every backend gets them unless it has its own list.' : 'Databases and queues.'}
          options={opts(meta.dbs)}
          value={form.db}
          allowCustom={false}
          onChange={(v) => set('db', v)}
        />
      )}

      {show.multi && show.databases && (
        <div className="field">
          <Check checked={form.dbPerService} field="dbPerService" onChange={(v) => set('dbPerService', v)}>
            A database per service <span className="hint">(shared server; SQL, MongoDB and redis)</span>
          </Check>
        </div>
      )}

      <Section title="Image build">
        {show.variants.length > 1 && (
          <SelectField
            label="Base image"
            field="imageVariant"
            hint="alpine is the smallest; slim is Debian-based and avoids musl surprises. Default: what each stack normally uses."
            value={form.imageVariant}
            onChange={(v) => set('imageVariant', v)}
            options={['', ...show.variants].map((v) => ({ value: v, label: LABELS.variants[v] }))}
          />
        )}
        <div className="field">
          <Check checked={form.multistage} onChange={(v) => set('multistage', v)}>
            Multi-stage build <span className="hint">(recommended: build tools stay out of the final image)</span>
          </Check>
        </div>
        {!form.multistage && (
          <fieldset>
            <legend>One stage</legend>
            {meta.stageModes.map((m) => (
              <label className="check" key={m}>
                <input type="radio" name="stageMode" checked={form.stageMode === m} onChange={() => set('stageMode', m)} />
                <span>{LABELS.stageModes[m]}</span>
              </label>
            ))}
            <span className="hint">
              {form.stageMode === 'production'
                ? 'Compiled languages and static sites copy what you built before docker build; the notes name the exact commands.'
                : 'Everything the build needs stays in the image, so it builds on its own but is larger.'}
            </span>
          </fieldset>
        )}
      </Section>

      {show.compose && <Networks form={form} set={set} show={show} />}

      {show.compose && (
        <MultiField
          label="Environments"
          field="envs"
          hint="A compose override per environment, layered over the base file. dev also gets a Dockerfile.dev with live reload."
          options={opts(['dev', 'qa', 'staging', 'prod'], LABELS.envs)}
          value={form.envs}
          placeholder="Name, e.g. uat"
          onChange={(v) => set('envs', v)}
        />
      )}

      <Section title="Container">
        {show.compose && (
          <SelectField
            label="Compose restart policy"
            field="restart"
            hint="Applied to every service in the compose file."
            value={form.restart}
            onChange={(v) => set('restart', v)}
            options={['', ...meta.restartPolicies].map((v) => ({ value: v, label: LABELS.restart[v] }))}
          />
        )}
        <ChoiceField
          label="Healthcheck path"
          field="healthcheck"
          hint="Adds a HEALTHCHECK probing this path."
          value={form.healthcheck}
          defaultLabel="None"
          options={opts(PRESETS.healthchecks)}
          placeholder="/health"
          onChange={(v) => set('healthcheck', v)}
        />
        {show.packages && (
          <MultiField
            label="OS packages"
            field="packages"
            hint="Installed in the runtime image (apk/apt names)."
            options={opts(PRESETS.packages)}
            value={form.packages}
            placeholder="Package name, e.g. libpq5"
            onChange={(v) => set('packages', v)}
          />
        )}
        {show.env && (
          <TextArea
            label="Environment variables"
            field="env"
            hint="One NAME=value per line, baked into the image. No secrets."
            value={form.env}
            placeholder={'LOG_LEVEL=info\nTZ=UTC'}
            onChange={(v) => set('env', v)}
          />
        )}
        {show.buildArgs && (
          <TextArea
            label="Build args"
            field="buildArgs"
            hint="NAME or NAME=default per line (VITE_API_URL, NEXT_PUBLIC_*). Passed to the build in compose and CI."
            value={form.buildArgs}
            placeholder="VITE_API_URL=http://localhost:3000"
            onChange={(v) => set('buildArgs', v)}
          />
        )}
      </Section>

      {show.ci && (
        <>
          <Section title="CI/CD">
            <SelectField
              label="Provider"
              field="ci"
              value={form.ci}
              onChange={(v) => set('ci', v)}
              options={meta.providers.map((p) => ({ value: p.id, label: p.label }))}
            />
            <ChoiceField
              label="Pipeline name"
              field="pipelineName"
              value={form.pipelineName}
              options={opts(PRESETS.pipelineNames)}
              placeholder="CI"
              onChange={(v) => set('pipelineName', v)}
            />
            {show.multi && (
              <div className="field">
                <Check checked={form.changedOnly} onChange={(v) => set('changedOnly', v)}>
                  Only what changed <span className="hint">(test, build and deploy the services whose folder changed)</span>
                </Check>
              </div>
            )}
            {show.multi && form.changedOnly && (
              <MultiField
                label="Paths that rebuild every service"
                field="sharedPaths"
                hint="Globs, e.g. libs/**. The pipeline file always does."
                options={opts(['libs/**', 'shared/**', 'package.json', 'docker-compose*.yml'])}
                value={form.sharedPaths}
                placeholder="Path or glob"
                onChange={(v) => set('sharedPaths', v)}
              />
            )}
            <div className="field">
              <Check checked={form.testJob} onChange={(v) => set('testJob', v)}>
                Test job <span className="hint">(untick to generate no test job)</span>
              </Check>
            </div>
            {form.testJob && show.ciSteps.length > 0 && (
              <CheckGroup
                legend="Steps in the test job"
                field="ciSteps"
                hint={form.ciSteps ? '' : 'Defaults to what the project defines.'}
                options={opts(show.ciSteps, LABELS.steps)}
                value={selectedSteps}
                onChange={(v) => set('ciSteps', v)}
              />
            )}
            {form.testJob && show.versions && (
              <MultiField
                label="Runtime versions to test"
                field="testVersions"
                hint="One matrix entry per version. None = the project's own version."
                options={runtimes}
                value={form.testVersions}
                placeholder="Version, e.g. 22"
                onChange={(v) => set('testVersions', v)}
              />
            )}
            {form.testJob && show.can('os') && (
              <MultiField
                label="Test on operating systems"
                field="testOs"
                options={opts(meta.pipeline.testOs)}
                value={form.testOs}
                emptyLabel="Default runner"
                allowCustom={false}
                onChange={(v) => set('testOs', v)}
              />
            )}
            {form.testJob && show.can('services') && (
              <MultiField
                label="Service containers for tests"
                field="ciServices"
                hint="Started next to the test job."
                options={opts(meta.dbs)}
                value={form.ciServices}
                allowCustom={false}
                onChange={(v) => set('ciServices', v)}
              />
            )}
          </Section>

          <Section title="When the pipeline runs">
            <p className="hint block">Tick every event that should start it. Each one is independent: a manual-only pipeline needs no push.</p>

            <div className="field">
              <Check checked={form.pushEvent} onChange={(v) => set('pushEvent', v)}>
                A push to a branch
              </Check>
            </div>
            {form.pushEvent && (
              <>
                <MultiField
                  label="Branches"
                  field="branches"
                  hint="Globs allowed (release/*)."
                  options={opts(PRESETS.branches)}
                  value={form.branches}
                  placeholder="Branch or glob"
                  onChange={(v) => set('branches', v)}
                />
                {show.can('branchIgnore') && (
                  <MultiField
                    label="Never run for branches"
                    field="branchesIgnore"
                    options={opts(PRESETS.branchesIgnore)}
                    value={form.branchesIgnore}
                    placeholder="Branch or glob"
                    onChange={(v) => set('branchesIgnore', v)}
                  />
                )}
              </>
            )}

            <div className="field">
              <Check checked={form.tagEvent} onChange={(v) => set('tagEvent', v)}>
                A tag is pushed
              </Check>
            </div>
            {form.tagEvent && (
              <>
                <MultiField label="Tags" field="tags" hint="Globs such as v*." options={opts(PRESETS.tags)} value={form.tags} placeholder="Tag glob" onChange={(v) => set('tags', v)} />
                {show.can('tagFilters') && (
                  <MultiField label="Never run for tags" field="tagsIgnore" options={opts(PRESETS.tagsIgnore)} value={form.tagsIgnore} placeholder="Tag glob" onChange={(v) => set('tagsIgnore', v)} />
                )}
              </>
            )}

            <div className="field">
              <Check checked={form.pullRequests} onChange={(v) => set('pullRequests', v)}>
                A pull / merge request
              </Check>
            </div>
            {show.can('prBranches') && form.pullRequests && (
              <MultiField
                label="Pull requests targeting"
                field="prBranches"
                hint="None = any branch."
                options={opts(PRESETS.prBranches)}
                value={form.prBranches}
                placeholder="Branch or glob"
                onChange={(v) => set('prBranches', v)}
              />
            )}

            <div className="field">
              <Check checked={form.manual} onChange={(v) => set('manual', v)}>
                A manual run <span className="hint">(workflow_dispatch / Run pipeline; asks which CI steps to run)</span>
              </Check>
            </div>

            {show.can('release') && (
              <div className="field">
                <Check checked={form.release} onChange={(v) => set('release', v)}>
                  A release is published
                </Check>
              </div>
            )}

            {show.can('schedule') && (
              <>
                <div className="field">
                  <Check checked={form.scheduleEvent} onChange={(v) => set('scheduleEvent', v)}>
                    On a schedule
                  </Check>
                </div>
                {form.scheduleEvent && (
                  <MultiField
                    label="Schedules"
                    field="schedule"
                    hint="Cron entries (5 fields), UTC."
                    options={PRESETS.schedules.map((o) => ({ value: o.value, label: `${o.label} (${o.value})` }))}
                    value={form.schedule}
                    separator={null}
                    placeholder="Cron, e.g. 30 2 * * 1"
                    onChange={(v) => set('schedule', v)}
                  />
                )}
              </>
            )}

            {show.can('paths') && (form.pushEvent || form.pullRequests) && (
              <>
                <MultiField
                  label="Only when these paths change"
                  field="paths"
                  hint="For pushes and pull requests. None = always."
                  options={opts(PRESETS.paths)}
                  value={form.paths}
                  placeholder="Path glob"
                  onChange={(v) => set('paths', v)}
                />
                <MultiField
                  label="Ignore changes to"
                  field="pathsIgnore"
                  options={opts(PRESETS.pathsIgnore)}
                  value={form.pathsIgnore}
                  placeholder="Path glob"
                  onChange={(v) => set('pathsIgnore', v)}
                />
              </>
            )}
            {!form.pushEvent && !form.tagEvent && !form.pullRequests && !form.manual && !form.release && !form.scheduleEvent && (
              <p className="hint block error" role="alert">Pick at least one event, or the pipeline would never run.</p>
            )}
          </Section>

          <Section title="Pipeline settings">
            <SelectField
              label="Concurrency"
              field="concurrency"
              value={form.concurrency}
              onChange={(v) => set('concurrency', v)}
              options={opts(meta.pipeline.concurrency, LABELS.concurrency)}
            />
            {show.can('runner') && runner && (
              <ChoiceField
                label="Runner / agent"
                field="runner"
                hint="GitHub runs-on label, Azure vmImage or Jenkins agent label."
                value={form.runner}
                defaultLabel={`Default (${runner.default})`}
                options={opts(runner.options)}
                placeholder="Label"
                onChange={(v) => set('runner', v)}
              />
            )}
            {show.can('timeout') && (
              <ChoiceField
                label="Job timeout"
                field="timeout"
                value={form.timeout}
                defaultLabel="Default (no limit)"
                options={PRESETS.timeouts.map((m) => ({ value: m, label: `${m} minutes` }))}
                placeholder="Minutes, e.g. 25"
                inputMode="numeric"
                onChange={(v) => set('timeout', v)}
              />
            )}
            <TextArea
              label="Pipeline environment variables"
              field="pipelineEnv"
              hint="One NAME=value per line, set for every job. No secrets."
              value={form.pipelineEnv}
              placeholder={'LOG_LEVEL=info'}
              onChange={(v) => set('pipelineEnv', v)}
            />
            <div className="field">
              <Check checked={form.failFast} onChange={(v) => set('failFast', v)}>
                Cancel the rest of a matrix when one entry fails <span className="hint">(fail-fast)</span>
              </Check>
              {show.can('depCache') && (
                <Check checked={form.depCache} onChange={(v) => set('depCache', v)}>
                  Cache dependencies
                </Check>
              )}
              {show.can('pinActions') && (
                <Check checked={form.pinActions} onChange={(v) => set('pinActions', v)}>
                  Pin actions to commit SHAs <span className="hint">(recommended; a tag can be moved after the fact)</span>
                </Check>
              )}
            </div>
            {show.can('permissions') && (
              <MultiField
                label="Token permissions"
                field="permissions"
                hint="contents: read is always the base."
                options={opts(meta.pipeline.permissions, Object.fromEntries(meta.pipeline.permissions.map((v) => [v, LABELS.permissions[v] ?? v.replace(/-(read|write)$/, ': $1')])))}
                value={form.permissions}
                emptyLabel="Base permissions only"
                allowCustom={false}
                onChange={(v) => set('permissions', v)}
              />
            )}
          </Section>

          {show.imageSupply && (
            <Section title="Image publishing">
              <CheckGroup
                legend="Image tags"
                field="imageTags"
                hint="Besides the commit sha, which is always pushed."
                options={opts(meta.pipeline.imageTags, LABELS.imageTags)}
                value={form.imageTags}
                onChange={(v) => set('imageTags', v)}
              />
              {show.can('platforms') && (
                <MultiField
                  label="Image platforms"
                  field="platforms"
                  options={opts(meta.pipeline.platforms)}
                  value={form.platforms}
                  allowCustom={false}
                  onChange={(v) => set('platforms', v)}
                />
              )}
              {show.can('layerCache') && (
                <div className="field">
                  <Check checked={form.layerCache} onChange={(v) => set('layerCache', v)}>
                    Docker layer cache
                  </Check>
                </div>
              )}
            </Section>
          )}

          <Section title="Security & quality">
            <div className="field">
              {show.imageSupply && (
                <Check checked={form.scan} onChange={(v) => set('scan', v)}>
                  Scan the image for vulnerabilities <span className="hint">(Trivy)</span>
                </Check>
              )}
              <Check checked={form.lintDockerfile} onChange={(v) => set('lintDockerfile', v)}>
                Lint the Dockerfile <span className="hint">(Hadolint; fails on errors)</span>
              </Check>
              {show.can('codeScan') && (
                <Check checked={form.codeScan} onChange={(v) => set('codeScan', v)}>
                  Static code analysis <span className="hint">({show.github ? 'CodeQL' : 'GitLab SAST'})</span>
                </Check>
              )}
              {show.imageSupply && show.can('sbom') && (
                <Check checked={form.sbom} onChange={(v) => set('sbom', v)}>
                  SBOM and provenance attestations <span className="hint">(attached to the image)</span>
                </Check>
              )}
              {show.imageSupply && show.can('sign') && (
                <Check checked={form.sign} onChange={(v) => set('sign', v)}>
                  Sign the image <span className="hint">(cosign, keyless via GitHub OIDC)</span>
                </Check>
              )}
            </div>
            {show.imageSupply && form.scan && (
              <CheckGroup
                legend="Fail the scan on"
                field="scanSeverity"
                options={opts(meta.pipeline.severities, LABELS.severities)}
                value={form.scanSeverity}
                onChange={(v) => set('scanSeverity', v)}
              />
            )}
          </Section>

          <Section title="Deployment">
            <SelectField
              label="Deploy to"
              field="deploy"
              value={form.deploy}
              onChange={(v) => set('deploy', v)}
              options={meta.targets.map((t) => ({ value: t.id, label: t.label }))}
            />
            {form.deploy === 'kubernetes' && (
              <TextField label="Replicas" field="replicas" hint="Pods per service (default 2)." value={form.replicas} placeholder="2" inputMode="numeric" onChange={(v) => set('replicas', v)} />
            )}
            {show.registryChoice && (
              <SelectField
                label="Image registry"
                field="registry"
                value={show.registries.some((r) => r.id === form.registry) ? form.registry : show.registries[0].id}
                onChange={(v) => set('registry', v)}
                options={show.registries.map((r) => ({ value: r.id, label: r.label }))}
              />
            )}
            {show.deployMore && form.deployTo.length > 0 && <DeployEnvs form={form} set={set} meta={meta} />}
            {show.deployMore && form.deployTo.length === 0 && (
              <>
                <SelectField
                  label="Deploy when"
                  field="deployOn"
                  value={form.deployOn}
                  onChange={(v) => set('deployOn', v)}
                  options={opts(meta.pipeline.deployOn, LABELS.deployOn)}
                />
                <ChoiceField
                  label="Environment"
                  field="environment"
                  hint="Lets you add approvals and scope secrets."
                  value={form.environment}
                  defaultLabel="Default (production)"
                  options={opts(PRESETS.environments.filter((e) => e !== 'production'))}
                  placeholder="Environment name"
                  onChange={(v) => set('environment', v)}
                />
                <DeployEnvs form={form} set={set} meta={meta} />
              </>
            )}
            {show.oidc && (
              <SelectField
                label="Cloud login"
                field="cloudAuth"
                hint="How GitHub signs in to GCP, AWS or Azure. OIDC needs a trust set up in the cloud (the setup notes list it); stored keys are long-lived secrets."
                value={form.cloudAuth}
                onChange={(v) => set('cloudAuth', v)}
                options={opts(meta.pipeline.cloudAuth, LABELS.cloudAuth)}
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}
