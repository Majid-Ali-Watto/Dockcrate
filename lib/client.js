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
  URL.revokeObjectURL(url);
}
