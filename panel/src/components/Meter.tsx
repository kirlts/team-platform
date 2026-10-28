import { cn } from '@/lib/utils'

/**
 * Progress bar. The server reports a percentage per finished step (MASTER-SPEC §7.10), so a job that has not
 * finished its first step is at 0 for a while: that is not a percentage worth drawing. At 0 the bar travels
 * (indeterminate, no `aria-valuenow`); from the first step on it shows the real figure (J1-B-06).
 * The height is part of the piece (`h-2.5`, the one of the analysis and the send bar): the fill and the glint measure 100 % of it, so a bar with no height
 * is two pixels of border. A use that needs another height passes its own class and replaces this one.
 * `thin` is the bar of a row (`h-1.5`, DISENO.md): the same well and the same fill in a line of text. `still` and `danger` draw a stretch that already ended: the glint is
 * only for work that runs, and a failed one takes the color of danger. A bar with `decorative` is not a progress bar for a screen reader (the row beside it already says its state).
 */
export function Meter({ percent, label, className, thin = false, still = false, danger = false, decorative = false }: { percent: number; label: string; className?: string; thin?: boolean; still?: boolean; danger?: boolean; decorative?: boolean }) {
  const known = percent > 0
  const tone = cn(still && 'meter-still', danger && 'meter-danger')
  if (decorative) {
    return (
      <div aria-hidden className={cn('meter', thin ? 'h-1.5' : 'h-2.5', tone, className)}>
        {known && <div className="meter-fill" style={{ width: `${percent}%` }} />}
      </div>
    )
  }
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(percent) : undefined}
      data-indeterminate={known ? undefined : ''}
      className={cn('meter', thin ? 'h-1.5' : 'h-2.5', !known && 'meter-indeterminate', tone, className)}
    >
      {known && <div className="meter-fill" style={{ width: `${percent}%` }} />}
    </div>
  )
}
