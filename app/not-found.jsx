import SiteFooter from '../components/SiteFooter.jsx';
import SiteHeader from '../components/SiteHeader.jsx';

export const metadata = { title: 'Page not found', robots: { index: false } };

/** Replaces Next's built-in 404, whose inline styles the CSP (style-src 'self') blocks. Also what a refused Host gets. */
export default function NotFound() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="wrap wrap-narrow doc">
        <h1>Page not found</h1>
        <p className="section-lead">There is nothing at this address.</p>
        <p>
          <a className="btn btn-primary btn-lg" href="/generator">
            Open the generator
          </a>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
