/**
 * Focuses the first element matching `selector` once React has committed the change that renders it (the next frame), so a
 * button that removes itself or adds a row can hand focus to the right place. Returns nothing; a missing element is ignored.
 */
export function focusSoon(selector) {
  requestAnimationFrame(() => {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector?.();
    if (!el) return;
    // A control inside a closed <details> section cannot take focus: open the sections around it first.
    for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS' && !p.open) p.open = true;
    el.focus();
  });
}

/** The CSS selector of the element carrying `data-field` = `key` (a form field, see describeError in lib/form.js). */
export const fieldSelector = (key) => `[data-field="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key}"]`;
