import { Skeleton, SkeletonFields, SkeletonPreview } from '../../components/Skeleton.jsx';

// Shown while the page is rendered on the server and its script loads: the same shell as the app, with grey placeholders.
export default function Loading() {
  return (
    <div className="app loading-page">
      <aside className="sidebar">
        <header className="brand">
          <div className="brand-top">
            <h1 className="logo">
              <img src="/logo.svg" alt="" width="28" height="28" />
              Dockcrate
            </h1>
          </div>
          <Skeleton rows={2} label="Loading Dockcrate" />
        </header>
        <div className="sidebar-body">
          <SkeletonFields count={7} />
        </div>
      </aside>
      <main className="main">
        <SkeletonPreview />
      </main>
    </div>
  );
}
