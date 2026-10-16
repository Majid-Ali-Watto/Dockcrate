/** A link to another site: opens in a new tab (noreferrer also hides this site from the other one's logs, matching the referrer policy). */
export default function ExternalLink({ children, ...props }) {
  return (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
