// Placeholders shown while a section is on its way. Sized with classes only: the CSP forbids inline styles.
const WIDTHS = ['w90', 'w70', 'w80', 'w50', 'w60'];

/** `rows` lines of grey bars; `label` is what a screen reader hears. */
export function Skeleton({ rows = 3, label = 'Loading' }) {
  return (
    <div className="skeleton" role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className={`skel line ${WIDTHS[i % WIDTHS.length]}`} aria-hidden="true" />
      ))}
    </div>
  );
}

/** A form field: label bar over an input bar. */
export function SkeletonFields({ count = 4, label = 'Loading the form' }) {
  return (
    <div className="skeleton" role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-field" key={i} aria-hidden="true">
          <span className="skel label w30" />
          <span className="skel input" />
        </div>
      ))}
    </div>
  );
}

/** The preview pane while the first result is computed: file tabs over a block of code. */
export function SkeletonPreview() {
  return (
    <div className="skeleton skel-preview" role="status" aria-busy="true">
      <span className="sr-only">Generating the files…</span>
      <div className="skel-tabs" aria-hidden="true">
        {['w30', 'w20', 'w30', 'w20'].map((w, i) => (
          <span key={i} className={`skel tab ${w}`} />
        ))}
      </div>
      <div className="skel-code" aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => (
          <span key={i} className={`skel line ${WIDTHS[(i * 3) % WIDTHS.length]}`} />
        ))}
      </div>
    </div>
  );
}
