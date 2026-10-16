'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// A destructive action (remove a service, go back to one environment, reset a file's edits...) offers an undo for a few
// seconds instead of asking first. Focus moves to the Undo button, since the control that was pressed is gone.

const UndoContext = createContext(() => {});

/** `offer({ message, undo, focusAfter, focusRestored })`: show `message` with an Undo button for UNDO_MS. */
export const useUndo = () => useContext(UndoContext);

const UNDO_MS = 8000;

export function UndoProvider({ children }) {
  const [item, setItem] = useState(null);
  const offer = useCallback((next) => setItem({ ...next, at: Date.now() }), []);
  const close = useCallback(() => setItem(null), []);
  return (
    <UndoContext.Provider value={offer}>
      {children}
      <Snackbar item={item} close={close} />
    </UndoContext.Provider>
  );
}

function Snackbar({ item, close }) {
  const box = useRef(null);
  const undoButton = useRef(null);
  const [paused, setPaused] = useState(false);

  // Focus the Undo button when an offer appears.
  useEffect(() => {
    if (item) undoButton.current?.focus();
  }, [item]);

  // Disappear after a while, but never while the pointer or the focus is on it.
  useEffect(() => {
    if (!item || paused) return undefined;
    const timer = setTimeout(close, UNDO_MS);
    return () => clearTimeout(timer);
  }, [item, paused, close]);

  const leave = (then) => {
    const inside = box.current?.contains(document.activeElement);
    close();
    setPaused(false);
    if (then) then();
    else if (inside) item.focusAfter?.();
  };

  return (
    <div className="snackbar-region" role="status">
      {item && (
        <div
          ref={box}
          className="snackbar"
          onFocus={() => setPaused(true)}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaused(false)}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onKeyDown={(e) => e.key === 'Escape' && leave()}
        >
          <span>{item.message}</span>
          <button
            ref={undoButton}
            type="button"
            className="snackbar-undo"
            onClick={() =>
              leave(() => {
                item.undo();
                item.focusRestored?.();
              })
            }
          >
            Undo
          </button>
          <button type="button" className="snackbar-close" aria-label="Dismiss" onClick={() => leave()}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
