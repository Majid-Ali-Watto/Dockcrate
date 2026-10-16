'use client';

import { createContext, useContext, useId, useState } from 'react';

/**
 * The generator's current error, as `describeError` (lib/form.js) placed it: `{ key, text }`. A control whose `field` prop
 * equals `key` shows the message under itself and marks its input invalid.
 */
export const FieldErrorContext = createContext({ key: '', text: '' });

/**
 * The accessibility wiring of one control: ids for its hint and error, the `aria-*` props for the input, and the elements to
 * render under it. `data-field` lets the error banner find and focus the control.
 */
export function useDescribed(field, hint, { markInvalid = true } = {}) {
  const hintId = useId();
  const errorId = useId();
  const error = useContext(FieldErrorContext);
  const invalid = Boolean(field) && error.key === field;
  const describedBy = [hint && hintId, invalid && errorId].filter(Boolean).join(' ') || undefined;
  return {
    invalid,
    aria: { 'aria-describedby': describedBy, ...(invalid && markInvalid && { 'aria-invalid': true }), ...(field && { 'data-field': field }) },
    hint: hint ? (
      <span className="hint" id={hintId}>
        {hint}
      </span>
    ) : null,
    error: invalid ? (
      <span className="field-error" id={errorId}>
        {error.text}
      </span>
    ) : null,
  };
}

/** `children(id, aria)`: render the control with `id={id} {...aria}` so its label, hint and error belong to it. */
export function Field({ label, hint, field, children }) {
  const id = useId();
  const d = useDescribed(field, hint);
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      {children(id, d.aria)}
      {d.hint}
      {d.error}
    </div>
  );
}

export function TextField({ label, hint, field, value, onChange, ...rest }) {
  return (
    <Field label={label} hint={hint} field={field}>
      {(id, aria) => (
        <input
          id={id}
          {...aria}
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

export function TextArea({ label, hint, field, value, onChange, ...rest }) {
  return (
    <Field label={label} hint={hint} field={field}>
      {(id, aria) => (
        <textarea id={id} {...aria} rows={3} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} {...rest} />
      )}
    </Field>
  );
}

/** options: [{ value, label }] */
export function SelectField({ label, hint, field, value, onChange, options }) {
  return (
    <Field label={label} hint={hint} field={field}>
      {(id, aria) => (
        <select id={id} {...aria} value={value} onChange={(e) => onChange(e.target.value)}>
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

/** The text box of "Custom…": it carries the field's error, since the custom value is what the generator checks. */
function CustomInput({ field, label, value, placeholder, inputMode, onChange }) {
  const d = useDescribed(field);
  return (
    <>
      <input
        className="custom"
        type="text"
        aria-label={`${label} (custom value)`}
        {...d.aria}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        spellCheck={false}
        autoComplete="off"
        autoFocus
        onChange={(e) => onChange(e.target.value)}
      />
      {d.error}
    </>
  );
}

/**
 * A dropdown of presets plus "Custom…", which reveals a text box. The value is a plain string; '' means the default,
 * labelled by `defaultLabel` (leave it out when the field has no empty state). options: [{ value, label }]
 */
export function ChoiceField({ label, hint, field, value, onChange, options, defaultLabel, placeholder, inputMode }) {
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
    <Field label={label} hint={hint} field={isCustom ? undefined : field}>
      {(id, aria) => (
        <>
          <select id={id} {...aria} value={isCustom ? CUSTOM : value} onChange={(e) => pick(e.target.value)}>
            {defaultLabel != null && <option value="">{defaultLabel}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
          {isCustom && (
            <CustomInput
              field={field}
              label={label}
              value={value}
              placeholder={placeholder}
              inputMode={inputMode}
              onChange={onChange}
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
export function MultiField({ label, hint, field, options, value, onChange, emptyLabel = 'None', allowCustom = true, separator = /[\s,]+/, placeholder }) {
  const id = useId();
  const summaryId = useId();
  const d = useDescribed(field, hint);
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
        <summary id={summaryId} aria-labelledby={`${id} ${summaryId}`} {...d.aria} title={summary}>
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
      {d.hint}
      {d.error}
    </div>
  );
}

export function Check({ checked, onChange, children, name, field }) {
  const d = useDescribed(field);
  return (
    <>
      <label className="check">
        <input type="checkbox" name={name} checked={checked} {...d.aria} onChange={(e) => onChange(e.target.checked)} />
        <span>{children}</span>
      </label>
      {d.error}
    </>
  );
}

/** A group of checkboxes bound to an array of selected values. The first box carries the error, so focus has a target. */
export function CheckGroup({ legend, hint, field, options, value, onChange }) {
  const toggle = (v, on) => onChange(on ? [...value, v] : value.filter((x) => x !== v));
  const d = useDescribed(field, hint, { markInvalid: false });
  const { 'data-field': target, ...aria } = d.aria;
  return (
    <fieldset {...aria}>
      <legend>{legend}</legend>
      {d.hint && <p className="hint legend-hint">{d.hint}</p>}
      {options.map((o, i) => (
        <label className="check" key={o.value}>
          <input
            type="checkbox"
            checked={value.includes(o.value)}
            {...(i === 0 && target && { 'data-field': target, ...(d.invalid && { 'aria-invalid': true }) })}
            onChange={(e) => toggle(o.value, e.target.checked)} />
          <span>{o.label}</span>
        </label>
      ))}
      {d.error}
    </fieldset>
  );
}

/** A collapsible group of the sidebar; its title is a heading so the options can be browsed by heading. */
export function Section({ title, children, defaultOpen = true }) {
  return (
    <details className="section" open={defaultOpen}>
      <summary>
        <h2 className="section-title">{title}</h2>
      </summary>
      {children}
    </details>
  );
}

export const opts = (values, labels = {}) => values.map((v) => ({ value: v, label: labels[v] ?? v }));
