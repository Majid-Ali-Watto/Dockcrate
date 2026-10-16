'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FieldErrorContext } from './Controls.jsx';
import Preview from './Preview.jsx';
import Sidebar from './Sidebar.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { UndoProvider } from './Undo.jsx';
import { post } from '../lib/client.js';
import { STACK_ORDER, clearForm, describeError, initialForm, loadForm, saveForm, toBody, visibility } from '../lib/form.js';

export default function App({ meta: serverMeta, guides }) {
  const meta = useMemo(
    () => ({ ...serverMeta, stacks: [...serverMeta.stacks].sort((a, b) => STACK_ORDER.indexOf(a.id) - STACK_ORDER.indexOf(b.id)) }),
    [serverMeta],
  );
  const [form, setForm] = useState(() => initialForm(meta));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Nothing is saved until the saved form (if any) has been read, or the defaults would overwrite it.
  const restored = useRef(false);

  const show = useMemo(() => visibility(form, meta, result), [form, meta, result]);
  const body = useMemo(() => JSON.stringify(toBody(form, show)), [form, show]);
  const problem = useMemo(() => describeError(error, form), [error, form]);
  // A new object only when the error changes, so the controls do not all re-render on every keystroke.
  const fieldError = useMemo(() => ({ key: problem.key, text: problem.text }), [problem.key, problem.text]);

  // The form you left, read after the first render so the server's HTML and the first client render stay identical.
  useEffect(() => {
    const saved = loadForm(meta);
    if (saved) setForm(saved);
    restored.current = true;
  }, [meta]);

  // Keep the form (options and block edits) in this browser, a moment after the last change, and at once when the page is
  // left (a Guides link followed right after typing would otherwise lose the last keystrokes).
  const latest = useRef(form);
  latest.current = form;
  useEffect(() => {
    if (!restored.current) return undefined;
    const timer = setTimeout(() => saveForm(form), 400);
    return () => clearTimeout(timer);
  }, [form]);
  useEffect(() => {
    const flush = () => restored.current && saveForm(latest.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const set = useCallback((key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // What a step list means depends on the stack, so go back to the defaults when it changes.
      if (['stack', 'tool', 'services'].includes(key)) next.ciSteps = null;
      if (key === 'stack') next.tool = '';
      return next;
    });
  }, []);

  // Replace one file's edits; an updater that returns null (or leaves nothing) removes the entry.
  const setEdit = useCallback((path, updater) => {
    setForm((prev) => {
      const next = updater(prev.edits[path] ?? {});
      const edits = { ...prev.edits };
      const empty = !next || (!next.disabled && !Object.keys(next.blocks ?? {}).length && !(next.add ?? []).length);
      if (empty) delete edits[path];
      else edits[path] = next;
      return { ...prev, edits };
    });
  }, []);

  const startOver = () => {
    if (!window.confirm('Start over? Every option and block edit goes back to the defaults, and the copy kept in this browser is deleted.')) return;
    clearForm();
    setForm(initialForm(meta));
  };

  // Regenerate the preview shortly after the form settles.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await post('/api/generate', JSON.parse(body), controller.signal);
        setResult(data);
        setError('');
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `body` captures every input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  return (
    <UndoProvider>
      <div className="app">
        <a className="skip" href="#preview">
          Skip to preview
        </a>
        <section className="sidebar" id="options" aria-label="Options" tabIndex={-1}>
          <header className="brand">
            <div className="brand-top">
              <h1 className="logo">
                <a href="/" aria-label="Dockcrate home">
                  <img src="/logo.svg" alt="" width="28" height="28" />
                  Dockcrate
                </a>
              </h1>
              <div className="brand-tools">
                <button type="button" className="theme" onClick={startOver} title="Reset every option and edit to the defaults">
                  Start over
                </button>
                <ThemeToggle />
              </div>
            </div>
            <p>
              {meta.hosted
                ? 'Dockerfile, docker-compose and CI/CD pipeline generator for a new project. Pick a stack, preview the files, then copy or download them. Nothing is stored on the server; your choices are kept in this browser.'
                : 'Dockerfile, compose and CI/CD for a new project. Pick a stack, preview the files, then copy or download them. Runs locally; nothing leaves your machine.'}
            </p>
            <a className="jump" href="#preview">
              Jump to preview ↓
            </a>
          </header>
          <FieldErrorContext.Provider value={fieldError}>
            <Sidebar form={form} set={set} meta={meta} show={show} result={result} />
          </FieldErrorContext.Provider>
        </section>
        <main className="main" id="preview" tabIndex={-1}>
          <Preview
            result={result}
            error={problem.text}
            errorKey={problem.key}
            loading={loading}
            edits={form.edits}
            onEdit={setEdit}
          />
        </main>
        {guides}
      </div>
    </UndoProvider>
  );
}
