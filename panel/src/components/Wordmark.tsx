import { cn } from '@/lib/utils'

/**
 * The brand mark: the sphere and «[Proyecto] TEAM» in one ink and one size, the same in the top bar and on
 * the sign-in card (J1-A-02, J1-A-04). On the sign-in card, the only thing on the screen, it is `large`: it is the identity there (J3-A-01). It is the quietest thing in the bar: the contrast belongs to what changes, so it is set in semibold and a tighter tracking (J2-A-42). On a phone the tracking is half the host's, which is what lets «[Nombre] TEAM» stay on one line at 360 px.
 */
export function Wordmark({ project, name, className, large = false }: { project?: string; name: string; className?: string; large?: boolean }) {
  return (
    <span className={cn('wordmark flex min-w-0 items-center leading-tight text-fg', large ? 'gap-3 text-lg' : 'gap-2.5 text-[length:var(--wordmark-size)] max-md:gap-1.5 max-md:text-xs max-md:tracking-[calc(var(--wordmark-tracking)*0.5)]', className)}>
      {/* A host's logo image (theme contract: --wordmark-logo); without one it is not drawn and the sphere stays. */}
      <span aria-hidden data-testid="wordmark-logo" className={cn('wordmark-logo shrink-0', large && 'wordmark-logo-large')} />
      <span aria-hidden className={cn('wordmark-orb orb shrink-0 rounded-full [--orb-bottom:var(--color-gel-bottom)] [--orb-top:var(--color-gel-top)]', large ? 'h-7 w-7' : 'h-4 w-4')} />
      {/* One line on a phone (J3-D3-01): «TEAM» keeps its place and, only when the whole name cannot fit, the name of the instance gives way with an ellipsis. From 768 px the text wraps as before. */}
      <span className="min-w-0 break-words max-md:flex max-md:gap-[0.4em] max-md:whitespace-nowrap">
        {project && <span className="wordmark-project max-md:min-w-0 max-md:truncate">{project} </span>}
        <span className="max-md:shrink-0">{name}</span>
      </span>
    </span>
  )
}
