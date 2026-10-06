// The Prism logo mark: a beam of light entering a prism and leaving as a
// spectrum, echoing what the app does with a single doorbell event.
// Decorative -- the wordmark next to it carries the name.

export function PrismMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="prism-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="1" y1="22" x2="15" y2="20" stroke="#F3F5F8" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 6 L33 30 H7 Z" fill="none" stroke="#F3F5F8" strokeWidth="2.2" strokeLinejoin="round" />
      <line x1="25" y1="19" x2="39" y2="13" stroke="#9DB2FF" strokeWidth="2" strokeLinecap="round" />
      <line x1="26" y1="21" x2="39" y2="18" stroke="#5FD4C4" strokeWidth="2" strokeLinecap="round" />
      <line x1="26" y1="23" x2="39" y2="23" stroke="#F5B74A" strokeWidth="2" strokeLinecap="round" />
      <line x1="25" y1="25" x2="39" y2="28" stroke="#FF7A7A" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
