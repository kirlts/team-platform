import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Below this diameter two letters at the 12 px floor of the type scale overflow the sphere («BP» in 16 px): the first initial only. */
const TWO_LETTERS_FROM = 24

/** Glass sphere with the initials. Decorative: the name is always written next to it. */
export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const letters = initials(name)
  return (
    <span
      aria-hidden
      className={cn('orb inline-flex shrink-0 items-center justify-center rounded-full font-bold', className)}
      style={{ width: size, height: size, fontSize: Math.max(12, size * 0.42) }}
    >
      {size < TWO_LETTERS_FROM ? letters.slice(0, 1) : letters}
    </span>
  )
}
