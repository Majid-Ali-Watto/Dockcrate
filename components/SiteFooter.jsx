import { LANDING } from '../lib/landing.js';

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
      </div>
    </footer>
  );
}
