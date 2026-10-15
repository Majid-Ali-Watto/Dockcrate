import { siteOrigin } from '../lib/site.js';

export default async function robots() {
  const origin = await siteOrigin();
  // The page fills its previews from /api/generate, so a crawler that renders the page must be allowed to call it
  // (the longer Allow rule wins over the Disallow); the rest of the API stays off limits.
  return { rules: { userAgent: '*', allow: ['/', '/api/generate'], disallow: '/api/' }, sitemap: `${origin}/sitemap.xml`, host: origin };
}
