'use client';

import { Check, ChoiceField, Field, MultiField, SelectField, opts } from './Controls.jsx';
import { RUNTIMES } from '../lib/form.js';

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * The services of the project. They come from detection until you change something; from then on the list in the form
 * is the source of truth. Each service is a folder with its own stack, Dockerfile and port.
 */
export default function Services({ form, set, meta, show, loading }) {
  const networkNames = form.networks.filter((n) => n.name.trim()).map((n) => n.name.trim());
  const { multi } = show;
  const list = form.services ?? [];
  const stackOptions = opts(meta.stacks.map((s) => s.id));
  const stackOf = (svc) => meta.stacks.find((s) => s.id === svc.stack);
  const defaultPort = (svc) => stackOf(svc)?.port;

  const edit = (next) => set('services', next);
  const update = (i, patch) => edit(list.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const rename = (i, name) => update(i, { name, ...(list[i].dir === list[i].name ? { dir: slug(name) || name } : {}) });
  const add = () => {
    const n = list.length + 1;
    edit([...list, { name: `service-${n}`, dir: `service-${n}`, stack: 'node' }]);
  };

  if (!multi) {
    return (
      <div className="field">
        <div className="or">or</div>
        <button
          type="button"
          className="split"
          onClick={() =>
            edit([
              { name: 'app', dir: 'app', stack: form.stack || 'node' },
              { name: 'service-2', dir: 'service-2', stack: 'node' },
            ])
          }
        >
          Split into several services
        </button>
      </div>
    );
  }

  return (
    <div className="services" aria-busy={loading || undefined}>
      <div className="label">Services ({list.length})</div>
      {list.map((svc, i) => (
        <fieldset className="service" key={i}>
          <legend>{svc.name || svc.dir || `Service ${i + 1}`}</legend>
          <div className="row">
            <Field label="Name">
              {(id) => <input id={id} type="text" value={svc.name ?? ''} spellCheck={false} autoComplete="off" onChange={(e) => rename(i, e.target.value)} />}
            </Field>
            <Field label="Folder">
              {(id) => <input id={id} type="text" value={svc.dir ?? ''} spellCheck={false} autoComplete="off" onChange={(e) => update(i, { dir: e.target.value })} />}
            </Field>
          </div>
          <div className="row">
            <SelectField label="Stack" value={svc.stack ?? 'node'} onChange={(v) => update(i, { stack: v, runtime: '', tool: '' })} options={stackOptions} />
            <Field label="Port">
              {(id) => (
                <input
                  id={id}
                  type="text"
                  inputMode="numeric"
                  value={svc.port ?? ''}
                  placeholder={defaultPort(svc) ? `Default (${defaultPort(svc)})` : 'Default'}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => update(i, { port: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="row">
            <ChoiceField
              key={svc.stack}
              label="Runtime"
              value={svc.runtime ?? ''}
              defaultLabel="Default"
              options={opts(RUNTIMES[svc.stack] ?? [])}
              placeholder="e.g. 22"
              onChange={(v) => update(i, { runtime: v })}
            />
            {stackOf(svc)?.tools.length > 0 && (
              <SelectField
                label="Package manager"
                value={svc.tool || stackOf(svc).tools[0]}
                onChange={(v) => update(i, { tool: v })}
                options={opts(stackOf(svc).tools)}
              />
            )}
          </div>
          <Check
            checked={Array.isArray(svc.db)}
            onChange={(on) => {
              const { db, ...rest } = svc;
              edit(list.map((s, n) => (n === i ? (on ? { ...rest, db: [] } : rest) : s)));
            }}
          >
            Own databases <span className="hint">(otherwise the project's)</span>
          </Check>
          {Array.isArray(svc.db) && (
            <MultiField label="Databases of this service" options={opts(meta.dbs)} value={svc.db} allowCustom={false} onChange={(v) => update(i, { db: v })} />
          )}
          {networkNames.length > 0 && (
            <MultiField
              label="Networks of this service"
              hint="None = the project's (default: all)."
              options={networkNames.map((n) => ({ value: n, label: n }))}
              value={(svc.networks ?? []).filter((n) => networkNames.includes(n))}
              allowCustom={false}
              onChange={(v) => update(i, { networks: v })}
            />
          )}
          {list.length > 1 && (
            <button type="button" className="remove" onClick={() => edit(list.filter((_, n) => n !== i))}>
              Remove {svc.name || 'service'}
            </button>
          )}
        </fieldset>
      ))}
      <div className="service-actions">
        <button type="button" onClick={add}>
          + Add service
        </button>
        <button type="button" onClick={() => set('services', null)}>
          Back to one service
        </button>
      </div>
    </div>
  );
}
