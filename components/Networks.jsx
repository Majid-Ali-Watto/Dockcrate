'use client';

import { Check, Field, MultiField } from './Controls.jsx';

/**
 * Compose networks: declare them, then say who joins which. Nothing declared keeps compose's single default network.
 * `internal` networks have no route out; `external` ones already exist outside this compose project.
 */
export default function Networks({ form, set, show }) {
  const list = form.networks;
  const named = list.filter((n) => n.name.trim()).map((n) => n.name.trim());
  const update = (i, patch) => set('networks', list.map((n, k) => (k === i ? { ...n, ...patch } : n)));
  // Keep the joined lists to networks that still exist.
  const names = (key) => form[key].filter((n) => named.includes(n));
  return (
    <div className="services">
      <div className="label">Networks ({list.length})</div>
      <span className="hint">None declared: every service is on compose&rsquo;s one default network.</span>
      {list.map((n, i) => (
        <fieldset className="service" key={i}>
          <legend>{n.name || `Network ${i + 1}`}</legend>
          <Field label="Name">
            {(id) => <input id={id} type="text" value={n.name} placeholder="backend" spellCheck={false} autoComplete="off" onChange={(e) => update(i, { name: e.target.value })} />}
          </Field>
          <Check checked={n.internal} onChange={(v) => update(i, { internal: v, external: v ? false : n.external })}>
            Internal <span className="hint">(no route out to the internet)</span>
          </Check>
          <Check checked={n.external} onChange={(v) => update(i, { external: v, internal: v ? false : n.internal })}>
            External <span className="hint">(already exists: docker network create)</span>
          </Check>
          <button type="button" className="remove" onClick={() => set('networks', list.filter((_, k) => k !== i))}>
            Remove {n.name || 'network'}
          </button>
        </fieldset>
      ))}
      <div className="service-actions">
        <button type="button" onClick={() => set('networks', [...list, { name: '', internal: false, external: false }])}>
          + Add network
        </button>
      </div>
      {named.length > 0 && (
        <>
          {!show.multi && (
            <MultiField label="The service joins" hint="None = all of them." options={named.map((n) => ({ value: n, label: n }))} value={names('appNetworks')} allowCustom={false} onChange={(v) => set('appNetworks', v)} />
          )}
          {show.databases && (
            <MultiField label="Databases and queues join" hint="None = all of them." options={named.map((n) => ({ value: n, label: n }))} value={names('dbNetworks')} allowCustom={false} onChange={(v) => set('dbNetworks', v)} />
          )}
          {show.multi && <span className="hint">Each service picks its networks in the Services panel (none = the project's).</span>}
        </>
      )}
    </div>
  );
}
