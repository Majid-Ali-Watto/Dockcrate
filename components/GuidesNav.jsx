import { LANDING } from '../lib/landing.js';

/** Links to the guide pages, under the editor's controls. Server-rendered so the guide copy stays out of the editor's script. */
export default function GuidesNav() {
  return (
    <nav className="guides" aria-label="Guides">
      <p>Guides</p>
      <ul>
        {LANDING.map((page) => (
          <li key={page.slug}>
            <a href={`/${page.slug}`}>{page.nav}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
