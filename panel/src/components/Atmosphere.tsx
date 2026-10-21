/**
 * Background ornament: an orbit and three four-pointed sparkles over the sky. It sits behind
 * everything, without interaction and without meaning (aria-hidden); on a phone only the sparkles remain.
 */
const SPARKLE = 'M0 -10C1 -3 3 -1 10 0C3 1 1 3 0 10C-1 3 -3 1 -10 0C-3 -1 -1 -3 0 -10Z'

export function Atmosphere() {
  return (
    <svg
      aria-hidden
      focusable="false"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMaxYMin slice"
    >
      <g className="hidden md:inline" fill="none" stroke="var(--color-orbit)" strokeWidth="1.2">
        <g transform="rotate(-20 1400 40)">
          <ellipse cx="1400" cy="40" rx="500" ry="140" />
          <ellipse cx="1400" cy="40" rx="360" ry="96" strokeDasharray="2 7" />
        </g>
              </g>
      <g fill="var(--color-glass-edge)" stroke="var(--color-orbit)" strokeWidth="1">
        <path d={SPARKLE} transform="translate(1404 96) scale(1.4)" />
        <path className="hidden md:inline" d={SPARKLE} transform="translate(1362 520) scale(0.8)" />
        <path className="hidden md:inline" d={SPARKLE} transform="translate(330 804) scale(1.05)" />
      </g>
    </svg>
  )
}
