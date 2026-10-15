'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { download } from '../lib/client.js';
import { changedLines, fileState, splitLines } from '../lib/diff.js';
import { groupPaths } from '../lib/groups.js';
import Accuracy from './Accuracy.jsx';
import { Skeleton, SkeletonPreview } from './Skeleton.jsx';

// Only needed once the user starts editing.
const BlockEditor = dynamic(() => import('./BlockEditor.jsx'), { loading: () => <Skeleton rows={6} label="Loading the editor" /> });

const TAG_LABELS = { new: 'new', same: 'identical', differs: 'differs' };

function Tag({ state }) {
  return <span className={`tag ${state}`}>{TAG_LABELS[state]}</span>;
}

function Code({ lines, changed, label }) {
  return (
    <pre tabIndex={0} aria-label={label}>
      {lines.map((text, i) => (
        <span key={i} className={changed.has(i) ? 'line changed' : 'line'}>
          {text}
        </span>
      ))}
    </pre>
  );
}

export default function Preview({ result, error, loading, hosted = false, canWrite, onWrite, writing, written, writeError, edits = {}, onEdit }) {
  const [active, setActive] = useState('');
  const [editing, setEditing] = useState(false);
  const [newFile, setNewFile] = useState(null);
  const [force, setForce] = useState(false);
  const [copied, setCopied] = useState(false);

  const files = result?.files ?? [];
  // Files you switched off still need a tab, or there would be no way to switch them back on.
  const disabled = Object.entries(edits).filter(([path, e]) => e.disabled && !files.some((f) => f.path === path));
  const file = files.find((f) => f.path === active) ?? files[0];
  const allPaths = [...files.map((f) => f.path), ...disabled.map(([path]) => path)];
  const groups = result?.multi ? groupPaths(allPaths, result.services) : [{ name: '', paths: allPaths }];
  const counts = useMemo(() => {
    const c = { new: 0, same: 0, differs: 0 };
    for (const f of files) c[fileState(f)]++;
    return c;
  }, [files]);

  const view = useMemo(() => {
    if (!file) return null;
    const generated = splitLines(file.content);
    if (file.existing == null) return { generated, existing: null, gone: new Set(), added: new Set() };
    const existing = splitLines(file.existing);
    return { generated, existing, ...changedLines(existing, generated) };
  }, [file]);

  const copy = async () => {
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const status = error
    ? { text: error, className: 'error' }
    : !result
      ? { text: loading ? 'Loading…' : '', className: '' }
      : !files.length
        ? { text: 'Nothing to generate for this selection (for example, the SSH target has no deployment files).', className: '' }
        : {
            text: result.multi
              ? `${result.services.length} services (${result.services.map((s) => `${s.name}: ${s.stack}`).join(', ')})`
              : `${result.stack} project`,
            className: '',
          };

  return (
    <>
      <div className="main-head">
        <p className={`status ${status.className}`} role="status" aria-live="polite">
          {status.text} {loading && result && <span className="muted">Updating…</span>}
        </p>
        {!error && files.length > 0 && (
          <div className="tabs">
            <div className={result.multi ? 'tabgroups' : 'flat'}>
              {groups.map((g) => (
                <div key={g.name} className={result.multi ? 'tabgroup' : 'flat'}>
                  {result.multi && <span className="tabgroup-name">{g.name}</span>}
                  <div className="tablist" role="tablist" aria-label={result.multi ? `${g.name} files` : 'Generated files'}>
                    {g.paths.map((path) => {
                      const f = files.find((x) => x.path === path);
                      return f ? (
                        <button key={path} type="button" role="tab" aria-selected={f === file} onClick={() => setActive(path)}>
                          {path}
                          {fileState(f) !== 'new' && <Tag state={fileState(f)} />}
                          {edits[path] && <span className="tag edited">edited</span>}
                        </button>
                      ) : (
                        <button key={path} type="button" role="tab" aria-selected={false} className="off" onClick={() => onEdit(path, (cur) => ({ ...cur, disabled: false }))}>
                          {path} <span className="tag same">off: turn on</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {newFile === null ? (
              <button type="button" onClick={() => setNewFile('')}>
                + New file
              </button>
            ) : (
              <form
                className="newfile"
                onSubmit={(e) => {
                  e.preventDefault();
                  const path = newFile.trim();
                  if (path) {
                    onEdit(path, (cur) => ({ ...cur, add: [...(cur.add ?? []), { id: `custom-${Date.now().toString(36)}`, after: '', title: 'File content', text: '' }] }));
                    setActive(path);
                    setEditing(true);
                  }
                  setNewFile(null);
                }}
              >
                <input type="text" autoFocus value={newFile} placeholder="scripts/deploy.sh" aria-label="New file path" onChange={(e) => setNewFile(e.target.value)} />
                <button type="submit">Add</button>
              </form>
            )}
          </div>
        )}
      </div>

      {!error && file && editing && onEdit && (
        <div className="panes one">
          <section className="pane">
            <div className="pane-head">
              <strong>Blocks</strong>
              <code>{file.path}</code>
              <button type="button" className="push" onClick={() => setEditing(false)}>
                Show file
              </button>
            </div>
            <BlockEditor file={file} edit={edits[file.path]} change={(updater) => onEdit(file.path, updater)} />
          </section>
        </div>
      )}
      {!error && file && view && !editing && (
        <div className={`panes ${view.existing ? 'two' : 'one'}`}>
          {view.existing && (
            <section className="pane">
              <div className="pane-head">
                <strong>Existing</strong>
                <code>{file.path}</code>
                <Tag state={fileState(file)} />
              </div>
              <Code lines={view.existing} changed={view.gone} label="Existing file" />
            </section>
          )}
          <section className="pane">
            <div className="pane-head">
              <strong>Generated</strong>
              <code>{file.path}</code>
              {!view.existing && <Tag state="new" />}
              <span className="push" />
              {onEdit && (
                <button type="button" onClick={() => setEditing(true)}>
                  Edit blocks
                </button>
              )}
              <button type="button" onClick={() => download(file.path.split('/').pop(), file.content)}>
                Download
              </button>
              <button type="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <Code lines={view.generated} changed={view.added} label="Generated file" />
          </section>
        </div>
      )}
      {!error && !result && <SkeletonPreview />}
      {(error || (result && !file)) && !(editing && file) && <div className="panes empty" />}

      {!error && files.length > 0 && (
        <div className="main-foot">
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
          <div className="write">
            {!hosted && (
              <button type="button" className="primary" disabled={!canWrite || writing} onClick={() => onWrite(force)}>
                {writing ? 'Writing…' : 'Write files to folder'}
              </button>
            )}
            {files.length > 1 && (
              <button type="button" onClick={async () => download('dockcrate-files.zip', (await import('../lib/zip.js')).zip(files))}>
                Download all (.zip)
              </button>
            )}
            {counts.same + counts.differs > 0 && (
              <label className="check">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span>Overwrite existing files</span>
              </label>
            )}
            <span className="hint">
              {hosted
                ? 'Copy or download the files above.'
                : canWrite
                ? `${counts.new} new${counts.differs ? `, ${counts.differs} differ (kept unless “Overwrite” is ticked)` : ''}${counts.same ? `, ${counts.same} identical` : ''}.`
                : 'Choose a folder to write to, or copy or download the files above.'}
            </span>
          </div>
          {(written || writeError) && (
            <ul className="written" aria-live="polite">
              {writeError && <li className="error">{writeError}</li>}
              {written?.map(({ path, status: s }) => (
                <li key={path} className={s}>
                  {s === 'written' ? `wrote    ${path}` : `skipped  ${path} (exists; tick “Overwrite” to replace)`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
