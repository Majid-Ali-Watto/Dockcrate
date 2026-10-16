import Landing from '../../components/Landing.jsx';
import { landingMetadata } from '../../lib/landing.js';

export const metadata = landingMetadata('docker-compose-generator');

export default function Page() {
  return <Landing slug="docker-compose-generator" />;
}
