/**
 * Join lines (nested arrays allowed); false/null/undefined parts are dropped so conditionals stay inline.
 * Anything else that is not a string (a stray `0` from `list.length && ...`, `true`) is a bug: fail loudly.
 */
export const lines = (...parts) =>
  parts
    .flat(Infinity)
    .filter((l) => l !== false && l != null)
    .map((l) => {
      if (typeof l === 'function') throw new TypeError(`lines(): got a function (${l.name || 'anonymous'}); call it or pass its result`);
      if (typeof l !== 'string') throw new TypeError(`lines(): unexpected ${typeof l} part ${JSON.stringify(l)}`);
      return l;
    })
    .join('\n') + '\n';
