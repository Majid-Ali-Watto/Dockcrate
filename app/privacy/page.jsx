import Legal from '../../components/Legal.jsx';
import { legalMetadata } from '../../lib/legal.js';

export const metadata = legalMetadata('privacy');

export default function Page() {
  return <Legal slug="privacy" />;
}
