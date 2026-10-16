'use client';

import { Field, SelectField, opts } from './Controls.jsx';
import { focusSoon } from './focus.js';
import { useUndo } from './Undo.jsx';
import { LABELS, uid } from '../lib/form.js';

const field = (value, onChange, props = {}) => (id, aria) => (
  <input id={id} {...aria} type="text" value={value ?? ''} spellCheck={false} autoComplete="off" onChange={(e) => onChange(e.target.value)} {...props} />
);
const nameInput = (key) => `[data-uid="${key}"] input`;

/** Several environments, each with its own deploy rule: a branch (or prefix*), a tag (or prefix*), or a manual run. */
export default function DeployEnvs({ form, set, meta }) {
  const offerUndo = useUndo();
  const list = form.deployTo;
  const edit = (next) => set('deployTo', next);
  const update = (i, patch) => edit(list.map((d, n) => (n === i ? { ...d, ...patch } : d)));
  const add = () => {
    const d = { uid: uid(), name: `env-${list.length + 1}`, on: 'manual' };
    edit([...list, d]);
    focusSoon(nameInput(d.uid));
  };
  const remove = (i) => {
    const before = list;
    const gone = list[i];
    edit(list.filter((_, n) => n !== i));
    offerUndo({
      message: `Removed environment ${gone.name || i + 1}.`,
      undo: () => set('deployTo', before),
      focusRestored: () => focusSoon(nameInput(gone.uid)),
      focusAfter: () => focusSoon('[data-focus="add-environment"]'),
    });
  };
  const backToOne = () => {
    const before = list;
    edit([]);
    offerUndo({
      message: `Back to one environment: the list of ${before.length} was removed.`,
      undo: () => set('deployTo', before),
      focusRestored: () => focusSoon(nameInput(before[0].uid)),
      focusAfter: () => focusSoon('[data-focus="several-environments"]'),
    });
  };

  if (!list.length) {
    return (
      <div className="field">
        <button
          type="button"
          className="full"
          data-focus="several-environments"
          onClick={() => {
            const first = { uid: uid(), name: 'qa', on: 'branch', match: 'develop' };
            edit([first, { uid: uid(), name: form.environment || 'production', on: 'tag', match: 'v*' }]);
            focusSoon(nameInput(first.uid));
          }}
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
        <fieldset className="service" key={d.uid ?? i} data-uid={d.uid}>
          <legend>{d.name || `Environment ${i + 1}`}</legend>
          <div className="row">
            <Field label="Environment" field={`deploy:${d.name}:name`}>
              {field(d.name, (v) => update(i, { name: v }), { placeholder: 'qa' })}
            </Field>
            <SelectField label="Deploy when" value={d.on} onChange={(v) => update(i, { on: v, ...(v === 'manual' && { match: '' }) })} options={opts(meta.pipeline.deployOn, LABELS.deployOn)} />
          </div>
          {d.on !== 'manual' && (
            <Field label={d.on === 'tag' ? 'Tags' : 'Branch'} field={`deploy:${d.name}:match`} hint="A name or a prefix ending in *. Empty: the default branch, or any tag.">
              {field(d.match, (v) => update(i, { match: v }), { placeholder: d.on === 'tag' ? 'v*' : 'develop or release/*' })}
            </Field>
          )}
          {list.length > 1 && (
            <button type="button" className="remove" onClick={() => remove(i)}>
              Remove {d.name || 'environment'}
            </button>
          )}
        </fieldset>
      ))}
      <div className="service-actions">
        <button type="button" data-focus="add-environment" onClick={add}>
          + Add environment
        </button>
        <button type="button" onClick={backToOne}>
          Back to one environment
        </button>
      </div>
    </div>
  );
}
