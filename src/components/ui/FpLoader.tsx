/**
 * Branded Fitpal loading spinner — gradient ring with pulsing "fp" badge.
 * Drop-in replacement for any loading placeholder.
 */
export default function FpLoader({ label }: { label?: string }) {
  return (
    <div className="fp-loader">
      <div className="fp-loader-ring">
        <svg viewBox="0 0 50 50">
          <defs>
            <linearGradient id="fp-loader-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--green)" />
              <stop offset="100%" stopColor="var(--green-dark)" />
            </linearGradient>
          </defs>
          <circle cx="25" cy="25" r="20" stroke="url(#fp-loader-grad)" />
        </svg>
        <div className="fp-loader-badge">fp</div>
      </div>
      {label && <div className="fp-loader-label">{label}</div>}
    </div>
  )
}
