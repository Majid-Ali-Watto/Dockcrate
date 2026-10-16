'use client';

import { Check, Field, MultiField } from './Controls.jsx';
import { focusSoon } from './focus.js';
import { useUndo } from './Undo.jsx';
import { uid } from '../lib/form.js';

const nameInput = (key) => `[data-uid="${key}"] input`;

/**
 * Compose networks: declare them, then say who joins which. Nothing declared keeps compose's single default network.
 * `internal` networks have no route out; `external` ones already exist outside this compose project.
 */
export default function Networks({ form, set, show }) {
  const offerUndo = useUndo();
  const list = form.networks;
  const named = list.filter((n) => n.name.trim()).map((n) => n.name.trim());
  const update = (i, patch) => set('networks', list.map((n, k) => (k === i ? { ...n, ...patch } : n)));
  // Keep the joined lists to networks that still exist.
  const names = (key) => form[key].filter((n) => named.includes(n));
  const add = () => {
    const n = { uid: uid(), name: '', internal: false, external: false };
    set('networks', [...list, n]);
    focusSoon(nameInput(n.uid));
  };
  const remove = (i) => {
    const before = list;
    const gone = list[i];
    set('networks', list.filter((_, k) => k !== i));
    offerUndo({
      message: `Removed network ${gone.name || i + 1}.`,
      undo: () => set('networks', before),
      focusRestored: () => focusSoon(nameInput(gone.uid)),
      focusAfter: () => focusSoon('[data-focus="add-network"]'),
    });
  };
  return (
    <div className="services">
      <div className="label">Networks ({list.length})</div>
      <span className="hint">None declared: every service is on compose&rsquo;s one default network.</span>
      {list.map((n, i) => (
        <fieldset className="service" key={n.uid ?? i} data-uid={n.uid}>
          <legend>{n.name || `Network ${i + 1}`}</legend>
          <Field label="Name" field={`network:${n.name.trim()}`}>
            {(id, aria) => <input id={id} {...aria} type="text" value={n.name} placeholder="backend" spellCheck={false} autoComplete="off" onChange={(e) => update(i, { name: e.target.value })} />}
          </Field>
          <Check checked={n.internal} onChange={(v) => update(i, { internal: v, external: v ? false : n.external })}>
            Internal <span className="hint">(no route out to the internet)</span>
          </Check>
          <Check checked={n.external} onChange={(v) => update(i, { external: v, internal: v ? false : n.internal })}>
            External <span className="hint">(already exists: docker network create)</span>
          </Check>
          <button type="button" className="remove" onClick={() => remove(i)}>
            Remove {n.name || 'network'}
          </button>
        </fieldset>
      ))}
      <div className="service-actions">
        <button type="button" data-focus="add-network" onClick={add}>
          + Add network
        </button>
      </div>
      {named.length > 0 && (
        <>
          {!show.multi && (
            <MultiField
              label="The service joins"
              field="appNetworks"
              hint="None = all of them."
              options={named.map((n) => ({ value: n, label: n }))}
              value={names('appNetworks')}
              allowCustom={false}
              onChange={(v) => set('appNetworks', v)}
            />
          )}
          {show.databases && (
            <MultiField
              label="Databases and queues join"
              field="dbNetworks"
              hint="None = all of them."
              options={named.map((n) => ({ value: n, label: n }))}
              value={names('dbNetworks')}
              allowCustom={false}
              onChange={(v) => set('dbNetworks', v)}
            />
          )}
          {show.multi && <span className="hint">Each service picks its networks in the Services panel (none = the project&rsquo;s).</span>}
        </>
      )}
    </div>
  );
}
