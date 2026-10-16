import Landing from '../../components/Landing.jsx';
import { landingMetadata } from '../../lib/landing.js';

export const metadata = landingMetadata('github-actions-workflow-generator');

export default function Page() {
  return <Landing slug="github-actions-workflow-generator" />;
}
