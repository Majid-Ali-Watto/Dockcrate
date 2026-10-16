import Home from '../components/Home.jsx';
import { siteOrigin } from '../lib/site.js';
import { scriptJson } from '../src/api.js';
import { DEVELOPER, PROVIDERS, STACKS, TARGETS } from '../lib/home.js';
import pkg from '../package.json' with { type: 'json' };

// Rendered per request: the Host check and the canonical origin come from the request.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const origin = await siteOrigin();
  const jsonLd = scriptJson({
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
    featureList: [
      'Dockerfile and .dockerignore',
      'docker-compose with services',
      `CI/CD for ${PROVIDERS.length} providers`,
      `${STACKS.length} stacks`,
      `${TARGETS.length} deployment options: Kubernetes, ECS, Cloud Run, Fly, Azure and SSH`,
    ],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    author: { '@type': 'Person', name: DEVELOPER.name, url: DEVELOPER.url, jobTitle: DEVELOPER.role },
  });
  return (
    <>
      <Home />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
    </>
  );
}
