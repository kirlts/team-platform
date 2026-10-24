import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The switch that adds what was deleted to a list (UD-250): one word, pressed while the deleted rows are shown. */
export function ShowDeleted({ label, on, onChange, count }: { label: string; on: boolean; onChange: (next: boolean) => void; count?: number }) {
  return (
    <Button size="sm" variant="secondary" aria-pressed={on} data-testid="show-deleted" onClick={() => onChange(!on)} className={cn(on && '!border-[var(--pressed-edge)] bg-selected text-fg')}>
      {label}
      {count ? <span className="tabular-nums text-accent-deep">{count}</span> : null}
    </Button>
  )
}
