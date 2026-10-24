import { ChevronDown, Search, X } from '@/components/icons'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT, type MessageKey } from '@/i18n'
import { DELETED_VALUE, FILTER_PROPS, ME, REPLIES_VALUES, STATUS_VALUES, removeFilter, upsertFilter, type Filter, type FilterOp, type FilterProp, type Message, type MessageQuery } from '@team-platform/client'
import { useMe, useMessages } from '@team-platform/client/react'
import { cn } from '@/lib/utils'
import { useLookups } from './lookups'
import { STATUS_KEY } from './StatusBadge'

const PROP_KEY: Record<FilterProp, MessageKey> = {
  for: 'filter.for',
  involved: 'filter.involved',
  area: 'filter.area',
  status: 'filter.status',
  replies: 'filter.replies',
  deleted: 'filter.deleted',
}

const OP_KEY: Record<FilterOp, MessageKey> = { eq: 'filter.is', neq: 'filter.isNot' }

/** Time the search waits after the last keystroke before querying. It is for comfort, not for operation. */
const SEARCH_PAUSE_MS = 250

/** Whether a message holds a value of a property, for the filters that have a figure beside their options. */
function holds(m: Message, prop: FilterProp, value: string, meId: string): boolean {
  switch (prop) {
    case 'for':
      return m.assignee_ids.includes(value === ME ? meId : value)
    case 'area':
      return m.area_id === value
    case 'status':
      return m.status === value
    case 'replies':
      return value === 'con' ? m.reply_count > 0 : m.reply_count === 0
    default:
      return true
  }
}

/** The number beside an option: the messages the option would leave on the list with the other filters as they are (the search text does not count). */
function countsOf(all: readonly Message[], filters: Filter[], prop: FilterProp, meId: string): (value: string) => number {
  const rest = all.filter((m) => filters.every((f) => f.prop === prop || !countable(f.prop) || holds(m, f.prop, f.value, meId) === (f.op === 'eq')))
  return (value) => rest.filter((m) => holds(m, prop, value, meId)).length
}

/** «Borrados» is a set of its own, and «Concierne a» is the rule of the top bar: neither carries a figure. */
const countable = (prop: FilterProp) => prop !== 'deleted' && prop !== 'involved'

/** A menu option: its word at the left and its number at the right. */
function Counted({ label, n }: { label: string; n: number }) {
  return (
    <>
      {label}
      <span className="ml-auto pl-4 tabular-nums text-muted">{n}</span>
    </>
  )
}

/** Search and filters as chips of property, operator and value. The state lives in the URL. */
export function FilterBar({ query, onChange }: { query: MessageQuery; onChange: (next: MessageQuery) => void }) {
  const t = useT()
  const { areas, members } = useLookups()
  const me = useMe().data
  // Every message the person sees, without filters: the figures beside the options are counted over it. With «Concierne a» on (the rule of the
  // top bar) the list is not a product of these filters alone, so no figure is drawn rather than a wrong one.
  const everything = useMessages({ query: { filters: [], q: '' }, meId: me?.id ?? '', enabled: !!me }).data
  const all = query.filters.some((f) => f.prop === 'involved') ? undefined : everything
  const [openValue, setOpenValue] = useState<FilterProp | null>(null)
  const [text, setText] = useState(query.q)

  // The URL rules: an external change (back, link) is reflected in the field.
  useEffect(() => setText(query.q), [query.q])

  useEffect(() => {
    if (text.trim() === query.q) return
    const t = setTimeout(() => onChange({ ...query, q: text.trim() }), SEARCH_PAUSE_MS)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  const valueOptions = (prop: FilterProp): { value: string; label: string }[] => {
    switch (prop) {
      case 'for':
        return [{ value: ME, label: t('filter.me') }, ...members.map((m) => ({ value: m.id, label: m.name }))]
      case 'involved':
        return [{ value: ME, label: t('filter.me') }]
      case 'area':
        return areas.map((a) => ({ value: a.id, label: a.title }))
      case 'status':
        return STATUS_VALUES.map((s) => ({ value: s, label: t(STATUS_KEY[s]) }))
      case 'deleted':
        return [{ value: DELETED_VALUE, label: t('filter.deleted') }]
      case 'replies':
        return REPLIES_VALUES.map((v) => ({ value: v, label: v === 'con' ? t('filter.with') : t('filter.without') }))
    }
  }

  const labelOf = (f: Filter) => valueOptions(f.prop).find((o) => o.value === f.value)?.label ?? f.value

  const used = new Set(query.filters.map((f) => f.prop))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 max-w-lg flex-1 basis-56">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label={t('filter.search')}
            placeholder={t('filter.search')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="well h-10 w-full rounded-field border-line-strong bg-raised pl-10 pr-3 text-sm placeholder:text-faint focus-visible:border-accent"
          />
        </div>
        {/* The button wears what is applied: its edge and its count. Each filter of the menu opens its values, with a check on the one that is on and the way to take it off (J2-A-13, J3-A-16). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" aria-label={used.size > 0 ? t('filter.addActive', { n: used.size }) : undefined} className={cn(used.size > 0 && '!border-accent bg-selected text-fg')}>
              {t('filter.add')}
              {used.size > 0 && <span className="tabular-nums text-accent-deep">{used.size}</span>}
              <ChevronDown size={16} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {FILTER_PROPS.map((p) => {
              const on = query.filters.find((f) => f.prop === p)
              const count = all && countable(p) ? countsOf(all, query.filters, p, me?.id ?? '') : null
              if (p === 'deleted') {
                return (
                  <DropdownMenuCheckboxItem key={p} checked={!!on} onCheckedChange={(v) => onChange({ ...query, filters: v ? upsertFilter(query.filters, { prop: p, op: 'eq', value: DELETED_VALUE }) : removeFilter(query.filters, p) })}>
                    {t(PROP_KEY[p])}
                  </DropdownMenuCheckboxItem>
                )
              }
              return (
                <DropdownMenuSub key={p}>
                  <DropdownMenuSubTrigger aria-label={on ? `${t(PROP_KEY[p])}: ${labelOf(on)}` : t(PROP_KEY[p])}>
                    {t(PROP_KEY[p])}
                    {on && <span className="ml-auto pl-4 text-muted">{labelOf(on)}</span>}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuRadioGroup value={on?.value ?? ''} onValueChange={(v) => onChange({ ...query, filters: upsertFilter(query.filters, { prop: p, op: on?.op ?? 'eq', value: v }) })}>
                      {valueOptions(p).map((o) => (
                        <DropdownMenuRadioItem key={o.value} value={o.value}>
                          {count ? <Counted label={o.label} n={count(o.value)} /> : o.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    {on && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onChange({ ...query, filters: removeFilter(query.filters, p) })}>{t('filter.take')}</DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {query.filters.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label={t('filter.applied')}>
          {query.filters.map((f) => (
            <li key={f.prop} className="glass inline-flex min-h-8 items-stretch overflow-hidden rounded-full text-sm leading-tight !shadow-none [@media(pointer:coarse)]:min-h-11">
              <span className="flex items-center bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] pl-3 pr-2 py-1 font-semibold">{t(PROP_KEY[f.prop])}</span>
              {f.prop === 'replies' || f.prop === 'involved' || f.prop === 'deleted' ? null : (
                <DropdownMenu>
                  <DropdownMenuTrigger className="px-1.5 text-muted hover:bg-hover" aria-label={t('filter.operatorOf', { prop: t(PROP_KEY[f.prop]) })}>
                    {t(OP_KEY[f.op])}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-28">
                    <DropdownMenuRadioGroup
                      value={f.op}
                      onValueChange={(v) => onChange({ ...query, filters: upsertFilter(query.filters, { ...f, op: v as FilterOp }) })}
                    >
                      <DropdownMenuRadioItem value="eq">{t(OP_KEY.eq)}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="neq">{t(OP_KEY.neq)}</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {f.prop === 'deleted' ? null : <DropdownMenu open={openValue === f.prop} onOpenChange={(o) => setOpenValue(o ? f.prop : null)}>
                <DropdownMenuTrigger className={cn('inline-flex items-center gap-1 px-2.5 py-1 text-left font-semibold text-accent-deep hover:bg-accent-soft')} aria-label={t('filter.valueOf', { prop: t(PROP_KEY[f.prop]) })}>
                  {labelOf(f)}
                  <ChevronDown size={16} aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={f.value}
                    onValueChange={(v) => onChange({ ...query, filters: upsertFilter(query.filters, { ...f, value: v }) })}
                  >
                    {valueOptions(f.prop).map((o) => (
                      <DropdownMenuRadioItem key={o.value} value={o.value}>
                        {all && countable(f.prop) ? <Counted label={o.label} n={countsOf(all, query.filters, f.prop, me?.id ?? '')(o.value)} /> : o.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>}
              <button
                type="button"
                aria-label={t('filter.remove', { prop: t(PROP_KEY[f.prop]) })}
                onClick={() => onChange({ ...query, filters: removeFilter(query.filters, f.prop) })}
                title={t('filter.remove', { prop: t(PROP_KEY[f.prop]) })}
                className="flex items-center border-l border-line px-2.5 text-muted hover:bg-danger-soft hover:text-danger [@media(pointer:coarse)]:px-3.5"
              >
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
