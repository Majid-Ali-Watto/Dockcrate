import { siteOrigin } from '../lib/site.js';
import { LANDING } from '../lib/landing.js';

export default async function sitemap() {
  const origin = await siteOrigin();
  return [
    { url: `${origin}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${origin}/generator`, changeFrequency: 'monthly', priority: 0.9 },
    ...LANDING.map(({ slug }) => ({ url: `${origin}/${slug}`, changeFrequency: 'monthly', priority: 0.8 })),
  ];
}
