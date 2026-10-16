import ThemeToggle from './ThemeToggle.jsx';

/** Top bar of the landing and guide pages (the generator has its own sidebar header). */
export default function SiteHeader() {
  return (
    <header className="site-head">
      <div className="wrap site-head-row">
        <a className="site-logo" href="/">
          <img src="/logo.svg" alt="" width="28" height="28" />
          Dockcrate
        </a>
        <div className="site-head-end">
          <ThemeToggle />
          <a className="btn btn-primary" href="/generator">
            <span className="sm-hide">Open the </span>
            <span className="cap">generator</span>
          </a>
        </div>
      </div>
    </header>
  );
}
