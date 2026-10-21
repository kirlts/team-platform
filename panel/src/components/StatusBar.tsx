import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AreaChip, useAreaStyle } from '@/components/AreaChip'
import { StateIcon, usePulse } from '@/components/NotifyBadge'
import { useLookups } from '@/components/lookups'
import { ChevronDown } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { ME, serializeQuery, type Filter } from '@/lib/filters'
import { areaCounts, mineCounts } from '@/lib/pending'
import { stateTotal, topState } from '@/lib/states'
import { useMe, useMessages, useSummary } from '@/lib/queries'
import type { MessageStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The states that are pending: closed messages raise no notice (UD-041) and have no mark in the bar (UD-100). */
const COUNTED = ['open', 'answered'] as const
const WORD: Record<MessageStatus, MessageKey> = { open: 'state.open', answered: 'state.answered', closed: 'state.closed' }

const messagesPath = (filters: Filter[]) => `/messages?${serializeQuery({ filters, q: '' }).toString()}`
const mineFilters = (status: MessageStatus): Filter[] => [{ prop: 'for', op: 'eq', value: ME }, { prop: 'status', op: 'eq', value: status }]

/**
 * What is pending, in the top bar of every page and nowhere else (UD-100). Each state that affects me is its shape and its number, with no
 * visible word (the word is the accessible name and the tooltip); each area with something pending is its color and its number. A click opens
 * a small menu anchored to the mark with those messages, so the page you are on stays where it is; the menu ends in the link to Mensajes already filtered.
 * On a phone one button carries the total and its menu is the index of both.
 */
export function StatusBar() {
  const t = useT()
  const summary = useSummary().data
  const counts = mineCounts(summary)
  const top = topState(counts)
  const total = stateTotal(counts)
  const pulse = usePulse(total)
  const areas = (summary?.areas ?? []).filter((a) => a.open + a.answered > 0)
  if (!summary) return null
  return (
    <section aria-label={t('bar.label')} data-testid="status-bar" data-state-top={top ?? 'none'} data-pulse={pulse} className="flex min-w-0 flex-1 items-center justify-end gap-2">
      <div className="hidden min-w-0 items-center gap-2 md:flex md:flex-1 md:justify-end">
        <ul aria-label={t('bar.mine')} className="flex shrink-0 items-center gap-1">
          {COUNTED.filter((status) => (counts[status] ?? 0) > 0).map((status) => (
            <li key={status}>
              <StateButton status={status} n={counts[status] ?? 0} />
            </li>
          ))}
        </ul>
        {areas.length > 0 && <AreaRow areaIds={areas.map((a) => a.area_id)} />}
      </div>
      <PhoneSummary top={top} total={total} />
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
      <MessageMenu name={word} filters={filters} seeAll={messagesPath(filters)} />
    </Popover>
  )
}

/** One area with something pending: its color with the number of messages open or answered in it. */
function AreaButton({ areaId }: { areaId: string }) {
  const t = useT()
  const summary = useSummary().data
  const { areaTitle } = useLookups()
  const style = useAreaStyle(areaId)
  const c = areaCounts(summary, areaId)
  const n = c.open + c.answered
  const name = `${areaTitle(areaId)}: ${COUNTED.filter((s) => c[s] > 0).map((s) => t(WORD[s], { n: c[s] })).join(', ')}`
  const filters: Filter[] = [{ prop: 'area', op: 'eq', value: areaId }]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="area-pending" data-area-id={areaId} data-count={n} aria-label={name} title={name} style={style} className="area-tint area-chip h-9 min-w-9 shrink-0 justify-center px-2.5 text-sm tabular-nums hover:brightness-95">
          {n}
        </button>
      </PopoverTrigger>
      <MessageMenu name={name} filters={filters} seeAll={messagesPath(filters)} pendingOnly showState />
    </Popover>
  )
}

/**
 * The marks of the areas on one row of the bar. All are drawn once to see how many fit; the rest fold behind «+N», which opens them under the bar.
 * The row has a height of its own, so measuring does not move what is below (H-1405).
 */
function AreaRow({ areaIds }: { areaIds: string[] }) {
  const t = useT()
  const box = useRef<HTMLUListElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [measure, setMeasure] = useState<{ fit: number; n: number } | null>(null)
  const [round, setRound] = useState(0)
  const [open, setOpen] = useState(false)
  const fitting = measure && measure.n === areaIds.length ? measure.fit : null

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - width) > 0.5) {
        width = el.clientWidth
        setMeasure(null)
        setRound((r) => r + 1)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = box.current
    if (!el || fitting !== null) return
    const items = [...el.children] as HTMLElement[]
    const top = items[0]?.offsetTop ?? 0
    setMeasure({ fit: Math.max(1, items.filter((li) => li.offsetTop <= top + 1).length), n: areaIds.length })
  }, [fitting, round, areaIds.length])

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      const target = e.target as Node
      // A menu of an area opened from this panel is in a portal: it is not «outside» either.
      if (!wrap.current?.contains(target) && !(target instanceof Element && target.closest('.pop'))) setOpen(false)
    }
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[data-state="open"].pop') && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const shown = fitting === null ? areaIds : areaIds.slice(0, fitting)
  const rest = fitting === null ? [] : areaIds.slice(fitting)
  return (
    <div ref={wrap} data-lane="area-pending" className="relative flex min-w-0 flex-1 items-center justify-end gap-1">
      <ul ref={box} aria-label={t('bar.byArea')} className="flex h-9 min-w-0 flex-1 flex-wrap items-start justify-end gap-1 overflow-hidden">
        {shown.map((id) => (
          <li key={id}>
            <AreaButton areaId={id} />
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <>
          <button type="button" data-testid="area-more" aria-expanded={open} aria-label={t('bar.moreAreas', { n: rest.length })} title={t('bar.moreAreas', { n: rest.length })} onClick={() => setOpen((v) => !v)} className="inline-flex h-9 shrink-0 items-center rounded-full border border-line-strong px-2.5 text-sm font-semibold hover:bg-glass">
            +{rest.length}
          </button>
          {open && (
            <ul data-testid="area-rest" className="pop absolute right-0 top-full z-40 mt-2 flex max-w-[min(24rem,calc(100vw-1rem))] flex-wrap justify-end gap-1 rounded-lg p-2">
              {rest.map((id) => (
                <li key={id}>
                  <AreaButton areaId={id} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** The messages behind a number, as a small menu under its mark: title, area, who and when; arrows walk the rows. */
function MessageMenu({ name, filters, seeAll, pendingOnly = false, showState = false }: { name: string; filters: Filter[]; seeAll: string; pendingOnly?: boolean; showState?: boolean }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const { memberName } = useLookups()
  const list = useMessages({ query: { filters, q: '' }, meId: me?.id ?? '' })
  const rows = (list.data ?? []).filter((m) => !pendingOnly || m.status !== 'closed')
  const walk = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const links = [...e.currentTarget.querySelectorAll<HTMLElement>('a')]
    const at = links.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? Math.min(links.length - 1, at + 1) : Math.max(0, at - 1)
    links[next]?.focus()
    e.preventDefault()
  }
  return (
    <PopoverContent align="end" sideOffset={10} collisionPadding={8} aria-label={name} data-testid="status-menu" className="flex max-h-[var(--radix-popover-content-available-height)] w-[24rem] flex-col p-0">
      {list.isPending ? (
        <p className="px-3 py-4 text-center text-sm text-muted">{t('common.loading')}</p>
      ) : (
        <ul data-lane="status-list" onKeyDown={walk} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {rows.map((m) => (
            <li key={m.id} data-testid="status-row" className="border-b border-line">
              <Link to={`/messages/${m.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 px-3 py-2 hover:bg-hover">
                <span className="flex min-w-0 items-start gap-1.5">
                  {showState && (
                    <span data-status={m.status} data-weight="quiet" data-plain className="mt-0.5 inline-flex shrink-0" title={t(WORD[m.status], { n: 1 })}>
                      <StateIcon status={m.status} size={14} />
                    </span>
                  )}
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
        <span className="tabular-nums text-muted">{list.isPending ? '' : rows.length}</span>
      </Link>
    </PopoverContent>
  )
}

/** On a phone: one button with the highest state and the total; its menu is the index, each line a link to Mensajes already filtered. */
function PhoneSummary({ top, total }: { top: MessageStatus | null; total: number }) {
  const t = useT()
  const summary = useSummary().data
  const { areaTitle } = useLookups()
  const counts = mineCounts(summary)
  const areas = (summary?.areas ?? []).filter((a) => a.open + a.answered > 0)
  const name = COUNTED.filter((s) => (counts[s] ?? 0) > 0).map((s) => t(WORD[s], { n: counts[s] ?? 0 })).join(', ')
  const line = (key: string, to: string, label: string, mark: ReactNode, n: number, className?: string) => (
    <li key={key}>
      <Link to={to} aria-label={label} title={label} className={cn('flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm font-medium hover:bg-hover', className)}>
        {mark}
        <span className="tabular-nums font-bold">{n}</span>
      </Link>
    </li>
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="summary-menu" aria-label={name ? `${t('bar.mine')}: ${name}` : `${t('bar.mine')}: ${t('bar.none')}`} title={t('bar.mine')} className="inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-line-strong px-2.5 text-sm font-bold md:hidden">
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
          {COUNTED.filter((s) => (counts[s] ?? 0) > 0).map((s) =>
            line(s, messagesPath(mineFilters(s)), t(WORD[s], { n: counts[s] ?? 0 }), <span data-status={s} data-weight="quiet" data-plain className="inline-flex"><StateIcon status={s} size={16} /></span>, counts[s] ?? 0, 'border-b border-line'),
          )}
          {areas.map((a) => {
            const c = areaCounts(summary, a.area_id)
            return line(a.area_id, messagesPath([{ prop: 'area', op: 'eq', value: a.area_id }]), areaTitle(a.area_id), <AreaChip areaId={a.area_id} />, c.open + c.answered, 'border-b border-line')
          })}
          {total === 0 && areas.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">{t('bar.none')}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
