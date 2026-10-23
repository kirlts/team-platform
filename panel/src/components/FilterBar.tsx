import { ChevronDown, Search, X } from '@/components/icons'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT, type MessageKey } from '@/i18n'
import { DELETED_VALUE, FILTER_PROPS, ME, REPLIES_VALUES, STATUS_VALUES, removeFilter, upsertFilter, type Filter, type FilterOp, type FilterProp, type MessageQuery } from '@team-platform/client'
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

/** Search and filters as chips of property, operator and value. The state lives in the URL. */
export function FilterBar({ query, onChange }: { query: MessageQuery; onChange: (next: MessageQuery) => void }) {
  const t = useT()
  const { areas, members } = useLookups()
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
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label={t('filter.search')}
            placeholder={t('filter.search')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="well h-8 w-full rounded-full pl-9 pr-3 text-sm placeholder:text-faint focus-visible:border-accent"
          />
        </div>
        {/* The button wears what is applied: its edge and its count. Each filter of the menu opens its values, with a check on the one that is on and the way to take it off (J2-A-13, J3-A-16). */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" aria-label={used.size > 0 ? t('filter.addActive', { n: used.size }) : undefined} className={cn(used.size > 0 && '!border-accent bg-selected text-fg')}>
              {t('filter.add')}
              {used.size > 0 && <span className="tabular-nums text-accent-deep">{used.size}</span>}
              <ChevronDown size={13} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {FILTER_PROPS.map((p) => {
              const on = query.filters.find((f) => f.prop === p)
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
                          {o.label}
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
            <li key={f.prop} className="glass inline-flex min-h-7 items-stretch overflow-hidden rounded-[14px] text-sm leading-tight !shadow-none">
              <span className="flex items-center bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-3 py-1 font-semibold">{t(PROP_KEY[f.prop])}</span>
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
                  <ChevronDown size={12} aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                  <DropdownMenuRadioGroup
                    value={f.value}
                    onValueChange={(v) => onChange({ ...query, filters: upsertFilter(query.filters, { ...f, value: v }) })}
                  >
                    {valueOptions(f.prop).map((o) => (
                      <DropdownMenuRadioItem key={o.value} value={o.value}>
                        {o.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>}
              <button
                type="button"
                aria-label={t('filter.remove', { prop: t(PROP_KEY[f.prop]) })}
                onClick={() => onChange({ ...query, filters: removeFilter(query.filters, f.prop) })}
                className="flex items-center border-l border-line px-2 text-muted hover:bg-danger-soft hover:text-danger"
              >
                <X size={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
