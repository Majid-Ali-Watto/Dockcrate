import { siteOrigin } from '../lib/site.js';

export default async function sitemap() {
  return [{ url: `${await siteOrigin()}/`, changeFrequency: 'monthly', priority: 1 }];
}
