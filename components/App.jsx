'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Preview from './Preview.jsx';
import Sidebar from './Sidebar.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import { post } from '../lib/client.js';
import { STACK_ORDER, initialForm, toBody, visibility } from '../lib/form.js';

// Loaded the first time the dialog opens.
const FolderPicker = dynamic(() => import('./FolderPicker.jsx'));

export default function App({ meta: serverMeta }) {
  const meta = useMemo(
    () => ({ ...serverMeta, stacks: [...serverMeta.stacks].sort((a, b) => STACK_ORDER.indexOf(a.id) - STACK_ORDER.indexOf(b.id)) }),
    [serverMeta],
  );
  const [form, setForm] = useState(() => initialForm(meta));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [written, setWritten] = useState(null);
  const [writeError, setWriteError] = useState('');
  const [writing, setWriting] = useState(false);
  const [picker, setPicker] = useState(false);

  const show = useMemo(() => visibility(form, meta, result), [form, meta, result]);
  const body = useMemo(() => JSON.stringify(toBody(form, show)), [form, show]);
  const dir = form.dir;

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

  // Regenerate the preview shortly after the form settles.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await post('/api/generate', JSON.parse(body), controller.signal);
        setResult(data);
        setError('');
        setWritten(null);
        setWriteError('');
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

  const write = async (force) => {
    setWriting(true);
    setWriteError('');
    try {
      const request = JSON.parse(body);
      const data = await post('/api/generate', { ...request, write: true, force });
      setWritten(data.written);
      setResult(await post('/api/generate', request)); // show what is on disk now
    } catch (err) {
      setWriteError(err.message);
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <div className="brand-top">
            <h1 className="logo">
              <img src="/logo.svg" alt="" width="28" height="28" />
              Dockcrate
            </h1>
            <ThemeToggle />
          </div>
          <p>
            {meta.hosted
              ? 'Dockerfile, compose and CI/CD for a new project. Pick a stack, preview the files, then copy or download them. Nothing you enter is stored.'
              : 'Dockerfile, compose and CI/CD for a new project. Pick a stack, preview the files, then add them to a project folder or download them. Runs locally; nothing leaves your machine.'}
          </p>
        </header>
        <Sidebar form={form} set={set} meta={meta} show={show} result={result} loading={loading} onBrowse={() => setPicker(true)} />
      </aside>
      <main className="main">
        <Preview
          result={result}
          error={error}
          loading={loading}
          hosted={meta.hosted}
          canWrite={Boolean(dir.trim())}
          onWrite={write}
          writing={writing}
          written={written}
          writeError={writeError}
          edits={form.edits}
          onEdit={setEdit}
        />
      </main>
      {picker && (
        <FolderPicker
          open={picker}
          startDir={dir || meta.cwd}
          home={meta.home}
          onClose={() => setPicker(false)}
          onChoose={(chosen) => {
            set('dir', chosen);
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}
