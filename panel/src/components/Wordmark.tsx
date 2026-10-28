import { cn } from '@/lib/utils'

/**
 * The brand mark: the sphere and «[Proyecto] TEAM» in one ink and one size, the same in the top bar and on
 * the sign-in card (J1-A-02, J1-A-04). On the sign-in card, the only thing on the screen, it is `large`: it is the identity there (J3-A-01). It is the quietest thing in the bar: the contrast belongs to what changes, so it is set in semibold and a tighter tracking (J2-A-42). On a phone there is no tracking, and below 381 px the sphere is not drawn, which together with the 8 px that the bar gives back is what lets «[Nombre] TEAM» stay on one line at 360 px (measured 2026-10-27: 12 px with half the tracking needs 144 px of the 134 px that the bar leaves; the type stays at the 12 px of the scale).
 */
export function Wordmark({ project, name, className, large = false }: { project?: string; name: string; className?: string; large?: boolean }) {
  return (
    <span className={cn('wordmark flex min-w-0 items-center leading-tight text-fg', large ? 'gap-3 text-lg' : 'gap-2.5 text-[length:var(--wordmark-size)] max-md:gap-1.5 max-md:text-xs max-md:tracking-normal', className)}>
      {/* A host's logo image (theme contract: --wordmark-logo); without one it is not drawn and the sphere stays. */}
      <span aria-hidden data-testid="wordmark-logo" className={cn('wordmark-logo shrink-0', large && 'wordmark-logo-large')} />
      <span aria-hidden className={cn('wordmark-orb orb shrink-0 rounded-full [--orb-bottom:var(--color-gel-bottom)] [--orb-top:var(--color-gel-top)]', large ? 'h-7 w-7' : 'h-4 w-4 max-[380px]:hidden')} />
      {/* One line on a phone (J3-D3-01): «TEAM» keeps its place and, only when the whole name cannot fit, the name of the instance gives way with an ellipsis. From 768 px the text wraps as before. */}
      <span className="min-w-0 break-words max-md:flex max-md:gap-[0.3em] max-md:whitespace-nowrap">
        {project && <span className="wordmark-project max-md:min-w-0 max-md:truncate" data-ellipsis-ok="J3-D3-01" title={project}>{project} </span>}{/* justified: on a phone the bar is one line (J3-D3-01), «TEAM» keeps its place and the whole name of the instance is the title */}
        <span className="max-md:shrink-0">{name}</span>
      </span>
    </span>
  )
}
