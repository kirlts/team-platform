import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'

export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }}
    >
      {initials(name)}
    </span>
  )
}
