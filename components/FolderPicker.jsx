'use client';

import { useEffect, useRef, useState } from 'react';
import { post } from '../lib/client.js';

export default function FolderPicker({ open, startDir, home, onClose, onChoose }) {
  const dialog = useRef(null);
  const [state, setState] = useState({ dir: '', parent: null, entries: [] });
  const [message, setMessage] = useState('');

  async function go(dir) {
    try {
      setState(await post('/api/browse', { dir }));
      setMessage('');
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => {
    const el = dialog.current;
    if (open && !el.open) {
      el.showModal();
      go(startDir || home);
    } else if (!open && el.open) {
      el.close();
    }
    // `go` and `startDir` are read when the dialog opens only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <dialog ref={dialog} className="picker" aria-labelledby="picker-title" onClose={onClose}>
      <div className="dlg-head">
        <h2 id="picker-title">Select project folder</h2>
        <div className="dlg-nav">
          <button type="button" disabled={!state.parent} onClick={() => go(state.parent)}>
            ↑ Up
          </button>
          <button type="button" onClick={() => go(home)}>
            Home
          </button>
          <code title={state.dir}>{state.dir}</code>
        </div>
      </div>
      <ul className="folders">
        {state.entries.map((e) => (
          <li key={e.name}>
            <button type="button" onClick={() => go(`${state.dir.replace(/\/$/, '')}/${e.name}`)}>
              <span>📁 {e.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className={`browse-msg ${message ? 'error' : ''}`} role="status" aria-live="polite">
        {message || (state.entries.length ? '' : 'No subfolders here.')}
      </p>
      <div className="dlg-foot">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => onChoose(state.dir)}>
          Use this folder
        </button>
      </div>
    </dialog>
  );
}
