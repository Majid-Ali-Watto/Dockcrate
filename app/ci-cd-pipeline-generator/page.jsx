import Landing from '../../components/Landing.jsx';
import { landingMetadata } from '../../lib/landing.js';

export const metadata = landingMetadata('ci-cd-pipeline-generator');

export default function Page() {
  return <Landing slug="ci-cd-pipeline-generator" />;
}
