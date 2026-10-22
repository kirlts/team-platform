import { AlertTriangle, ChevronRight } from '@/components/icons'
import type { ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { AreaChip } from './AreaChip'
import { HEADING } from './MessageCard'
import { useLookups } from './lookups'

/**
 * The count that opens the messages of a send (UD-254): «4 mensajes» and, when they fall in more than one area, the count of each area by
 * its chip. It is read before any message, so the person knows how many came out of the source before reading one.
 */
export function MessageTally({ areaIds }: { areaIds: string[] }) {
  const t = useT()
  const byArea = [...areaIds.reduce((acc, id) => acc.set(id, (acc.get(id) ?? 0) + 1), new Map<string, number>())]
  return (
    <div data-testid="message-tally" className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-semibold tabular-nums">{t('proposal.count', { n: areaIds.length })}</span>
      {byArea.length > 1 &&
        byArea.map(([id, n]) => (
          <span key={id} className="inline-flex items-center gap-1 text-xs tabular-nums text-muted">
            <AreaChip areaId={id} className="text-xs" />
            {n}
          </span>
        ))}
    </div>
  )
}

/**
 * One message of a send as a folded row (UD-254), the row of «Últimos mensajes» reduced to its first line: the area chip, the heading in one line
 * ended with an ellipsis (UD-241) and who it is for while it fits. A click opens it in place and shows what the message has (text, fields,
 * recipients, attachments and its actions, `children`); the arrow at the start of the open message folds it again.
 */
export function MessageFoldRow({
  index,
  areaId,
  title,
  assigneeIds,
  open,
  onToggle,
  aside,
  children,
  className,
  testId,
  ...rest
}: {
  index: number
  areaId: string
  title: string
  assigneeIds: string[]
  open: boolean
  onToggle: () => void
  /** Drawn at the right edge of the folded row: a mark that asks something of the person (a missing field). */
  aside?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
  style?: React.CSSProperties
  'data-area-id'?: string
}) {
  const t = useT()
  const { memberName } = useLookups()
  const n = index + 1
  const to = assigneeIds.map(memberName).filter(Boolean).join(', ')
  return (
    <li data-testid={testId} data-open={open || undefined} className={cn('list-none border-b border-line last:border-b-0', className)} {...rest}>
      {open ? (
        <div className="flex flex-col gap-2 py-2">
          <button type="button" aria-expanded aria-label={t('proposal.fold', { n, title })} onClick={onToggle} className="hit inline-flex items-center gap-1 self-start rounded-md px-1 text-xs font-semibold tabular-nums text-muted hover:bg-hover">
            <ChevronRight size={14} aria-hidden className="rotate-90 text-accent" />
            {n}
          </button>
          {children}
        </div>
      ) : (
        <button type="button" aria-expanded={false} aria-label={t('proposal.open', { n, title })} onClick={onToggle} className="hit flex w-full min-w-0 items-center gap-2 px-1 py-2 text-left hover:bg-hover">
          <ChevronRight size={14} aria-hidden className="shrink-0 text-muted" />
          <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-muted">{n}</span>
          <AreaChip areaId={areaId} className="shrink-0 text-xs" />
          <span data-testid="fold-title" title={title} data-ellipsis-ok="UD-241" className={cn(HEADING, 'flex-1')}>
            {title}
          </span>
          {/* Who it is for, in one line while it fits; a message without recipients says so with its mark, the one thing a row asks of the person (J2-B-17). */}
          {to ? (
            <span title={to} data-ellipsis-ok="UD-241" className="hidden min-w-0 max-w-[40%] shrink truncate text-xs text-muted @md:inline">
              {t('proposal.to', { names: to })}
            </span>
          ) : (
            <span data-needs-attention className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-danger">
              <AlertTriangle size={12} aria-hidden strokeWidth={2.2} /> {t('proposal.noRecipients')}
            </span>
          )}
          {aside}
        </button>
      )}
    </li>
  )
}
