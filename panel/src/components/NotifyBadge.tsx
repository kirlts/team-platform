import { AlertTriangle, Clock, InfoDot } from '@/components/icons'
import { useEffect, useRef, useState } from 'react'
import { useT, type MessageKey } from '@/i18n'
import { STATUS_KEY } from '@/components/StatusBadge'
import { STATES, stateTotal, topState, type StateCounts } from '@/lib/states'
import type { MessageStatus } from '@team-platform/client'
import { cn } from '@/lib/utils'

const ICON = { open: AlertTriangle, answered: Clock, closed: InfoDot } as const
/** «N abiertos», «N respondidos», «N cerrados»: the count with the word of its state. */
const COUNT_KEY: Record<MessageStatus, MessageKey> = { open: 'state.open', answered: 'state.answered', closed: 'state.closed' }

/** The shape of a state (triangle, clock, dot), for places that draw their own pill. */
export function StateIcon({ status, size = 16 }: { status: MessageStatus; size?: number }) {
  const Icon = ICON[status]
  return <Icon size={size} aria-hidden strokeWidth={2.2} />
}

/**
 * The mark of one state: its shape, its word and (optionally) a count. The shape and the word say it without the color.
 * It is quiet (UD-036): neutral ink, the state only in the color of its shape. `plain` also drops the edge, for a row.
 * With `n` the word agrees with the count («3 abiertos», «1 respondido»).
 */
export function StateMark({ status, n, className, showWord = true, plain = false }: { status: MessageStatus; n?: number; className?: string; showWord?: boolean; plain?: boolean }) {
  const t = useT()
  return (
    <span data-status={status} data-weight="quiet" data-plain={plain || undefined} data-zero={n === 0 || undefined} data-testid="state-mark" className={cn('inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-xs font-bold leading-none', className)}>
      <StateIcon status={status} size={16} />
      {n !== undefined ? <span className="tabular-nums">{showWord ? t(COUNT_KEY[status], { n }) : n}</span> : showWord && <span>{t(STATUS_KEY[status])}</span>}
    </span>
  )
}

/** «1 abierto, 2 respondidos»: the accessible name of a count that mixes states. */
export function useCountsLabel() {
  const t = useT()
  return (counts: StateCounts) =>
    STATES.filter((status) => (counts[status] ?? 0) > 0)
      .map((status) => t(COUNT_KEY[status], { n: counts[status] ?? 0 }))
      .join(', ')
}

/** True for a moment after `value` changes (not on the first draw): the count that moved says so (J2-B-27). */
export function usePulse(value: number) {
  const previous = useRef(value)
  const [pulse, setPulse] = useState(false)
  useEffect(() => {
    const before = previous.current
    previous.current = value
    // A count that arrives (0 to n, the data loading) is not a change; one that moves from a figure to another is.
    if (before === value || before === 0) return
    setPulse(true)
    const id = window.setTimeout(() => setPulse(false), 700)
    return () => window.clearTimeout(id)
  }, [value])
  return pulse
}

/**
 * The count badge: its tint is the highest state present (open > answered > closed), it carries the shape of
 * that state and the total as a number, and its accessible name says each count with its word. Nothing present renders nothing.
 * It is the quiet weight: the only solid fill in the interface is the bell (J2-B-03, UD-036).
 */
export function NotifyBadge({ counts, size = 'lg', className, ...rest }: { counts: StateCounts; size?: 'lg' | 'md' | 'plain'; className?: string; 'data-testid'?: string }) {
  const label = useCountsLabel()
  const status = topState(counts)
  const total = stateTotal(counts)
  const pulse = usePulse(total)
  if (!status) return null
  return (
    <span
      {...rest}
      data-status={status}
      data-weight="quiet"
      data-pulse={pulse}
      data-plain={size === 'plain' || undefined}
      data-count={total}
      role="img"
      aria-label={label(counts)}
      className={cn('inline-flex shrink-0 items-center justify-center gap-1 rounded-full border font-bold leading-none', size === 'lg' ? 'h-8 min-w-12 px-2.5 text-sm' : size === 'md' ? 'h-6 min-w-9 px-2 text-xs' : 'h-6 text-xs', className)}
    >
      <StateIcon status={status} size={16} />
      <span className="tabular-nums">{total}</span>
    </span>
  )
}
