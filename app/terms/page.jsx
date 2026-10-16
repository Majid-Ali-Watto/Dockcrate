import Legal from '../../components/Legal.jsx';
import { legalMetadata } from '../../lib/legal.js';

export const metadata = legalMetadata('terms');

export default function Page() {
  return <Legal slug="terms" />;
}
