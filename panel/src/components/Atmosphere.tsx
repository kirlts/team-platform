/**
 * Background ornament: an orbit anchored to the top-right corner. It sits behind everything, with no
 * interaction and no meaning (aria-hidden), and is not drawn on a phone. No loose sparkle:
 * an ornament that is not anchored to anything floats (UD-016).
 */
export function Atmosphere() {
  return (
    <svg
      aria-hidden
      focusable="false"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full [mask-image:linear-gradient(to_bottom,black_3.5rem,transparent_9rem)]"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMaxYMin slice"
    >
      <g className="hidden md:inline" fill="none" stroke="var(--color-orbit)" strokeWidth="1.2">
        <g transform="rotate(-20 1400 40)">
          <ellipse cx="1400" cy="40" rx="500" ry="140" />
          <ellipse cx="1400" cy="40" rx="360" ry="96" strokeDasharray="2 7" />
        </g>
      </g>
    </svg>
  )
}
