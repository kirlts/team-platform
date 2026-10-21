import type { KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { AreaChip } from '@/components/AreaChip'
import { StateIcon, StateMark, usePulse } from '@/components/NotifyBadge'
import { useLookups } from '@/components/lookups'
import { ArrowRight, ChevronDown } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { ME, serializeQuery, type Filter } from '@/lib/filters'
import { mineCounts } from '@/lib/pending'
import { noticeState, topState, type StateCounts } from '@/lib/states'
import { useMe, useMessages, useSummary } from '@/lib/queries'
import type { Message, MessageStatus } from '@/lib/types'

/** The three states, each one a mark of the bar (UD-100). Closed ones raise no notice (UD-041), but the owner asked for the three. */
const STATES_SHOWN = ['open', 'answered', 'closed'] as const
const WORD: Record<MessageStatus, MessageKey> = { open: 'state.open', answered: 'state.answered', closed: 'state.closed' }

const messagesPath = (filters: Filter[]) => `/messages?${serializeQuery({ filters, q: '' }).toString()}`
/** Where a mark leads: Mensajes filtered by the state and by «para mí» (the assigned ones; the server has no filter for «sent by me with replies»). */
const mineFilters = (status: MessageStatus): Filter[] => [{ prop: 'for', op: 'eq', value: ME }, { prop: 'status', op: 'eq', value: status }]

/**
 * The messages of one state that concern me: the same rule the server uses for the counts (UD-028): assigned to me, or sent by me and answered.
 * A closed one concerns me when I was assigned to it or sent it.
 */
function useMine(status: MessageStatus, enabled = true) {
  const me = useMe().data
  const id = me?.id ?? ''
  const list = useMessages({ query: { filters: [{ prop: 'status', op: 'eq', value: status }], q: '' }, meId: id, enabled })
  const mine = (m: Message) => (status === 'closed' ? m.assignee_ids.includes(id) || m.author_id === id : noticeState(m, id) === status)
  return { ...list, rows: id ? (list.data ?? []).filter(mine) : [] }
}

/**
 * The three states of the messages that concern me, in the top bar of every page (UD-100): each one is its shape, its color and its number, with
 * no visible word (the word is the accessible name and the tooltip). A click opens a small menu anchored to the mark with those messages, so the
 * page you are on stays where it is; it ends in the link to Mensajes already filtered by that state. There is no count per area in the bar: those live
 * in the sidebar and in the view of each area. On a phone one button carries the pending total and its menu has the three states.
 */
export function StatusBar() {
  const t = useT()
  const summary = useSummary().data
  const closed = useMine('closed').rows.length
  const counts: StateCounts = { ...mineCounts(summary), closed }
  const top = topState({ open: counts.open, answered: counts.answered })
  const total = (counts.open ?? 0) + (counts.answered ?? 0)
  const pulse = usePulse(total)
  if (!summary) return null
  return (
    <section aria-label={t('bar.label')} data-testid="status-bar" data-state-top={top ?? 'none'} data-pulse={pulse} className="flex min-w-0 items-center justify-end gap-2">
      <ul aria-label={t('bar.mine')} className="hidden shrink-0 items-center gap-1 md:flex">
        {STATES_SHOWN.map((status) => (
          <li key={status}>
            <StateButton status={status} n={counts[status] ?? 0} />
          </li>
        ))}
      </ul>
      <PhoneSummary top={top} total={total} counts={counts} />
    </section>
  )
}

/** One state that affects me: its shape and its number. The word lives in the accessible name and in the tooltip. */
function StateButton({ status, n }: { status: MessageStatus; n: number }) {
  const t = useT()
  const word = t(WORD[status], { n })
  const filters = mineFilters(status)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="state-button" data-status={status} data-weight="quiet" data-count={n} aria-label={word} title={word} className="inline-flex h-9 min-w-11 items-center justify-center gap-1 rounded-full border px-2.5 text-sm font-bold leading-none hover:bg-glass">
          <StateIcon status={status} size={16} />
          <span className="tabular-nums">{n}</span>
        </button>
      </PopoverTrigger>
      <MessageMenu name={word} status={status} seeAll={messagesPath(filters)} />
    </Popover>
  )
}

/** The messages behind a number, as a small menu under its mark: title, area, who and when; arrows walk the rows. */
function MessageMenu({ name, status, seeAll }: { name: string; status: MessageStatus; seeAll: string }) {
  const t = useT()
  const format = useFormat()
  const { memberName } = useLookups()
  const list = useMine(status)
  const rows = list.rows
  const walk = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const links = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-lane="status-list"] a')]
    const at = links.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? Math.min(links.length - 1, at + 1) : Math.max(0, at - 1)
    links[next]?.focus()
    e.preventDefault()
  }
  return (
    <PopoverContent align="end" sideOffset={10} collisionPadding={8} aria-label={name} data-testid="status-menu" onKeyDown={walk} className="flex max-h-[var(--radix-popover-content-available-height)] w-[24rem] flex-col p-0">
      {list.isPending ? (
        <p className="px-3 py-4 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted">{t('bar.none')}</p>
      ) : (
        <ul data-lane="status-list" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {rows.map((m) => (
            <li key={m.id} data-testid="status-row" className="border-b border-line">
              <Link to={`/messages/${m.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 px-3 py-2 hover:bg-hover">
                <span className="flex min-w-0 items-start gap-1.5">
                  <span className="break-words text-sm font-medium leading-snug">{m.title}</span>
                </span>
                <AreaChip areaId={m.area_id} className="justify-self-end" />
                <span className="col-span-2 text-xs text-muted">
                  {memberName(m.author_id)} · {format.stamp(m.updated_at ?? m.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to={seeAll} className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-accent-deep hover:bg-hover">
        {t('bell.seeAll')}
        <ArrowRight size={14} aria-hidden />
      </Link>
    </PopoverContent>
  )
}

/** On a phone: one button with the highest pending state and its total; its menu has the three states, each line a link to Mensajes already filtered. */
function PhoneSummary({ top, total, counts }: { top: MessageStatus | null; total: number; counts: StateCounts }) {
  const t = useT()
  const name = STATES_SHOWN.map((s) => t(WORD[s], { n: counts[s] ?? 0 })).join(', ')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="summary-menu" aria-label={`${t('bar.mine')}: ${name}`} title={t('bar.mine')} className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-line-strong px-2.5 text-sm font-bold md:hidden">
          {top ? (
            <span data-status={top} data-weight="quiet" data-plain className="inline-flex items-center gap-1">
              <StateIcon status={top} size={16} />
              <span className="tabular-nums">{total}</span>
            </span>
          ) : (
            <span className="tabular-nums text-muted">0</span>
          )}
          <ChevronDown size={14} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} collisionPadding={8} data-testid="status-menu" aria-label={t('bar.label')} className="flex max-h-[var(--radix-popover-content-available-height)] w-72 flex-col overflow-y-auto p-0">
        <ul>
          {STATES_SHOWN.map((s) => (
            <li key={s}>
              <Link to={messagesPath(mineFilters(s))} aria-label={t(WORD[s], { n: counts[s] ?? 0 })} className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-3 py-2 text-sm font-medium last:border-b-0 hover:bg-hover">
                <StateMark status={s} plain />
                <span className="tabular-nums font-bold">{counts[s] ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
