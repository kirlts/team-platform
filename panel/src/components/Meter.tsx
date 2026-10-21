import { cn } from '@/lib/utils'

/**
 * Progress bar. The server reports a percentage per finished step (MASTER-SPEC §7.10), so a job that has not
 * finished its first step is at 0 for a while: that is not a percentage worth drawing. At 0 the bar travels
 * (indeterminate, no `aria-valuenow`); from the first step on it shows the real figure (J1-B-06).
 */
export function Meter({ percent, label, className }: { percent: number; label: string; className?: string }) {
  const known = percent > 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(percent) : undefined}
      data-indeterminate={known ? undefined : ''}
      className={cn('meter', !known && 'meter-indeterminate', className)}
    >
      {known && <div className="meter-fill" style={{ width: `${percent}%` }} />}
    </div>
  )
}
