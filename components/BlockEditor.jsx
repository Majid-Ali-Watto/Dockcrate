'use client';

import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useUndo } from './Undo.jsx';

// Every generated file is a list of blocks. Each can be rewritten, switched off, reset, or followed by a block of your own.
// `edit` is this file's entry in the form's `edits`; `change(updater)` replaces it.

const newId = () => `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** The text of one block. `handle` gets `{ focus(), reset(text) }` so a button that goes away can hand the focus here. */
function BlockText({ block, onText, handle }) {
  const ref = useRef(null);
  const [text, setText] = useState(block.text);
  // Follow the server's text, but never while you are typing in this box.
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(block.text);
  }, [block.text]);
  useImperativeHandle(handle, () => ({
    focus: () => ref.current?.focus(),
    reset: (next) => {
      setText(next);
      ref.current?.focus();
    },
  }));
  return (
    <textarea
      ref={ref}
      className="block-text"
      value={text}
      spellCheck={false}
      rows={Math.min(12, Math.max(2, text.split('\n').length))}
      aria-label={`Text of ${block.title}`}
      onChange={(e) => {
        setText(e.target.value);
        onText(e.target.value);
      }}
    />
  );
}

export default function BlockEditor({ file, edit = {}, change }) {
  const offerUndo = useUndo();
  const texts = useRef(new Map());
  const topButton = useRef(null);
  const blocks = file.blocks ?? [];
  const handleFor = (id) => (api) => {
    if (api) texts.current.set(id, api);
    else texts.current.delete(id);
  };
  const patchBlock = (block, patch) =>
    change((cur) => {
      const next = { ...cur, blocks: { ...(cur.blocks ?? {}) }, add: [...(cur.add ?? [])] };
      if (block.custom) next.add = next.add.map((a) => (a.id === block.id ? { ...a, ...patch } : a));
      else {
        const merged = { ...(next.blocks[block.id] ?? {}), ...patch };
        if (typeof merged.text === 'string' && merged.text.replace(/\n+$/, '') === block.base) delete merged.text;
        if (merged.text === undefined) delete merged.from;
        if (!merged.disabled) delete merged.disabled;
        if (Object.keys(merged).length) next.blocks[block.id] = merged;
        else delete next.blocks[block.id];
      }
      return next;
    });
  const setText = (block, text) => patchBlock(block, block.custom ? { text } : { text, from: block.base });
  // Back to the generated text; the button that did it disappears, so the focus goes to the block's text.
  const reset = (block) => {
    patchBlock(block, { text: block.base });
    texts.current.get(block.id)?.reset(block.base);
  };
  const addAfter = (after) => {
    const id = newId();
    change((cur) => ({ ...cur, add: [...(cur.add ?? []), { id, after, title: 'Custom block', text: '' }] }));
  };
  const remove = (block) => {
    // The next block's text gets the focus (or the previous one's, or the top of the editor).
    const at = blocks.findIndex((b) => b.id === block.id);
    const neighbour = blocks[at + 1] ?? blocks[at - 1];
    change((cur) => ({ ...cur, add: (cur.add ?? []).filter((a) => a.id !== block.id) }));
    if (neighbour && neighbour.id !== block.id) texts.current.get(neighbour.id)?.focus();
    else topButton.current?.focus();
  };
  const resetAll = () => {
    const before = edit;
    change(() => null);
    offerUndo({
      message: `Every edit of ${file.path} was reset.`,
      undo: () => change(() => before),
      focusAfter: () => topButton.current?.focus(),
      focusRestored: () => topButton.current?.focus(),
    });
  };

  const edited = Object.keys(edit.blocks ?? {}).length + (edit.add ?? []).length > 0;
  return (
    <div className="blocks" role="region" aria-label={`Blocks of ${file.path}`}>
      <div className="blocks-bar">
        <label className="check">
          <input type="checkbox" checked={!edit.disabled} onChange={(e) => change((cur) => ({ ...cur, disabled: !e.target.checked }))} />
          <span>Generate this file</span>
        </label>
        <button type="button" ref={topButton} onClick={() => addAfter('')}>
          + Block at top
        </button>
        {edited && (
          <button type="button" onClick={resetAll}>
            Reset all edits
          </button>
        )}
      </div>
      {blocks.map((b) => (
        <section key={b.id} className={`block${b.disabled ? ' off' : ''}`}>
          <header>
            <label className="check">
              <input type="checkbox" checked={!b.disabled} onChange={(e) => patchBlock(b, { disabled: !e.target.checked })} />
              <strong>{b.title}</strong>
            </label>
            <code className="muted">{b.id}</code>
            {b.disabled && <span className="tag same">off</span>}
            {b.edited && <span className="tag edited">edited</span>}
            {b.custom && <span className="tag new">yours</span>}
            {b.stale && <span className="tag differs" title="The generated text changed since you edited this block">outdated</span>}
            <span className="push" />
            {/* An outdated edit offers only "Use new": resetting it would do exactly the same. */}
            {b.edited && !b.custom && !b.stale && (
              <button type="button" onClick={() => reset(b)}>
                Reset
              </button>
            )}
            {b.stale && !b.custom && (
              <button type="button" onClick={() => reset(b)} title="Drop your edit and take the new generated text">
                Use new
              </button>
            )}
            {b.custom && (
              <button type="button" onClick={() => remove(b)}>
                Delete
              </button>
            )}
            <button type="button" onClick={() => addAfter(b.id)}>
              + Below
            </button>
          </header>
          <BlockText block={b} handle={handleFor(b.id)} onText={(text) => setText(b, text)} />
          {b.stale && b.base !== b.text && (
            <div className="hint">
              Your edit is based on older generated text; the current generated text is:
              <pre className="inline">{b.base}</pre>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
