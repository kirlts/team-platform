import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Esfera de vidrio con las iniciales. Decorativa: el nombre siempre va escrito al lado. */
export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('orb inline-flex shrink-0 items-center justify-center rounded-full font-bold', className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
    >
      {initials(name)}
    </span>
  )
}
