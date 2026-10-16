import { UPDATED, legalBySlug } from '../lib/legal.js';
import { requireAllowedHost } from '../lib/site.js';
import SiteFooter from './SiteFooter.jsx';
import SiteHeader from './SiteHeader.jsx';
import ExternalLink from './ExternalLink.jsx';

/** Server-rendered privacy / terms page: plain text, no client code. */
export default async function Legal({ slug }) {
  await requireAllowedHost();
  const page = legalBySlug(slug);
  return (
    <div className="site">
      <SiteHeader />
      <main className="wrap wrap-narrow doc">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="/">Home</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{page.nav}</span>
        </nav>
        <h1>{page.h1}</h1>
        <p className="section-lead">{page.lead}</p>
        <p className="muted">Last updated: {UPDATED}</p>
        {page.sections.map((section) => (
          <section key={section.h}>
            <h2>{section.h}</h2>
            {section.text.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.list && (
              <ul className="plain">
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {section.after && <p>{section.after}</p>}
            {section.link && (
              <p>
                <ExternalLink href={section.link[0]}>{section.link[1]}</ExternalLink>
              </p>
            )}
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
