import { NextResponse } from 'next/server';
import { isHosted } from './src/hosted.js';

/** Per-request Content-Security-Policy: only our own files and Next's nonce'd inline scripts may run. */
export function proxy(request) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  // Next's dev tooling (the overlay and the dev indicator) needs eval, the HMR socket and inline styles; none of it exists in production.
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "img-src 'self' data:",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Hosted only: locally the site is plain http://localhost, which this would break.
    ...(isHosted() ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  // A client-sent x-nonce never reaches the page: the header is always replaced by this request's own nonce.
  const headers = new Headers(request.headers);
  headers.delete('x-nonce');
  headers.set('content-security-policy', csp);
  headers.set('x-nonce', nonce); // for the inline theme script in app/layout.jsx
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('cache-control', 'private, no-cache'); // not no-store, so the back/forward cache can keep the page
  return response;
}

// Every page, including 404s for paths with a dot in them (`/x.y`); skipped: the JSON API, Next's static and image files,
// and real static files by extension (they get their headers from next.config.mjs).
export const config = {
  matcher: ['/((?!api/|_next/static/|_next/image|.*\\.(?:png|svg|ico|webmanifest|jpg|jpeg|webp|gif|css|js|map|woff|woff2|txt|xml)$).*)'],
};
