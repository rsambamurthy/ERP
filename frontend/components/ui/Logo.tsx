export default function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="16" fill="#1E2A44" />
      <path
        d="M23 24c0-3.5 3.5-6 9-6s9 2.2 9 5.4c0 6.2-16 4-16 12 0 3.6 3.7 6.6 9.5 6.6 5 0 8.6-1.9 9.5-5"
        stroke="#D4712F"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="46" cy="19" r="3" fill="#D4712F" />
    </svg>
  );
}
