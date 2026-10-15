'use client';

import { useId, useState } from 'react';

export function Field({ label, hint, children }) {
  const id = useId();
  return (
    <div className="field">
      {label && (
        <label htmlFor={id}>
          {label}
        </label>
      )}
      {children(id)}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function TextField({ label, hint, value, onChange, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="text"
          value={value}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
      )}
    </Field>
  );
}

export function TextArea({ label, hint, value, onChange, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <textarea id={id} rows={3} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} {...rest} />
      )}
    </Field>
  );
}

/** options: [{ value, label }] */
export function SelectField({ label, hint, value, onChange, options }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

const CUSTOM = '__custom__';

/**
 * A dropdown of presets plus "Custom…", which reveals a text box. The value is a plain string; '' means the default,
 * labelled by `defaultLabel` (leave it out when the field has no empty state). options: [{ value, label }]
 */
export function ChoiceField({ label, hint, value, onChange, options, defaultLabel, placeholder, inputMode }) {
  const [custom, setCustom] = useState(false);
  const isCustom = custom || (value !== '' && !options.some((o) => o.value === value));
  const pick = (v) => {
    if (v === CUSTOM) {
      setCustom(true);
      return;
    }
    setCustom(false);
    onChange(v);
  };
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <>
          <select id={id} value={isCustom ? CUSTOM : value} onChange={(e) => pick(e.target.value)}>
            {defaultLabel != null && <option value="">{defaultLabel}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
          {isCustom && (
            <input
              className="custom"
              type="text"
              aria-label={`${label} (custom value)`}
              value={value}
              placeholder={placeholder}
              inputMode={inputMode}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </>
      )}
    </Field>
  );
}

/**
 * A dropdown of checkboxes bound to an array of values, with a box to add values of your own (`allowCustom`, on by
 * default; leave it off where only the listed values are valid). Custom values stay in the list so they can be unticked.
 * `separator` splits what is typed into several values; null keeps it as one (a cron line has spaces and commas).
 */
export function MultiField({ label, hint, options, value, onChange, emptyLabel = 'None', allowCustom = true, separator = /[\s,]+/, placeholder }) {
  const id = useId();
  const summaryId = useId();
  const [draft, setDraft] = useState('');
  const known = new Set(options.map((o) => o.value));
  const shown = [...options, ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))];
  const toggle = (v, on) => onChange(on ? [...value, v] : value.filter((x) => x !== v));
  const add = () => {
    const items = (separator ? draft.split(separator) : [draft]).map((s) => s.trim()).filter((s) => s && !value.includes(s));
    if (items.length) onChange([...value, ...items]);
    setDraft('');
  };
  const summary = value.length ? value.join(', ') : emptyLabel;
  return (
    <div className="field">
      <div className="label" id={id}>
        {label}
      </div>
      <details className="multi">
        <summary id={summaryId} aria-labelledby={`${id} ${summaryId}`} title={summary}>
          {summary}
        </summary>
        <div className="multi-panel">
          {shown.map((o) => (
            <Check key={o.value} checked={value.includes(o.value)} onChange={(on) => toggle(o.value, on)}>
              {o.label}
            </Check>
          ))}
          {allowCustom && (
            <div className="multi-add">
              <input
                type="text"
                aria-label={`Add a custom value to ${label}`}
                value={draft}
                placeholder={placeholder ?? 'Add your own…'}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  add();
                }}
              />
              <button type="button" onClick={add} disabled={!draft.trim()}>
                Add
              </button>
            </div>
          )}
        </div>
      </details>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Check({ checked, onChange, children, name }) {
  return (
    <label className="check">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** A group of checkboxes bound to an array of selected values. */
export function CheckGroup({ legend, hint, options, value, onChange }) {
  const toggle = (v, on) => onChange(on ? [...value, v] : value.filter((x) => x !== v));
  return (
    <fieldset>
      <legend>
        {legend} {hint && <span className="hint">{hint}</span>}
      </legend>
      {options.map((o) => (
        <Check key={o.value} checked={value.includes(o.value)} onChange={(on) => toggle(o.value, on)}>
          {o.label}
        </Check>
      ))}
    </fieldset>
  );
}

export function Section({ title, children, defaultOpen = true }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

export const opts = (values, labels = {}) => values.map((v) => ({ value: v, label: labels[v] ?? v }));
