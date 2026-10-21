/**
 * Adorno de fondo: una órbita anclada a la esquina superior derecha. Va detrás de todo, sin
 * interacción y sin significado (aria-hidden), y no se dibuja en teléfono. Ningún destello suelto:
 * un adorno que no se ancla a nada flota (UD-016).
 */
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
    </svg>
  )
}
