'use client';

import { Check, ChoiceField, Field, MultiField, SelectField, opts } from './Controls.jsx';
import { focusSoon } from './focus.js';
import { useUndo } from './Undo.jsx';
import { RUNTIMES, uid } from '../lib/form.js';

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const nameInput = (key) => `[data-uid="${key}"] input`;

/**
 * The services of the project: each is a folder with its own stack, Dockerfile and port. Every item carries a client-only
 * `uid` (its React key, never sent to the API) so focus and state stay with the service when another one is removed.
 */
export default function Services({ form, set, meta, show }) {
  const offerUndo = useUndo();
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
    const svc = { uid: uid(), name: `service-${n}`, dir: `service-${n}`, stack: 'node' };
    edit([...list, svc]);
    focusSoon(nameInput(svc.uid));
  };
  const remove = (i) => {
    const before = list;
    const gone = list[i];
    edit(list.filter((_, n) => n !== i));
    offerUndo({
      message: `Removed service ${gone.name || gone.dir || i + 1}.`,
      undo: () => set('services', before),
      focusRestored: () => focusSoon(nameInput(gone.uid)),
      focusAfter: () => focusSoon('[data-focus="add-service"]'),
    });
  };
  const backToOne = () => {
    const before = list;
    set('services', null);
    offerUndo({
      message: `Back to one service: the list of ${before.length} was removed.`,
      undo: () => set('services', before),
      focusRestored: () => focusSoon(nameInput(before[0].uid)),
      focusAfter: () => focusSoon('[data-focus="split"]'),
    });
  };
  const split = () => {
    const first = { uid: uid(), name: 'app', dir: 'app', stack: form.stack || 'node' };
    edit([first, { uid: uid(), name: 'service-2', dir: 'service-2', stack: 'node' }]);
    focusSoon(nameInput(first.uid));
  };

  if (!multi) {
    return (
      <div className="field">
        <div className="or">or</div>
        <button type="button" className="split" data-focus="split" onClick={split}>
          Split into several services
        </button>
      </div>
    );
  }

  return (
    <div className="services">
      <div className="label">Services ({list.length})</div>
      {list.map((svc, i) => {
        const at = (key) => `service:${svc.name}:${key}`;
        return (
          <fieldset className="service" key={svc.uid ?? i} data-uid={svc.uid}>
            <legend>{svc.name || svc.dir || `Service ${i + 1}`}</legend>
            <div className="row">
              <Field label="Name" field={at('name')}>
                {(id, aria) => <input id={id} {...aria} type="text" value={svc.name ?? ''} spellCheck={false} autoComplete="off" onChange={(e) => rename(i, e.target.value)} />}
              </Field>
              <Field label="Folder" field={at('dir')}>
                {(id, aria) => <input id={id} {...aria} type="text" value={svc.dir ?? ''} spellCheck={false} autoComplete="off" onChange={(e) => update(i, { dir: e.target.value })} />}
              </Field>
            </div>
            <div className="row">
              <SelectField label="Stack" field={at('stack')} value={svc.stack ?? 'node'} onChange={(v) => update(i, { stack: v, runtime: '', tool: '' })} options={stackOptions} />
              <Field label="Port" field={at('port')}>
                {(id, aria) => (
                  <input
                    id={id}
                    {...aria}
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
                field={at('runtime')}
                value={svc.runtime ?? ''}
                defaultLabel="Default"
                options={opts(RUNTIMES[svc.stack] ?? [])}
                placeholder="e.g. 22"
                onChange={(v) => update(i, { runtime: v })}
              />
              {stackOf(svc)?.tools.length > 0 && (
                <SelectField
                  label="Package manager"
                  field={at('tool')}
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
              Own databases <span className="hint">(otherwise the project&rsquo;s)</span>
            </Check>
            {Array.isArray(svc.db) && (
              <MultiField label="Databases of this service" field={at('db')} options={opts(meta.dbs)} value={svc.db} allowCustom={false} onChange={(v) => update(i, { db: v })} />
            )}
            {networkNames.length > 0 && (
              <MultiField
                label="Networks of this service"
                field={at('networks')}
                hint="None = the project's (default: all)."
                options={networkNames.map((n) => ({ value: n, label: n }))}
                value={(svc.networks ?? []).filter((n) => networkNames.includes(n))}
                allowCustom={false}
                onChange={(v) => update(i, { networks: v })}
              />
            )}
            {list.length > 1 && (
              <button type="button" className="remove" onClick={() => remove(i)}>
                Remove {svc.name || 'service'}
              </button>
            )}
          </fieldset>
        );
      })}
      <div className="service-actions">
        <button type="button" data-focus="add-service" onClick={add}>
          + Add service
        </button>
        <button type="button" onClick={backToOne}>
          Back to one service
        </button>
      </div>
    </div>
  );
}
