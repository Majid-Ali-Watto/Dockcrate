import Landing from '../../components/Landing.jsx';
import { landingMetadata } from '../../lib/landing.js';

export const metadata = landingMetadata('dockerfile-generator');

export default function Page() {
  return <Landing slug="dockerfile-generator" />;
}
