'use client';

import { Field, SelectField, opts } from './Controls.jsx';
import { LABELS } from '../lib/form.js';

const field = (value, onChange, props = {}) => (id) => (
  <input id={id} type="text" value={value ?? ''} spellCheck={false} autoComplete="off" onChange={(e) => onChange(e.target.value)} {...props} />
);

/** Several environments, each with its own deploy rule: a branch (or prefix*), a tag (or prefix*), or a manual run. */
export default function DeployEnvs({ form, set, meta }) {
  const list = form.deployTo;
  const edit = (next) => set('deployTo', next);
  const update = (i, patch) => edit(list.map((d, n) => (n === i ? { ...d, ...patch } : d)));

  if (!list.length) {
    return (
      <div className="field">
        <button
          type="button"
          onClick={() =>
            edit([
              { name: 'qa', on: 'branch', match: 'develop' },
              { name: form.environment || 'production', on: 'tag', match: 'v*' },
            ])
          }
        >
          Deploy to several environments
        </button>
      </div>
    );
  }
  return (
    <div className="services">
      <div className="label">Deploy environments ({list.length})</div>
      {list.map((d, i) => (
        <fieldset className="service" key={i}>
          <legend>{d.name || `Environment ${i + 1}`}</legend>
          <div className="row">
            <Field label="Environment">{field(d.name, (v) => update(i, { name: v }), { placeholder: 'qa' })}</Field>
            <SelectField label="Deploy when" value={d.on} onChange={(v) => update(i, { on: v, ...(v === 'manual' && { match: '' }) })} options={opts(meta.pipeline.deployOn, LABELS.deployOn)} />
          </div>
          {d.on !== 'manual' && (
            <Field label={d.on === 'tag' ? 'Tags' : 'Branch'} hint="A name or a prefix ending in *. Empty: the default branch, or any tag.">
              {field(d.match, (v) => update(i, { match: v }), { placeholder: d.on === 'tag' ? 'v*' : 'develop or release/*' })}
            </Field>
          )}
          {list.length > 1 && (
            <button type="button" className="remove" onClick={() => edit(list.filter((_, n) => n !== i))}>
              Remove {d.name || 'environment'}
            </button>
          )}
        </fieldset>
      ))}
      <div className="service-actions">
        <button type="button" onClick={() => edit([...list, { name: `env-${list.length + 1}`, on: 'manual' }])}>
          + Add environment
        </button>
        <button type="button" onClick={() => edit([])}>
          Back to one environment
        </button>
      </div>
    </div>
  );
}
