import { useT } from '@/i18n'
import { StateMark } from '@/components/NotifyBadge'
import { STATES } from '@/lib/states'
import type { MessageStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * Filter by the three states of a message, each with its count (UD-041): «Todos» and then abierto, respondido and cerrado,
 * each with its shape, its color, its word and its number. One is chosen at a time; choosing it again leaves «Todos». The four sit in one
 * container, like the other choices of the panel, so each reads as a control and none as text; on a phone they make two equal rows of two, so none is left alone on a line.
 */
export function StateTabs({ value, counts, onChange, label }: { value: MessageStatus | null; counts: Record<MessageStatus, number>; onChange: (next: MessageStatus | null) => void; label: string }) {
  const t = useT()
  const total = STATES.reduce((n, s) => n + counts[s], 0)
  const base = 'inline-flex min-h-8 flex-1 items-center justify-center whitespace-nowrap rounded-full border px-2 text-sm font-semibold transition-colors duration-150 hover:bg-hover sm:flex-none'
  const on = 'opt-on'
  const off = 'border-transparent'
  return (
    <div role="radiogroup" aria-label={label} className="well opt-track flex self-start rounded-full p-0.5 max-sm:grid max-sm:grid-cols-2 max-sm:self-stretch max-sm:rounded-3xl">
      <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)} className={cn(base, 'gap-1.5', value === null ? on : off)}>
        {t('areas.allStates')}
        <span className="tabular-nums text-muted">{total}</span>
      </button>
      {STATES.map((status) => (
        <button key={status} type="button" role="radio" aria-checked={value === status} onClick={() => onChange(value === status ? null : status)} className={cn(base, value === status ? on : off)}>
          <StateMark status={status} n={counts[status]} plain />
        </button>
      ))}
    </div>
  )
}
