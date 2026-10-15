import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import App from '../components/App.jsx';
import { getMeta, guard } from '../src/api.js';
import { siteOrigin } from '../lib/site.js';
import pkg from '../package.json' with { type: 'json' };

// Rendered per request: the page embeds the folder `dockcrate serve` was started in.
export const dynamic = 'force-dynamic';

export default async function Page() {
  try {
    guard(await headers()); // same Host/Origin rules as the API, so a rebinding page cannot read your paths
  } catch {
    notFound();
  }
  const origin = await siteOrigin();
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Dockcrate',
    url: `${origin}/`,
    description: 'Generates Dockerfile, docker-compose, CI/CD pipeline and deployment config for any project.',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    softwareVersion: pkg.version,
    image: `${origin}/og-image.png`,
    logo: `${origin}/icons/icon-512.png`,
    featureList: ['Dockerfile and .dockerignore', 'docker-compose with services', 'CI/CD for seven providers', 'Kubernetes, ECS, Cloud Run, Fly and Azure deploys'],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  });
  return (
    <>
      <App meta={getMeta()} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
    </>
  );
}
