// Line icons for the nav groups, keyed by NavGroup.id. Used by both the sidebar
// and the /menu cards. Falls back to the group's text `icon` for any group id
// without an entry here, so adding a new group never renders blank.
const PATHS: Record<string, React.ReactNode> = {
  // gear
  config: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  // tag / price
  sales: (
    <>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
  // shopping cart
  purchase: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.6 12.4a2 2 0 002 1.6h8.2a2 2 0 002-1.5L21.5 8H6" />
    </>
  ),
  // box
  inventory: (
    <>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z" />
      <path d="M3.3 7.5L12 12.5l8.7-5M12 22V12.5" />
    </>
  ),
  // factory
  manufacturing: (
    <>
      <path d="M2 21V10l6 4V10l6 4V6h4v15H2z" />
      <path d="M6 17h2M11 17h2M16 17h0" />
    </>
  ),
  // book / ledger
  accounting: (
    <>
      <path d="M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 21.5v-17z" />
      <path d="M4 21.5A2.5 2.5 0 006.5 24H20M9 7h7M9 11h7" />
    </>
  ),
  // report / document with check
  statutory: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
      <path d="M14 2v6h6M9 14l2 2 4-4" />
    </>
  ),
};

export default function GroupIcon({ id, fallback, size = 12 }: { id: string; fallback: string; size?: number }) {
  const paths = PATHS[id];
  if (!paths) return <>{fallback}</>;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}
