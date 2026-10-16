import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { guard, isHosted, requestOrigin } from '../src/api.js';

/**
 * Origin this page is served from, for canonical, Open Graph and sitemap URLs.
 * Hosted: SITE_URL, else the production domain on Vercel (so previews canonicalise to it), else the request's own host.
 * Local: only localhost Hosts are ever accepted.
 */
export async function siteOrigin() {
  if (isHosted()) {
    if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
    if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    }
  }
  // Only a plain hostname[:port] and http/https from the request's headers; anything else falls back, never throws.
  return requestOrigin(await headers());
}

/** Every page goes through the same Host/Origin rules as the API, so a rebinding page cannot read your paths. */
export async function requireAllowedHost() {
  try {
    guard(await headers());
  } catch {
    notFound();
  }
}
