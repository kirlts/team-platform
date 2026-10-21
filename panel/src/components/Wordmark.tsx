import { cn } from '@/lib/utils'

/**
 * The brand mark: the sphere and «[Proyecto] TEAM» in one ink and one size, the same in the top bar and on
 * the sign-in card (J1-A-02, J1-A-04). On the sign-in card, the only thing on the screen, it is `large`: it is the identity there (J3-A-01). It is the quietest thing in the bar: the contrast belongs to what changes, so it is set in semibold and a tighter tracking (J2-A-42).
 */
export function Wordmark({ project, name, className, large = false }: { project?: string; name: string; className?: string; large?: boolean }) {
  return (
    <span className={cn('flex min-w-0 items-center font-[family-name:var(--font-display)] font-semibold uppercase leading-tight text-fg', large ? 'gap-3 text-lg tracking-[0.12em]' : 'gap-2.5 text-sm tracking-[0.1em] max-md:text-xs max-md:tracking-[0.08em]', className)}>
      <span aria-hidden className={cn('orb shrink-0 rounded-full', large ? 'h-7 w-7' : 'h-4 w-4')} />
      <span className="min-w-0 break-words">{project ? `${project} ${name}` : name}</span>
    </span>
  )
}
