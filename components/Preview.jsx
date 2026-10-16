'use client';

import dynamic from 'next/dynamic';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { copyText, download, downloadName } from '../lib/client.js';
import { groupPaths } from '../lib/groups.js';
import Accuracy from './Accuracy.jsx';
import { fieldSelector, focusSoon } from './focus.js';
import { Skeleton, SkeletonPreview } from './Skeleton.jsx';

// Only needed once the user starts editing.
const BlockEditor = dynamic(() => import('./BlockEditor.jsx'), { loading: () => <Skeleton rows={6} label="Loading the editor" /> });

const PANEL = 'file-panel';

function Code({ lines, label }) {
  return (
    <pre tabIndex={0} aria-label={label}>
      {lines.map((text, i) => (
        <span key={i} className="line">
          {text}
        </span>
      ))}
    </pre>
  );
}

/**
 * The preview: file tabs, then one pane that shows the active file (its text, or its blocks in the editor), a file you
 * switched off, or a file on its way from the server. The pane and its head stay the same elements across those states, so
 * the focus stays where it was when one turns into another.
 */
function Preview({ result, error, errorKey, loading, edits = {}, onEdit }) {
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState(false);
  const [newFile, setNewFile] = useState(null);
  const [pending, setPending] = useState(null); // { path, since }: a file turned on or added, until the next result
  const [copyState, setCopyState] = useState('');
  const [zipping, setZipping] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [errorTarget, setErrorTarget] = useState(false);
  const heading = useRef(null);
  const turnOn = useRef(null);
  const newFileButton = useRef(null);
  const want = useRef(null); // the ref to focus once it is rendered

  const files = useMemo(() => result?.files ?? [], [result]);
  const has = (path) => files.some((f) => f.path === path);
  // Files you switched off still need a way back, or there would be no way to switch them on again.
  const offPaths = Object.entries(edits)
    .filter(([path, e]) => e.disabled && !has(path))
    .map(([path]) => path);
  const activeOff = offPaths.includes(active);
  const activePending = !activeOff && pending?.path === active && !has(active);
  const file = activeOff || activePending ? null : (files.find((f) => f.path === active) ?? files[0]);
  const allPaths = [...files.map((f) => f.path), ...offPaths];
  const groups = result?.multi ? groupPaths(allPaths, result.services) : [{ name: '', paths: allPaths }];
  const lines = useMemo(() => file?.content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'), [file]);
  const tabId = (path) => `tab-${files.findIndex((f) => f.path === path)}`;
  const mode = activeOff ? 'off' : activePending ? 'pending' : file ? (editing && onEdit ? 'edit' : 'file') : '';
  const panePath = activeOff || activePending ? active : file?.path;

  const say = (text) => setAnnouncement(text);
  const focusLater = (ref) => {
    want.current = ref;
  };

  // A file that is waiting for the server stops waiting once a new result arrives (with it, or without it).
  useEffect(() => {
    if (pending && result !== pending.since) setPending(null);
  }, [result, pending]);

  // Focus what an action asked for, once it is on the page.
  useEffect(() => {
    if (want.current?.current) {
      want.current.current.focus();
      want.current = null;
    }
  });

  // The file you were editing was just switched off: its editor is gone, so the way back on gets the focus.
  const wasOff = useRef(false);
  useEffect(() => {
    if (activeOff && !wasOff.current && (!document.activeElement || document.activeElement === document.body)) turnOn.current?.focus();
    wasOff.current = activeOff;
  }, [activeOff]);

  // Tell screen readers how many files there are when that changes, not on every regeneration.
  const count = result ? files.length : null;
  const lastCount = useRef(null);
  useEffect(() => {
    if (count == null || count === lastCount.current) return;
    lastCount.current = count;
    say(count ? `${count} file${count === 1 ? '' : 's'} generated.` : 'Nothing to generate for this selection.');
  }, [count]);

  // The error message is a button to its field only when that field is on the page.
  useEffect(() => {
    setErrorTarget(Boolean(errorKey) && Boolean(document.querySelector(fieldSelector(errorKey))));
  }, [errorKey, error]);

  const copy = async () => {
    const ok = await copyText(file.content);
    setCopyState(ok ? 'copied' : 'failed');
    say(ok ? `Copied ${file.path}.` : 'Copy failed: select the text in the preview and copy it yourself.');
    setTimeout(() => setCopyState(''), 1500);
  };

  const downloadAll = async () => {
    if (zipping) return;
    setZipping(true);
    try {
      const { zip } = await import('../lib/zip.js');
      download('dockcrate-files.zip', zip(files));
      say('Downloading dockcrate-files.zip.');
    } catch {
      say('The .zip download failed. Try again, or download the files one by one.');
    } finally {
      setZipping(false);
    }
  };

  const select = (path) => {
    setActive(path);
    setCopyState('');
  };

  const switchOn = (path, { focus } = {}) => {
    onEdit(path, (cur) => ({ ...cur, disabled: false }));
    setPending({ path, since: result });
    setActive(path);
    if (focus) focusLater(heading);
  };

  // Arrow keys move between the tabs of one list (and select them); Home and End jump to its ends.
  const onTabKey = (e, paths) => {
    const at = paths.indexOf(e.target.dataset.path);
    const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: paths.length - 1 }[e.key];
    if (next === undefined || at < 0) return;
    e.preventDefault();
    const path = paths[(next + paths.length) % paths.length];
    select(path);
    document.getElementById(tabId(path))?.focus();
  };

  const addFile = (e) => {
    e.preventDefault();
    const path = newFile.trim();
    if (!path) return;
    onEdit(path, (cur) => ({ ...cur, add: [...(cur.add ?? []), { id: `custom-${Date.now().toString(36)}`, after: '', title: 'File content', text: '' }] }));
    setPending({ path, since: result });
    setActive(path);
    setEditing(true);
    setNewFile(null);
    focusLater(heading);
  };
  const cancelNewFile = () => {
    setNewFile(null);
    focusLater(newFileButton);
  };

  const summary = !result
    ? loading
      ? 'Loading…'
      : ''
    : !files.length && !offPaths.length
      ? 'Nothing to generate for this selection (for example, the SSH target has no deployment files).'
      : result.multi
        ? `${result.services.length} services (${result.services.map((s) => `${s.name}: ${s.stack}`).join(', ')})`
        : `${result.stack} project`;

  const title = { off: 'Switched off', pending: 'Generating', edit: 'Blocks', file: 'Generated' }[mode];

  return (
    <>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <div className="main-head">
        <a className="jump" href="#options">
          Back to options ↑
        </a>
        {error && (
          <div className="error-banner" role="alert">
            <p>
              {errorTarget ? (
                <button type="button" className="linkish" onClick={() => focusSoon(fieldSelector(errorKey))}>
                  {error}
                </button>
              ) : (
                error
              )}
            </p>
            {result && <p className="muted">The preview below shows the files from the last options that worked.</p>}
          </div>
        )}
        <p className="status">
          {summary} {loading && result && <span className="muted">Updating…</span>}
        </p>
        {(files.length > 0 || offPaths.length > 0) && (
          <div className="tabs">
            <div className={result.multi ? 'tabgroups' : 'flat'}>
              {groups.map((g) => {
                const tabs = g.paths.filter(has);
                const off = g.paths.filter((path) => !has(path));
                const roving = tabs.includes(file?.path) ? file.path : tabs[0];
                return (
                  <div key={g.name} className={result.multi ? 'tabgroup' : 'flat'}>
                    {result.multi && <span className="tabgroup-name">{g.name}</span>}
                    {tabs.length > 0 && (
                      <div className="tablist" role="tablist" aria-label={result.multi ? `${g.name} files` : 'Generated files'} onKeyDown={(e) => onTabKey(e, tabs)}>
                        {tabs.map((path) => (
                          <button
                            key={path}
                            id={tabId(path)}
                            data-path={path}
                            type="button"
                            role="tab"
                            aria-selected={path === file?.path}
                            aria-controls={PANEL}
                            tabIndex={path === roving ? 0 : -1}
                            onClick={() => select(path)}
                          >
                            {path}
                            {edits[path] && <span className="tag edited">edited</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {off.map((path) => (
                      <button key={path} type="button" className="off" onClick={() => switchOn(path, { focus: true })} aria-label={`${path} is switched off: turn it on`}>
                        {path} <span className="tag same">off: turn on</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            {newFile === null ? (
              <button type="button" ref={newFileButton} onClick={() => setNewFile('')}>
                + New file
              </button>
            ) : (
              <form className="newfile" onSubmit={addFile} onKeyDown={(e) => e.key === 'Escape' && cancelNewFile()}>
                <input type="text" autoFocus value={newFile} placeholder="scripts/deploy.sh" aria-label="New file path" spellCheck={false} autoComplete="off" onChange={(e) => setNewFile(e.target.value)} />
                <button type="submit">Add</button>
                <button type="button" onClick={cancelNewFile}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {mode ? (
        <div className={`panes one${error ? ' stale' : ''}`}>
          <section
            className="pane"
            id={PANEL}
            role="tabpanel"
            {...(mode === 'edit' || mode === 'file' ? { 'aria-labelledby': tabId(file.path) } : { 'aria-label': `${panePath}: ${title}` })}
          >
            <div className="pane-head">
              <h2 className="pane-title" ref={heading} tabIndex={-1}>
                {title}
              </h2>
              <code>{panePath}</code>
              {error && <span className="tag differs">last valid result</span>}
              {(mode === 'file' || mode === 'edit') && (
                <div className="pane-actions">
                  {onEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(mode === 'file');
                        say(mode === 'file' ? `Editing the blocks of ${file.path}.` : `Showing ${file.path}.`);
                      }}
                    >
                      {mode === 'file' ? 'Edit blocks' : 'Show file'}
                    </button>
                  )}
                  {mode === 'file' && (
                    <button type="button" onClick={() => download(downloadName(file.path), file.content)}>
                      Download
                    </button>
                  )}
                  {mode === 'file' && (
                    <button type="button" onClick={copy}>
                      {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
                    </button>
                  )}
                </div>
              )}
            </div>
            {mode === 'file' && <Code lines={lines} label={`${file.path}, generated`} />}
            {mode === 'edit' && <BlockEditor key={file.path} file={file} edit={edits[file.path]} change={(updater) => onEdit(file.path, updater)} />}
            {mode === 'off' && (
              <div className="off-state">
                <p>This file is switched off: it is left out of the preview, the downloads and the .zip.</p>
                <button type="button" ref={turnOn} onClick={() => switchOn(active, { focus: true })}>
                  Turn it back on
                </button>
              </div>
            )}
            {mode === 'pending' && <Skeleton rows={4} label={`Generating ${panePath}`} />}
          </section>
        </div>
      ) : (
        <>
          {!result && !error && <SkeletonPreview />}
          {(result || error) && <div className="panes empty" />}
        </>
      )}

      {files.length > 0 && (
        <div className="main-foot">
          {files.length > 1 && (
            <div className="download-strip">
              <p>
                <strong>{files.length} files ready</strong> <span className="muted">The .zip keeps their folders.</span>
              </p>
              <button type="button" className="primary download-all" aria-disabled={zipping || undefined} onClick={downloadAll}>
                <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
                  <path d="M8 1.5v8.5M4.5 6.5 8 10l3.5-3.5M2.5 11.5v2h11v-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {zipping ? 'Preparing the .zip…' : 'Download all (.zip)'}
              </button>
            </div>
          )}
          <Accuracy />
          {result.notes.length > 0 && (
            <details className="notes" open>
              <summary>Notes ({result.notes.length})</summary>
              <ul>
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </>
  );
}

// Typing in the sidebar re-renders the app; the preview only needs to when its own props change.
export default memo(Preview);
