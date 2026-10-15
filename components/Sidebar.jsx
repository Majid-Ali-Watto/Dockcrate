'use client';

import { Check, CheckGroup, ChoiceField, Field, MultiField, Section, SelectField, TextArea, TextField, opts } from './Controls.jsx';
import { LABELS, PRESETS, RUNNERS, RUNTIMES } from '../lib/form.js';

export default function Sidebar({ form, set, meta, show, result, onBrowse }) {
  const { isNew, stack } = show;
  const stackOptions = [...(isNew ? [] : [{ value: '', label: 'Auto-detect' }]), ...opts(meta.stacks.map((s) => s.id))];
  const selectedSteps = form.ciSteps ?? result?.ci?.selected ?? [];
  const runtimes = opts(RUNTIMES[stack?.id] ?? []);
  const runner = RUNNERS[form.ci];
  const port = stack?.port;

  return (
    <div className="sidebar-body">
      {!meta.hosted && (
        <>
          <fieldset>
            <legend>Generate for</legend>
            <label className="check">
              <input type="radio" name="mode" checked={!isNew} onChange={() => set('mode', 'existing')} />
              <span>Existing project</span>
            </label>
            <label className="check">
              <input type="radio" name="mode" checked={isNew} onChange={() => set('mode', 'new')} />
              <span>New project</span>
            </label>
          </fieldset>

          <Field
            label={isNew ? 'Write to folder (optional)' : 'Project folder'}
            hint={
              isNew
                ? 'Only needed to write the files. A folder that does not exist yet is created. Leave empty to preview, copy or download.'
                : 'Pick a folder, or paste a path (~ works).'
            }
          >
            {(id) => (
              <div className="pathrow">
                <input id={id} type="text" value={form.dirs[form.mode]} spellCheck={false} autoComplete="off" onChange={(e) => set('dir', e.target.value)} />
                <button type="button" onClick={onBrowse}>
                  Browse…
                </button>
              </div>
            )}
          </Field>
        </>
      )}

      <SelectField label="Stack" value={form.stack} onChange={(v) => set('stack', v)} options={stackOptions} />

      {show.tool && (
        <SelectField
          label="Package manager / build tool"
          value={form.tool || stack.tools[0]}
          onChange={(v) => set('tool', v)}
          options={opts(stack.tools)}
        />
      )}
      {show.name && (
        <TextField
          label="Project name"
          hint={LABELS.nameHints[stack.id]}
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

      <div className="row">
        <ChoiceField
          label="Port"
          value={form.port}
          defaultLabel={port ? `Default (${port})` : 'Default'}
          options={opts(PRESETS.ports.filter((p) => p !== String(port)))}
          placeholder="e.g. 3000"
          inputMode="numeric"
          onChange={(v) => set('port', v)}
        />
        <ChoiceField
          label="Runtime"
          value={form.runtime}
          defaultLabel={isNew ? 'Default' : 'Default (detected)'}
          options={runtimes}
          placeholder="e.g. 22"
          onChange={(v) => set('runtime', v)}
        />
      </div>
      {show.buildDir && (
        <ChoiceField
          label="Build output folder"
          value={form.buildDir}
          defaultLabel="Default"
          options={opts(PRESETS.buildDirs)}
          placeholder="e.g. dist"
          onChange={(v) => set('buildDir', v)}
        />
      )}
      {show.databases && (
        <MultiField
          label="Services in compose"
          hint="Databases and queues."
          options={opts(meta.dbs)}
          value={form.db}
          allowCustom={false}
          onChange={(v) => set('db', v)}
        />
      )}

      <CheckGroup
        legend="Files to generate"
        options={opts(meta.kinds.filter((k) => k !== 'deploy' || show.deployConfig), LABELS.kinds)}
        value={form.include}
        onChange={(v) => set('include', v)}
      />

      {show.extras && (
        <CheckGroup
          legend="Extra project files"
          hint="(optional)"
          options={opts(meta.extras, LABELS.extras)}
          value={form.extras}
          onChange={(v) => set('extras', v)}
        />
      )}

      <Section title="Container">
        <ChoiceField
          label="Healthcheck path"
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
            hint="One NAME=value per line, baked into the image. No secrets."
            value={form.env}
            placeholder={'LOG_LEVEL=info\nTZ=UTC'}
            onChange={(v) => set('env', v)}
          />
        )}
        {show.buildArgs && (
          <TextArea
            label="Build args"
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
              value={form.ci}
              onChange={(v) => set('ci', v)}
              options={meta.providers.map((p) => ({ value: p.id, label: p.label }))}
            />
            <ChoiceField
              label="Pipeline name"
              value={form.pipelineName}
              options={opts(PRESETS.pipelineNames)}
              placeholder="CI"
              onChange={(v) => set('pipelineName', v)}
            />
            <div className="field">
              <Check checked={form.testJob} onChange={(v) => set('testJob', v)}>
                Test job <span className="hint">(untick to generate no test job)</span>
              </Check>
            </div>
            {form.testJob && show.ciSteps.length > 0 && (
              <CheckGroup
                legend="Steps in the test job"
                hint={form.ciSteps ? '' : '(defaults to what the project defines)'}
                options={opts(show.ciSteps, LABELS.steps)}
                value={selectedSteps}
                onChange={(v) => set('ciSteps', v)}
              />
            )}
            {form.testJob && (
              <MultiField
                label="Runtime versions to test"
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
                hint="Started next to the test job."
                options={opts(meta.dbs)}
                value={form.ciServices}
                allowCustom={false}
                onChange={(v) => set('ciServices', v)}
              />
            )}
          </Section>

          <Section title="Triggers">
            <div className="field">
              <Check checked={form.pullRequests} onChange={(v) => set('pullRequests', v)}>
                Pull / merge requests
              </Check>
              {show.can('release') && (
                <Check checked={form.release} onChange={(v) => set('release', v)}>
                  When a release is published
                </Check>
              )}
              <Check checked={form.manual} onChange={(v) => set('manual', v)}>
                Manual runs
              </Check>
            </div>
            <MultiField
              label="Push to branches"
              hint="Globs allowed (release/*). None = no branch pushes."
              options={opts(PRESETS.branches)}
              value={form.branches}
              placeholder="Branch or glob"
              onChange={(v) => set('branches', v)}
            />
            {show.can('branchIgnore') && (
              <MultiField
                label="Never run for branches"
                options={opts(PRESETS.branchesIgnore)}
                value={form.branchesIgnore}
                placeholder="Branch or glob"
                onChange={(v) => set('branchesIgnore', v)}
              />
            )}
            <MultiField
              label="Push of tags"
              hint="Globs such as v*. None = no tag runs."
              options={opts(PRESETS.tags)}
              value={form.tags}
              placeholder="Tag glob"
              onChange={(v) => set('tags', v)}
            />
            {show.can('tagFilters') && (
              <MultiField
                label="Never run for tags"
                options={opts(PRESETS.tagsIgnore)}
                value={form.tagsIgnore}
                placeholder="Tag glob"
                onChange={(v) => set('tagsIgnore', v)}
              />
            )}
            {show.can('prBranches') && form.pullRequests && (
              <MultiField
                label="Pull requests targeting"
                hint="None = any branch."
                options={opts(PRESETS.prBranches)}
                value={form.prBranches}
                placeholder="Branch or glob"
                onChange={(v) => set('prBranches', v)}
              />
            )}
            {show.can('paths') && (
              <>
                <MultiField
                  label="Only when these paths change"
                  hint="None = always."
                  options={opts(PRESETS.paths)}
                  value={form.paths}
                  placeholder="Path glob"
                  onChange={(v) => set('paths', v)}
                />
                <MultiField
                  label="Ignore changes to"
                  options={opts(PRESETS.pathsIgnore)}
                  value={form.pathsIgnore}
                  placeholder="Path glob"
                  onChange={(v) => set('pathsIgnore', v)}
                />
              </>
            )}
            {show.can('schedule') && (
              <MultiField
                label="Schedules"
                hint="Cron entries (5 fields), UTC."
                options={PRESETS.schedules.map((o) => ({ value: o.value, label: `${o.label} (${o.value})` }))}
                value={form.schedule}
                separator={null}
                placeholder="Cron, e.g. 30 2 * * 1"
                onChange={(v) => set('schedule', v)}
              />
            )}
          </Section>

          <Section title="Pipeline settings">
            <SelectField
              label="Concurrency"
              value={form.concurrency}
              onChange={(v) => set('concurrency', v)}
              options={opts(meta.pipeline.concurrency, LABELS.concurrency)}
            />
            {show.can('runner') && runner && (
              <ChoiceField
                label="Runner / agent"
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
            <Section title="Image">
              <CheckGroup
                legend="Image tags"
                hint="(besides the commit sha, which is always pushed)"
                options={opts(meta.pipeline.imageTags, LABELS.imageTags)}
                value={form.imageTags}
                onChange={(v) => set('imageTags', v)}
              />
              {show.can('platforms') && (
                <MultiField
                  label="Image platforms"
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
                options={opts(meta.pipeline.severities, LABELS.severities)}
                value={form.scanSeverity}
                onChange={(v) => set('scanSeverity', v)}
              />
            )}
          </Section>

          <Section title="Deployment">
            <SelectField
              label="Deploy to"
              value={form.deploy}
              onChange={(v) => set('deploy', v)}
              options={meta.targets.map((t) => ({ value: t.id, label: t.label }))}
            />
            {show.registryChoice && (
              <SelectField
                label="Image registry"
                value={show.registries.some((r) => r.id === form.registry) ? form.registry : show.registries[0].id}
                onChange={(v) => set('registry', v)}
                options={show.registries.map((r) => ({ value: r.id, label: r.label }))}
              />
            )}
            {show.deployMore && (
              <>
                <SelectField
                  label="Deploy when"
                  value={form.deployOn}
                  onChange={(v) => set('deployOn', v)}
                  options={opts(meta.pipeline.deployOn, LABELS.deployOn)}
                />
                <ChoiceField
                  label="Environment"
                  hint="Lets you add approvals and scope secrets."
                  value={form.environment}
                  defaultLabel="Default (production)"
                  options={opts(PRESETS.environments.filter((e) => e !== 'production'))}
                  placeholder="Environment name"
                  onChange={(v) => set('environment', v)}
                />
              </>
            )}
            {show.oidc && (
              <p className="hint block">
                Tick “id-token: write” under Token permissions to log in with OIDC (no stored keys). Otherwise the pipeline reads a key
                from a secret.
              </p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
