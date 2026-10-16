import { DEVELOPER, RELATED_TOOLS } from '../lib/home.js';
import { LANDING } from '../lib/landing.js';
import { LEGAL } from '../lib/legal.js';
import ExternalLink from './ExternalLink.jsx';

export default function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="wrap site-foot-row">
        <div>
          <p className="site-foot-title">Dockcrate</p>
          <p className="muted">Docker &amp; CI/CD file generator for new projects.</p>
        </div>
        <nav aria-label="Generators">
          <p className="site-foot-title">Generators</p>
          <ul>
            <li>
              <a href="/generator">All-in-one generator</a>
            </li>
            {LANDING.map((page) => (
              <li key={page.slug}>
                <a href={`/${page.slug}`}>{page.nav}</a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Legal">
          <p className="site-foot-title">Legal</p>
          <ul>
            {LEGAL.map((page) => (
              <li key={page.slug}>
                <a href={`/${page.slug}`}>{page.nav}</a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="More from the developer">
          <p className="site-foot-title">More</p>
          <ul>
            <li>
              <ExternalLink href={DEVELOPER.url}>
                {DEVELOPER.name}, {DEVELOPER.role.toLowerCase()}
              </ExternalLink>
            </li>
            {RELATED_TOOLS.map((tool) => (
              <li key={tool.name}>
                <ExternalLink href={tool.url}>{tool.name}</ExternalLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
