import App from '../../components/App.jsx';
import GuidesNav from '../../components/GuidesNav.jsx';
import { getMeta } from '../../src/api.js';
import { requireAllowedHost } from '../../lib/site.js';

// Rendered per request, so `requireAllowedHost()` sees the request's own Host.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Generator',
  description: 'Pick a stack, preview the Dockerfile, docker-compose, CI/CD pipeline and deployment files, then copy or download them.',
  alternates: { canonical: '/generator' },
  openGraph: { url: '/generator' },
};

export default async function Page() {
  await requireAllowedHost();
  return <App meta={getMeta()} guides={<GuidesNav />} />;
}
