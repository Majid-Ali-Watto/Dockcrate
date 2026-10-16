import { Skeleton, SkeletonFields, SkeletonPreview } from '../../components/Skeleton.jsx';

// Shown while the page is rendered on the server and its script loads: the same shell as the app (components/App.jsx),
// with grey placeholders, so nothing moves when the real page replaces it. The phone-only jump links are here too.
export default function Loading() {
  return (
    <div className="app loading-page">
      <section className="sidebar" aria-label="Options">
        <header className="brand">
          <div className="brand-top">
            <h1 className="logo">
              <img src="/logo.svg" alt="" width="28" height="28" />
              Dockcrate
            </h1>
          </div>
          <Skeleton rows={2} label="Loading Dockcrate" />
          <a className="jump" href="#preview">
            Jump to preview ↓
          </a>
        </header>
        <div className="sidebar-body">
          <SkeletonFields count={7} />
        </div>
      </section>
      <main className="main">
        <div className="main-head">
          <a className="jump" href="#options">
            Back to options ↑
          </a>
        </div>
        <SkeletonPreview />
      </main>
    </div>
  );
}
