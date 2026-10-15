import { siteOrigin } from '../lib/site.js';

export default async function robots() {
  const origin = await siteOrigin();
  return { rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: `${origin}/sitemap.xml`, host: origin };
}
