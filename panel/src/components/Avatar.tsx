import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Glass sphere with the initials. Decorative: the name is always written next to it. */
export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('orb inline-flex shrink-0 items-center justify-center rounded-full font-bold', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }}
    >
      {initials(name)}
    </span>
  )
}
