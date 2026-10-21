import { cn } from '@/lib/utils'

/**
 * The brand mark: the sphere and «[Proyecto] TEAM» in one ink and one size, the same in the top bar and on
 * the sign-in card (J1-A-02, J1-A-04). It is the quietest thing in the bar: the contrast belongs to what changes.
 */
export function Wordmark({ project, name, className }: { project?: string; name: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5 font-[family-name:var(--font-display)] text-sm font-bold uppercase leading-tight tracking-[0.14em] text-fg', className)}>
      <span aria-hidden className="orb h-4 w-4 shrink-0 rounded-full" />
      <span className="min-w-0 break-words">{project ? `${project} ${name}` : name}</span>
    </span>
  )
}
