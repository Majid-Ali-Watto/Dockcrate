import { NextResponse } from 'next/server';

/** Per-request Content-Security-Policy: only our own files and Next's nonce'd inline scripts may run. */
export function proxy(request) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production'; // React's dev tooling needs eval and the HMR socket
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self'${dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp);
  headers.set('x-nonce', nonce); // for the inline theme script in app/layout.jsx
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('cache-control', 'private, no-cache'); // not no-store, so the back/forward cache can keep the page
  return response;
}

// Pages only: static files and the JSON API do not render HTML.
export const config = { matcher: ['/((?!api/|_next/|.*\\..*).*)'] };
