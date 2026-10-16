/** POST JSON to an API route; throws an Error carrying the server's message. */
export async function post(url, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

/** Hand `data` (a string or Blob) to the browser as a file download called `name`. */
export function download(name, data) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  // Some browsers start reading the URL only after this task: revoking it in the same tick can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The name one generated file is saved under: its whole path with folders joined by `_`, so `api/Dockerfile` and
 * `web/Dockerfile` differ, and without the leading dot of a dot-folder (`.github/workflows/ci.yml` gives
 * `github_workflows_ci.yml`, not a hidden file). A file at the root keeps its own name (`.dockerignore`).
 */
export const downloadName = (path) => (path.includes('/') ? path.replace(/^\.+/, '').split('/').join('_') : path);

/**
 * Copies `text` to the clipboard; true when it worked. The Clipboard API needs a secure origin and permission, so a
 * selected, visually hidden textarea and execCommand('copy') are the fallback.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'sr-only'; // a class, not a style attribute: the CSP forbids inline styles
  const focused = document.activeElement;
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  area.remove();
  focused?.focus?.();
  return ok;
}
