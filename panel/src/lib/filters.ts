// Filtros de Mensajes: propiedad, operador y valor, guardados en la URL.
// El servidor sólo entiende igualdad (GET /messages?for=&area=&status=&q=&replies=);
// la negación («no es») y «sin respuestas» se aplican acá sobre la lista recibida.
import type { Message } from './types'

export type FilterProp = 'for' | 'area' | 'status' | 'replies'
export type FilterOp = 'eq' | 'neq'

export interface Filter {
  prop: FilterProp
  op: FilterOp
  value: string
}

export interface MessageQuery {
  filters: Filter[]
  q: string
}

export const FILTER_PROPS: FilterProp[] = ['for', 'area', 'status', 'replies']
export const REPLIES_VALUES = ['con', 'sin'] as const
export const STATUS_VALUES = ['open', 'answered', 'closed'] as const
/** Valor del filtro «Para» que significa la persona que tiene la sesión. */
export const ME = 'me'

const PROP_SET = new Set<string>(FILTER_PROPS)

function validFilter(prop: string, op: string, value: string): Filter | null {
  if (!PROP_SET.has(prop)) return null
  if (op !== 'eq' && op !== 'neq') return null
  if (!value) return null
  const p = prop as FilterProp
  if (p === 'replies') {
    if (!(REPLIES_VALUES as readonly string[]).includes(value)) return null
    return { prop: p, op: 'eq', value }
  }
  if (p === 'status' && !(STATUS_VALUES as readonly string[]).includes(value)) return null
  return { prop: p, op, value }
}

/** `?f=for:eq:me&f=status:neq:closed&q=texto` → consulta. Un filtro por propiedad; lo inválido se ignora. */
export function parseQuery(params: URLSearchParams): MessageQuery {
  const filters: Filter[] = []
  for (const raw of params.getAll('f')) {
    const first = raw.indexOf(':')
    const second = raw.indexOf(':', first + 1)
    if (first < 0 || second < 0) continue
    const f = validFilter(raw.slice(0, first), raw.slice(first + 1, second), raw.slice(second + 1))
    if (f && !filters.some((x) => x.prop === f.prop)) filters.push(f)
  }
  return { filters, q: params.get('q')?.trim() ?? '' }
}

export function serializeQuery(query: MessageQuery): URLSearchParams {
  const out = new URLSearchParams()
  for (const f of query.filters) out.append('f', `${f.prop}:${f.op}:${f.value}`)
  if (query.q.trim()) out.set('q', query.q.trim())
  return out
}

/** Reemplaza el filtro de la misma propiedad o lo agrega. */
export function upsertFilter(filters: Filter[], next: Filter): Filter[] {
  const rest = filters.filter((f) => f.prop !== next.prop)
  const index = filters.findIndex((f) => f.prop === next.prop)
  if (index < 0) return [...rest, next]
  const out = [...filters]
  out[index] = next
  return out
}

export function removeFilter(filters: Filter[], prop: FilterProp): Filter[] {
  return filters.filter((f) => f.prop !== prop)
}

/** Parámetros que entiende el servidor: sólo igualdades. */
export function toApiParams(query: MessageQuery): URLSearchParams {
  const out = new URLSearchParams()
  for (const f of query.filters) {
    if (f.op !== 'eq') continue
    if (f.prop === 'replies') {
      if (f.value === 'con') out.set('replies', '1')
      continue
    }
    out.set(f.prop, f.value)
  }
  if (query.q.trim()) out.set('q', query.q.trim())
  return out
}

/** Lo que el servidor no filtra: negaciones y «sin respuestas». */
export function applyClientFilters(messages: Message[], query: MessageQuery, meId: string): Message[] {
  return messages.filter((m) =>
    query.filters.every((f) => {
      switch (f.prop) {
        case 'for': {
          if (f.op === 'eq') return true
          const target = f.value === ME ? meId : f.value
          return !m.assignee_ids.includes(target)
        }
        case 'area':
          return f.op === 'eq' ? true : m.area_id !== f.value
        case 'status':
          return f.op === 'eq' ? true : m.status !== f.value
        case 'replies':
          return f.value === 'sin' ? m.reply_count === 0 : true
      }
    }),
  )
}

/** Clave estable de consulta para TanStack Query. */
export function queryKeyOf(query: MessageQuery): string {
  return serializeQuery(query).toString()
}
