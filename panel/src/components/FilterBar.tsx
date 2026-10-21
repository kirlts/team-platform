import { ChevronDown, Plus, Search, X } from '@/components/icons'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FILTER_PROPS, ME, REPLIES_VALUES, STATUS_VALUES, removeFilter, upsertFilter, type Filter, type FilterOp, type FilterProp, type MessageQuery } from '@/lib/filters'
import { cn } from '@/lib/utils'
import { useLookups } from './lookups'
import { STATUS_LABEL } from './StatusBadge'

const PROP_LABEL: Record<FilterProp, string> = {
  for: 'Para',
  area: 'Área',
  status: 'Estado',
  replies: 'Respuestas',
}

const OP_LABEL: Record<FilterOp, string> = { eq: 'es', neq: 'no es' }

/** Tiempo que espera la búsqueda tras la última tecla antes de consultar. Es de comodidad, no de operación. */
const SEARCH_PAUSE_MS = 250

/** Búsqueda y filtros como chips de propiedad, operador y valor. El estado vive en la URL. */
export function FilterBar({ query, onChange }: { query: MessageQuery; onChange: (next: MessageQuery) => void }) {
  const { areas, members } = useLookups()
  const [openValue, setOpenValue] = useState<FilterProp | null>(null)
  const [text, setText] = useState(query.q)

  // La URL manda: un cambio externo (atrás, enlace) se refleja en el campo.
  useEffect(() => setText(query.q), [query.q])

  useEffect(() => {
    if (text.trim() === query.q) return
    const t = setTimeout(() => onChange({ ...query, q: text.trim() }), SEARCH_PAUSE_MS)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  const valueOptions = (prop: FilterProp): { value: string; label: string }[] => {
    switch (prop) {
      case 'for':
        return [{ value: ME, label: 'Yo' }, ...members.map((m) => ({ value: m.id, label: m.name }))]
      case 'area':
        return areas.map((a) => ({ value: a.id, label: a.title }))
      case 'status':
        return STATUS_VALUES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))
      case 'replies':
        return REPLIES_VALUES.map((v) => ({ value: v, label: v === 'con' ? 'Con' : 'Sin' }))
    }
  }

  const labelOf = (f: Filter) => valueOptions(f.prop).find((o) => o.value === f.value)?.label ?? f.value

  const used = new Set(query.filters.map((f) => f.prop))
  const free = FILTER_PROPS.filter((p) => !used.has(p))

  const add = (prop: FilterProp) => {
    const first = valueOptions(prop)[0]
    if (!first) return
    onChange({ ...query, filters: upsertFilter(query.filters, { prop, op: 'eq', value: first.value }) })
    setOpenValue(prop)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Buscar"
            placeholder="Buscar"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="well h-8 w-full rounded-full pl-9 pr-3 text-sm placeholder:text-faint focus-visible:border-accent"
          />
        </div>
        {free.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
                <Plus size={14} aria-hidden /> Filtro
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {free.map((p) => (
                <DropdownMenuItem key={p} onSelect={() => add(p)}>
                  {PROP_LABEL[p]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {query.filters.length > 0 && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Filtros aplicados">
          {query.filters.map((f) => (
            <li key={f.prop} className="glass inline-flex min-h-7 items-stretch overflow-hidden rounded-[14px] text-[13px] leading-tight !shadow-none">
              <span className="flex items-center bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-3 py-1 font-semibold">{PROP_LABEL[f.prop]}</span>
              {f.prop === 'replies' ? (
                <span className="flex items-center px-1.5 text-muted">{OP_LABEL.eq}</span>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger className="px-1.5 text-muted hover:bg-hover" aria-label={`Operador de ${PROP_LABEL[f.prop]}`}>
                    {OP_LABEL[f.op]}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-28">
                    <DropdownMenuRadioGroup
                      value={f.op}
                      onValueChange={(v) => onChange({ ...query, filters: upsertFilter(query.filters, { ...f, op: v as FilterOp }) })}
                    >
                      <DropdownMenuRadioItem value="eq">es</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="neq">no es</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu open={openValue === f.prop} onOpenChange={(o) => setOpenValue(o ? f.prop : null)}>
                <DropdownMenuTrigger className={cn('inline-flex items-center gap-1 px-2.5 py-1 text-left font-semibold text-accent-deep hover:bg-accent-soft')} aria-label={`Valor de ${PROP_LABEL[f.prop]}`}>
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
              </DropdownMenu>
              <button
                type="button"
                aria-label={`Quitar el filtro ${PROP_LABEL[f.prop]}`}
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
